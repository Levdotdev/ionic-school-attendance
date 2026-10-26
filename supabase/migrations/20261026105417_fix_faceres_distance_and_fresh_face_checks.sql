-- Human FaceRes1024 descriptors use the package's normalized Euclidean
-- matcher. The former raw-cosine0.55 gate used a different score scale and
-- could accept different descriptors with similar direction/magnitude bias.
-- The embedding model is unchanged, so valid current enrollments stay. The
-- fresh-v2 request tag requires older cached-capture clients to be updated.
create or replace function private.validate_face_embedding(p_embedding double precision[])
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v_value double precision; v_norm double precision:=0;
begin
  if p_embedding is null or array_ndims(p_embedding) is distinct from 1 or array_length(p_embedding,1) is distinct from 1024 then return false; end if;
  foreach v_value in array p_embedding loop
    if v_value is null or v_value::text in('NaN','Infinity','-Infinity') or abs(v_value)>1000000 then return false; end if;
    v_norm:=v_norm+v_value*v_value;
  end loop;
  return v_norm>1e-12;
end;
$$;
revoke all on function private.validate_face_embedding(double precision[]) from public,anon,authenticated;

create function private.faceres_similarity(p_first double precision[],p_second double precision[])
returns double precision language plpgsql immutable security invoker set search_path='' as $$
declare v_distance double precision;
begin
  if not private.validate_face_embedding(p_first) or not private.validate_face_embedding(p_second) then
    raise exception 'Face descriptors are invalid' using errcode='22023'; end if;
  -- Human3.3.6 src/face/match.ts: squared Euclidean *25 rounded to2 decimals,
  -- followed by (1-sqrt(distance)/100-0.2)/0.6, clamped/rounded to0..1.
  select round((25*sum((a.value-b.value)*(a.value-b.value)))::numeric,2)::double precision
    into v_distance from unnest(p_first) with ordinality a(value,position)
    join unnest(p_second) with ordinality b(value,position) using(position);
  if v_distance=0 then return 1; end if;
  return round(greatest(0,least(1,(1-sqrt(v_distance)/100-0.2)/0.6))::numeric,2)::double precision;
end; $$;
revoke all on function private.faceres_similarity(double precision[],double precision[]) from public,anon,authenticated;

create or replace function private.enroll_my_face_impl(p_embedding double precision[],p_model_version text,p_sample_count integer)
returns void language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or private.current_profile_role() is distinct from 'student'::public.app_role then
    raise exception 'Only a signed-in student can enroll a face template' using errcode='42501'; end if;
  perform 1 from public.profiles where id=(select auth.uid()) for update;
  if exists(select 1 from private.student_face_templates where student_id=(select auth.uid()))
    and not exists(select 1 from private.face_retake_grants where student_id=(select auth.uid())) then
    raise exception 'Your face is already enrolled. Ask an administrator to allow a retake.' using errcode='42501'; end if;
  if btrim(p_model_version) is distinct from 'human-faceres-3.3.6-fresh-v2' then
    raise exception 'Update the app before enrolling your face' using errcode='22023'; end if;
  perform private.enroll_my_face_validated_impl(p_embedding,p_model_version,p_sample_count);
  delete from private.face_retake_grants where student_id=(select auth.uid());
end; $$;
revoke all on function private.enroll_my_face_impl(double precision[],text,integer) from public,anon,authenticated;
grant execute on function private.enroll_my_face_impl(double precision[],text,integer) to authenticated;

create or replace function private.verify_my_face_for_meeting_impl(
  p_meeting_id uuid,p_embedding double precision[],p_model_version text,
  p_liveness_score double precision,p_antispoof_score double precision)
returns table(similarity double precision,matched boolean,liveness_score double precision,antispoof_score double precision)
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_template private.student_face_templates%rowtype;
  v_meeting public.meetings%rowtype; v_similarity double precision; v_matched boolean;
begin
  if v_actor is null or private.current_profile_role() is distinct from 'student'::public.app_role then
    raise exception 'Only a signed-in student can verify a face' using errcode='42501'; end if;
  select m.* into v_meeting from public.meetings m join public.classes c on c.id=m.class_id and c.archived_at is null
    where m.id=p_meeting_id;
  if not found or not v_meeting.attendance_enabled
    or v_meeting.attendance_mode not in('self_on_site'::public.attendance_mode,'self_online'::public.attendance_mode)
    or now() not between v_meeting.starts_at and v_meeting.attendance_closes_at
    or not exists(select 1 from public.class_enrollments e where e.class_id=v_meeting.class_id and e.student_id=v_actor and e.is_active) then
    raise exception 'This meeting is not available for self-check' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('face-verification:'||v_actor::text,0));
  select t.* into v_template from private.student_face_templates t where t.student_id=v_actor;
  if not found then raise exception 'Face verification is not enrolled for this student' using errcode='22023'; end if;
  if btrim(p_model_version) is distinct from 'human-faceres-3.3.6-fresh-v2' then
    raise exception 'Update the app before verifying your face, or open the latest website.' using errcode='22023'; end if;
  if v_template.model_version not in('human-faceres-3.3.6','human-faceres-3.3.6-fresh-v2')
    or not private.validate_face_embedding(v_template.embedding) then
    raise exception 'Your face enrollment uses an unsupported format. Ask an administrator to authorize a retake with the updated app.' using errcode='22023'; end if;
  if not private.validate_face_embedding(p_embedding) then
    raise exception 'The new face photo is invalid. Retake it with the updated app.' using errcode='22023'; end if;
  if p_liveness_score is null or p_liveness_score not between 0 and 1
    or p_antispoof_score is null or p_antispoof_score not between 0 and 1
    or p_liveness_score::text in('NaN','Infinity','-Infinity') or p_antispoof_score::text in('NaN','Infinity','-Infinity') then
    raise exception 'Face liveness scores are invalid' using errcode='22023'; end if;
  delete from private.face_verification_sessions f where f.student_id=v_actor and f.expires_at<=now();
  if (select count(*) from private.face_verification_sessions f where f.student_id=v_actor and f.created_at>now()-interval '1 minute')>=10 then
    raise exception 'Too many face verification attempts. Wait a minute and try again.' using errcode='54000'; end if;
  -- A newer nonmatch cannot leave a previous successful grant usable.
  update private.face_verification_sessions f set consumed_at=now()
    where f.student_id=v_actor and f.meeting_id=p_meeting_id and f.consumed_at is null;
  v_similarity:=private.faceres_similarity(v_template.embedding,p_embedding);
  v_matched:=v_similarity>=0.55 and p_liveness_score>=0.6 and p_antispoof_score>=0.6;
  insert into private.face_verification_sessions(student_id,meeting_id,model_version,similarity,liveness_score,antispoof_score,matched)
    values(v_actor,p_meeting_id,v_template.model_version,v_similarity,p_liveness_score,p_antispoof_score,v_matched);
  similarity:=v_similarity; matched:=v_matched; liveness_score:=p_liveness_score; antispoof_score:=p_antispoof_score;
  return next;
end; $$;
revoke all on function private.verify_my_face_for_meeting_impl(uuid,double precision[],text,double precision,double precision) from public,anon,authenticated;
grant execute on function private.verify_my_face_for_meeting_impl(uuid,double precision[],text,double precision,double precision) to authenticated;

-- Do not retain an unused grant produced by the former, incompatible metric.
-- Historical attendance and existing enrollment templates are untouched.
update private.face_verification_sessions set consumed_at=now() where consumed_at is null;
