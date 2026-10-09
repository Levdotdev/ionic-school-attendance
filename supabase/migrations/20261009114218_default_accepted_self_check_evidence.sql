-- Self-check hardening, default acceptance, face verification, and removal of
-- the deprecated event self-check path.

-- Existing event meetings become manual meetings. The enum label remains for
-- PostgreSQL compatibility, but a table constraint prevents future use.
update public.meetings
set attendance_mode = 'teacher_manual'::public.attendance_mode,
    updated_at = now()
where attendance_mode = 'self_event'::public.attendance_mode;

alter table public.meetings
  drop constraint if exists meetings_location_required_for_physical_self_check;

alter table public.meetings
  add constraint meetings_location_required_for_physical_self_check check (
    attendance_mode <> 'self_on_site'::public.attendance_mode
    or (latitude is not null and longitude is not null)
  ),
  add constraint meetings_supported_attendance_mode check (
    attendance_mode in (
      'teacher_manual'::public.attendance_mode,
      'self_on_site'::public.attendance_mode,
      'self_online'::public.attendance_mode
    )
  );

-- Face templates are biometric data and therefore live outside the exposed
-- public schema. Clients can only operate on their own template through the
-- actor-bound RPCs below.
create table private.student_face_templates (
  student_id uuid primary key references public.profiles (id) on delete cascade,
  embedding double precision[] not null,
  model_version text not null check (char_length(model_version) between 3 and 100),
  sample_count smallint not null check (sample_count between 3 and 10),
  consented_at timestamptz not null default now(),
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_face_templates_embedding_size check (cardinality(embedding) between 64 and 4096)
);

create table private.face_verification_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  model_version text not null,
  similarity double precision not null check (similarity between -1 and 1),
  liveness_score double precision not null check (liveness_score between 0 and 1),
  antispoof_score double precision not null check (antispoof_score between 0 and 1),
  matched boolean not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  constraint face_verification_sessions_expiry check (expires_at > created_at)
);

create index face_verification_sessions_lookup_idx
on private.face_verification_sessions (student_id, meeting_id, created_at desc)
where matched and consumed_at is null;

-- Cover both foreign-key cascades and bounded retention/rate-limit scans. The
-- lookup index above starts with student_id and therefore cannot efficiently
-- support a meeting deletion by itself.
create index face_verification_sessions_meeting_id_idx
on private.face_verification_sessions (meeting_id);
create index face_verification_sessions_student_created_idx
on private.face_verification_sessions (student_id, created_at desc);
create index face_verification_sessions_expires_at_idx
on private.face_verification_sessions (expires_at);

alter table private.student_face_templates enable row level security;
alter table private.face_verification_sessions enable row level security;

revoke all on table private.student_face_templates from public, anon, authenticated;
revoke all on table private.face_verification_sessions from public, anon, authenticated;
grant all on table private.student_face_templates to service_role;
grant all on table private.face_verification_sessions to service_role;

create or replace function private.validate_face_embedding(p_embedding double precision[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(cardinality(p_embedding) between 64 and 4096, false)
    and array_position(p_embedding, null) is null
    and not exists (
      select 1
      from unnest(p_embedding) value
      where value::text in ('NaN', 'Infinity', '-Infinity')
    )
$$;

revoke all on function private.validate_face_embedding(double precision[])
from public, anon, authenticated;

create or replace function private.enroll_my_face_impl(
  p_embedding double precision[],
  p_model_version text,
  p_sample_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or private.current_profile_role() <> 'student' then
    raise exception 'Only a signed-in student can enroll a face template'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.student_profiles student
    where student.user_id = v_actor
      and student.registration_completed_at is not null
  ) then
    raise exception 'Complete student registration before face enrollment'
      using errcode = '22023';
  end if;

  if not private.validate_face_embedding(p_embedding) then
    raise exception 'The face template is invalid' using errcode = '22023';
  end if;

  if nullif(btrim(p_model_version), '') is null
     or char_length(btrim(p_model_version)) > 100
     or p_sample_count not between 3 and 10 then
    raise exception 'Face enrollment metadata is invalid' using errcode = '22023';
  end if;

  insert into private.student_face_templates (
    student_id,
    embedding,
    model_version,
    sample_count,
    consented_at,
    enrolled_at,
    updated_at
  )
  values (
    v_actor,
    p_embedding,
    btrim(p_model_version),
    p_sample_count,
    now(),
    now(),
    now()
  )
  on conflict (student_id) do update
    set embedding = excluded.embedding,
        model_version = excluded.model_version,
        sample_count = excluded.sample_count,
        consented_at = excluded.consented_at,
        enrolled_at = excluded.enrolled_at,
        updated_at = excluded.updated_at;

  delete from private.face_verification_sessions
  where student_id = v_actor;
end;
$$;

create or replace function public.enroll_my_face(
  p_embedding double precision[],
  p_model_version text,
  p_sample_count integer
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.enroll_my_face_impl(p_embedding, p_model_version, p_sample_count)
$$;

create or replace function private.delete_my_face_impl()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or private.current_profile_role() <> 'student' then
    raise exception 'Only a signed-in student can remove a face template'
      using errcode = '42501';
  end if;

  delete from private.student_face_templates
  where student_id = v_actor;

  -- Revoking biometric consent must also revoke every still-valid proof that
  -- was derived from the deleted template.
  delete from private.face_verification_sessions
  where student_id = v_actor;
end;
$$;

create or replace function public.delete_my_face()
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.delete_my_face_impl()
$$;

create or replace function private.my_face_enrollment_status_impl()
returns table (
  enrolled boolean,
  model_version text,
  enrolled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or private.current_profile_role() <> 'student' then
    raise exception 'Only a signed-in student can read face enrollment status'
      using errcode = '42501';
  end if;

  return query
  select
    template.student_id is not null,
    template.model_version,
    template.enrolled_at
  from (select 1) seed
  left join private.student_face_templates template
    on template.student_id = v_actor;
end;
$$;

create or replace function public.my_face_enrollment_status()
returns table (
  enrolled boolean,
  model_version text,
  enrolled_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.my_face_enrollment_status_impl()
$$;

create or replace function private.verify_my_face_for_meeting_impl(
  p_meeting_id uuid,
  p_embedding double precision[],
  p_model_version text,
  p_liveness_score double precision,
  p_antispoof_score double precision
)
returns table (
  similarity double precision,
  matched boolean,
  liveness_score double precision,
  antispoof_score double precision
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_template private.student_face_templates%rowtype;
  v_meeting public.meetings%rowtype;
  v_similarity double precision;
begin
  if v_actor is null or private.current_profile_role() <> 'student' then
    raise exception 'Only a signed-in student can verify a face'
      using errcode = '42501';
  end if;

  select meeting.* into v_meeting
  from public.meetings meeting
  where meeting.id = p_meeting_id;

  if not found
     or not v_meeting.attendance_enabled
     or v_meeting.attendance_mode not in (
       'self_on_site'::public.attendance_mode,
       'self_online'::public.attendance_mode
     )
     or now() not between v_meeting.attendance_opens_at and v_meeting.attendance_closes_at
     or not exists (
       select 1
       from public.class_enrollments enrollment
       where enrollment.class_id = v_meeting.class_id
         and enrollment.student_id = v_actor
         and enrollment.is_active
     ) then
    raise exception 'This meeting is not available for self-check'
      using errcode = '42501';
  end if;

  select template.* into v_template
  from private.student_face_templates template
  where template.student_id = v_actor;

  if not found then
    raise exception 'Face verification is not enrolled for this student'
      using errcode = '22023';
  end if;

  if v_template.model_version <> btrim(p_model_version)
     or not private.validate_face_embedding(p_embedding)
     or cardinality(v_template.embedding) <> cardinality(p_embedding) then
    raise exception 'Face enrollment must be updated before checking in'
      using errcode = '22023';
  end if;

  if p_liveness_score is null or p_liveness_score not between 0 and 1
     or p_antispoof_score is null or p_antispoof_score not between 0 and 1 then
    raise exception 'Face liveness scores are invalid' using errcode = '22023';
  end if;

  -- Serialize this student's attempts so concurrent clients cannot bypass the
  -- per-minute cap. Expired proofs are discarded opportunistically as well as
  -- by the scheduled cleanup job below.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('face-verification:' || v_actor::text, 0)
  );

  delete from private.face_verification_sessions verification
  where verification.student_id = v_actor
    and verification.expires_at <= now();

  if (
    select count(*)
    from private.face_verification_sessions verification
    where verification.student_id = v_actor
      and verification.created_at > now() - interval '1 minute'
  ) >= 10 then
    raise exception 'Too many face verification attempts. Wait a minute and try again.'
      using errcode = '54000';
  end if;

  select
    sum(template_value.value * candidate_value.value)
      / nullif(
          sqrt(sum(template_value.value * template_value.value))
          * sqrt(sum(candidate_value.value * candidate_value.value)),
          0
        )
  into v_similarity
  from unnest(v_template.embedding) with ordinality template_value(value, position)
  join unnest(p_embedding) with ordinality candidate_value(value, position)
    using (position);

  v_similarity := greatest(-1.0, least(1.0, coalesce(v_similarity, -1.0)));

  insert into private.face_verification_sessions (
    student_id,
    meeting_id,
    model_version,
    similarity,
    liveness_score,
    antispoof_score,
    matched
  )
  values (
    v_actor,
    p_meeting_id,
    v_template.model_version,
    v_similarity,
    p_liveness_score,
    p_antispoof_score,
    v_similarity >= 0.55
      and p_liveness_score >= 0.25
      and p_antispoof_score >= 0.25
  );

  similarity := v_similarity;
  matched := v_similarity >= 0.55
    and p_liveness_score >= 0.25
    and p_antispoof_score >= 0.25;
  liveness_score := p_liveness_score;
  antispoof_score := p_antispoof_score;
  return next;
end;
$$;

create or replace function public.verify_my_face_for_meeting(
  p_meeting_id uuid,
  p_embedding double precision[],
  p_model_version text,
  p_liveness_score double precision,
  p_antispoof_score double precision
)
returns table (
  similarity double precision,
  matched boolean,
  liveness_score double precision,
  antispoof_score double precision
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.verify_my_face_for_meeting_impl(
    p_meeting_id,
    p_embedding,
    p_model_version,
    p_liveness_score,
    p_antispoof_score
  )
$$;

revoke all on function private.enroll_my_face_impl(double precision[], text, integer)
from public, anon, authenticated;
revoke all on function private.delete_my_face_impl()
from public, anon, authenticated;
revoke all on function private.my_face_enrollment_status_impl()
from public, anon, authenticated;
revoke all on function private.verify_my_face_for_meeting_impl(uuid, double precision[], text, double precision, double precision)
from public, anon, authenticated;

revoke all on function public.enroll_my_face(double precision[], text, integer)
from public, anon, authenticated;
revoke all on function public.delete_my_face()
from public, anon, authenticated;
revoke all on function public.my_face_enrollment_status()
from public, anon, authenticated;
revoke all on function public.verify_my_face_for_meeting(uuid, double precision[], text, double precision, double precision)
from public, anon, authenticated;

grant execute on function private.enroll_my_face_impl(double precision[], text, integer)
to authenticated;
grant execute on function private.delete_my_face_impl()
to authenticated;
grant execute on function private.my_face_enrollment_status_impl()
to authenticated;
grant execute on function private.verify_my_face_for_meeting_impl(uuid, double precision[], text, double precision, double precision)
to authenticated;
grant execute on function public.enroll_my_face(double precision[], text, integer)
to authenticated;
grant execute on function public.delete_my_face()
to authenticated;
grant execute on function public.my_face_enrollment_status()
to authenticated;
grant execute on function public.verify_my_face_for_meeting(uuid, double precision[], text, double precision, double precision)
to authenticated;

-- Existing submissions remain historical evidence. New submissions record the
-- matching decision and model quality scores.
alter table public.attendance_records
  add column face_verified boolean not null default false,
  add column face_similarity double precision check (face_similarity is null or face_similarity between -1 and 1),
  add column face_liveness_score double precision check (face_liveness_score is null or face_liveness_score between 0 and 1),
  add column face_antispoof_score double precision check (face_antispoof_score is null or face_antispoof_score between 0 and 1),
  add column face_model_version text check (face_model_version is null or char_length(face_model_version) between 3 and 100);

alter table public.attendance_records
  drop constraint if exists attendance_records_verification_consistency;

update public.attendance_records
set verification_status = 'approved'::public.attendance_verification_status,
    status = 'present'::public.attendance_status,
    reviewed_by = null,
    reviewed_at = null
where source = 'self_check'::public.attendance_source
  and verification_status = 'pending'::public.attendance_verification_status;

alter table public.attendance_records
  add constraint attendance_records_verification_consistency check (
    (
      source = 'teacher'::public.attendance_source
      and verification_status is null
      and reviewed_by is null
      and reviewed_at is null
    )
    or
    (
      source = 'self_check'::public.attendance_source
      and (
        (
          verification_status = 'approved'::public.attendance_verification_status
          and status = 'present'::public.attendance_status
          and ((reviewed_by is null) = (reviewed_at is null))
        )
        or
        (
          verification_status = 'rejected'::public.attendance_verification_status
          and status = 'absent'::public.attendance_status
          and reviewed_by is not null
          and reviewed_at is not null
        )
      )
    )
  );

drop index if exists public.attendance_records_pending_review_idx;
create index attendance_records_self_check_status_idx
on public.attendance_records (meeting_id, verification_status, submitted_at desc)
where source = 'self_check'::public.attendance_source;

-- Manual attendance is valid only for manual meetings and can never replace a
-- self-check row (which would orphan its protected photo evidence).
create or replace function private.record_manual_attendance_impl(
  p_meeting_id uuid,
  p_student_id uuid,
  p_status public.attendance_status,
  p_note text
)
returns public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_meeting public.meetings%rowtype;
  v_record public.attendance_records%rowtype;
begin
  select meeting.* into v_meeting
  from public.meetings meeting
  where meeting.id = p_meeting_id;

  if not found then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;

  if v_actor is null or not private.teacher_owns_class(v_meeting.class_id) then
    raise exception 'Only this class teacher can record attendance'
      using errcode = '42501';
  end if;

  if not v_meeting.attendance_enabled then
    raise exception 'Attendance is disabled for this meeting' using errcode = '22023';
  end if;

  if v_meeting.attendance_mode <> 'teacher_manual'::public.attendance_mode then
    raise exception 'Use the evidence controls for a student self-check meeting'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.class_enrollments enrollment
    join public.profiles profile
      on profile.id = enrollment.student_id
     and profile.role = 'student'::public.app_role
    where enrollment.class_id = v_meeting.class_id
      and enrollment.student_id = p_student_id
      and enrollment.is_active
  ) then
    raise exception 'The student is not actively enrolled in this class'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.attendance_records attendance
    where attendance.meeting_id = p_meeting_id
      and attendance.student_id = p_student_id
      and attendance.source = 'self_check'::public.attendance_source
  ) then
    raise exception 'A self-check record cannot be replaced by manual attendance'
      using errcode = '22023';
  end if;

  insert into public.attendance_records (
    meeting_id,
    student_id,
    status,
    source,
    recorded_by,
    teacher_note,
    verification_status,
    reviewed_by,
    reviewed_at,
    review_note
  )
  values (
    p_meeting_id,
    p_student_id,
    p_status,
    'teacher'::public.attendance_source,
    v_actor,
    nullif(btrim(p_note), ''),
    null,
    null,
    null,
    null
  )
  on conflict (meeting_id, student_id) do update
    set status = excluded.status,
        recorded_by = excluded.recorded_by,
        teacher_note = excluded.teacher_note,
        submitted_at = now(),
        updated_at = now()
    where public.attendance_records.source = 'teacher'::public.attendance_source
  returning * into v_record;

  if v_record.id is null then
    raise exception 'A self-check record cannot be replaced by manual attendance'
      using errcode = '22023';
  end if;

  return v_record;
end;
$$;

create or replace function private.submit_self_attendance_impl(
  p_meeting_id uuid,
  p_selfie_path text,
  p_raw_barcode text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision
)
returns public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_barcode text := btrim(p_raw_barcode);
  v_meeting public.meetings%rowtype;
  v_face private.face_verification_sessions%rowtype;
  v_distance double precision;
  v_record public.attendance_records%rowtype;
begin
  if v_actor is null or private.current_profile_role() <> 'student' then
    raise exception 'Only a signed-in student can submit self-attendance'
      using errcode = '42501';
  end if;

  select meeting.* into v_meeting
  from public.meetings meeting
  where meeting.id = p_meeting_id;

  if not found then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.class_enrollments enrollment
    where enrollment.class_id = v_meeting.class_id
      and enrollment.student_id = v_actor
      and enrollment.is_active
  ) then
    raise exception 'You are not enrolled in this class' using errcode = '42501';
  end if;

  if not v_meeting.attendance_enabled then
    raise exception 'Attendance is disabled for this meeting' using errcode = '22023';
  end if;

  if v_meeting.attendance_mode not in (
    'self_on_site'::public.attendance_mode,
    'self_online'::public.attendance_mode
  ) then
    raise exception 'This meeting does not allow student self-check'
      using errcode = '22023';
  end if;

  if now() not between v_meeting.attendance_opens_at and v_meeting.attendance_closes_at then
    raise exception 'The attendance window is not open' using errcode = '22023';
  end if;

  select verification.* into v_face
  from private.face_verification_sessions verification
  where verification.student_id = v_actor
    and verification.meeting_id = p_meeting_id
    and verification.matched
    and verification.consumed_at is null
    and verification.expires_at > now()
  order by verification.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Complete face verification before submitting attendance'
      using errcode = '42501';
  end if;

  if p_selfie_path is null
     or p_selfie_path not like v_actor::text || '/' || p_meeting_id::text || '/%'
     or position('..' in p_selfie_path) > 0
     or char_length(p_selfie_path) > 1024 then
    raise exception 'A valid selfie upload is required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'attendance-selfies'
      and object.name = p_selfie_path
  ) then
    raise exception 'The selfie upload was not found' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.attendance_records attendance
    where attendance.meeting_id = p_meeting_id
      and attendance.student_id = v_actor
  ) then
    raise exception 'Attendance has already been recorded for this meeting'
      using errcode = '23505';
  end if;

  if v_meeting.attendance_mode = 'self_on_site'::public.attendance_mode then
    if v_barcode is null
       or char_length(v_barcode) not between 4 and 256
       or v_barcode ~ '[[:cntrl:]]'
       or not exists (
         select 1
         from private.student_credentials credential
         where credential.student_id = v_actor
           and credential.barcode_hash = encode(extensions.digest(v_barcode, 'sha256'), 'hex')
       ) then
      raise exception 'The scanned student ID does not match this account'
        using errcode = '42501';
    end if;

    if p_latitude is null or p_longitude is null or p_accuracy_m is null then
      raise exception 'A precise location is required' using errcode = '22023';
    end if;

    if p_latitude not between -90 and 90
       or p_longitude not between -180 and 180
       or p_accuracy_m < 0
       or p_accuracy_m > v_meeting.max_accuracy_m then
      raise exception 'Location accuracy does not meet this meeting requirement'
        using errcode = '22023';
    end if;

    v_distance := private.distance_m(
      v_meeting.latitude,
      v_meeting.longitude,
      p_latitude,
      p_longitude
    );

    if v_distance > v_meeting.radius_m then
      raise exception 'You are outside the allowed attendance location'
        using errcode = '22023';
    end if;
  else
    v_distance := null;
  end if;

  insert into public.attendance_records (
    meeting_id,
    student_id,
    status,
    source,
    selfie_path,
    latitude,
    longitude,
    accuracy_m,
    distance_m,
    barcode_verified,
    recorded_by,
    verification_status,
    face_verified,
    face_similarity,
    face_liveness_score,
    face_antispoof_score,
    face_model_version,
    submitted_at
  )
  values (
    p_meeting_id,
    v_actor,
    'present'::public.attendance_status,
    'self_check'::public.attendance_source,
    p_selfie_path,
    case when v_meeting.attendance_mode = 'self_online'::public.attendance_mode then null else p_latitude end,
    case when v_meeting.attendance_mode = 'self_online'::public.attendance_mode then null else p_longitude end,
    case when v_meeting.attendance_mode = 'self_online'::public.attendance_mode then null else p_accuracy_m end,
    v_distance,
    v_meeting.attendance_mode = 'self_on_site'::public.attendance_mode,
    v_actor,
    'approved'::public.attendance_verification_status,
    true,
    v_face.similarity,
    v_face.liveness_score,
    v_face.antispoof_score,
    v_face.model_version,
    now()
  )
  returning * into v_record;

  update private.face_verification_sessions
  set consumed_at = now()
  where id = v_face.id;

  return v_record;
end;
$$;

create or replace function private.review_self_attendance_impl(
  p_attendance_id uuid,
  p_decision public.attendance_verification_status,
  p_note text
)
returns public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_class_id uuid;
  v_record public.attendance_records%rowtype;
begin
  if p_decision not in (
    'approved'::public.attendance_verification_status,
    'rejected'::public.attendance_verification_status
  ) then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;

  select meeting.class_id into v_class_id
  from public.attendance_records attendance
  join public.meetings meeting on meeting.id = attendance.meeting_id
  where attendance.id = p_attendance_id
    and attendance.source = 'self_check'::public.attendance_source;

  if not found then
    raise exception 'Self-check attendance record not found' using errcode = 'P0002';
  end if;

  if v_actor is null or not private.teacher_owns_class(v_class_id) then
    raise exception 'Only this class teacher can change self-check evidence status'
      using errcode = '42501';
  end if;

  update public.attendance_records
  set verification_status = p_decision,
      status = case
        when p_decision = 'approved'::public.attendance_verification_status
          then 'present'::public.attendance_status
        else 'absent'::public.attendance_status
      end,
      reviewed_by = v_actor,
      reviewed_at = now(),
      review_note = nullif(btrim(p_note), ''),
      updated_at = now()
  where id = p_attendance_id
  returning * into v_record;

  return v_record;
end;
$$;

-- Only the two supported self-check modes may appear in the student feed or
-- receive uploads.
create or replace view public.student_available_meetings
with (security_invoker = true)
as
select
  meeting.id,
  meeting.class_id,
  class_row.name as class_name,
  meeting.title,
  meeting.meeting_date,
  meeting.starts_at,
  meeting.ends_at,
  meeting.attendance_mode,
  meeting.attendance_enabled,
  meeting.attendance_opens_at,
  meeting.attendance_closes_at,
  meeting.max_accuracy_m,
  attendance.status as existing_status,
  attendance.submitted_at
from public.meetings meeting
join public.classes class_row on class_row.id = meeting.class_id
join public.class_enrollments enrollment
  on enrollment.class_id = meeting.class_id
 and enrollment.student_id = (select auth.uid())
 and enrollment.is_active
left join public.attendance_records attendance
  on attendance.meeting_id = meeting.id
 and attendance.student_id = enrollment.student_id
where meeting.attendance_enabled
  and meeting.attendance_mode in (
    'self_on_site'::public.attendance_mode,
    'self_online'::public.attendance_mode
  )
  and now() between meeting.attendance_opens_at and meeting.attendance_closes_at;

revoke all on table public.student_available_meetings from public, anon, authenticated;
grant select on table public.student_available_meetings to authenticated;

drop policy if exists attendance_selfies_student_insert on storage.objects;
create policy attendance_selfies_student_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'attendance-selfies'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png')
  and exists (
    select 1
    from public.meetings meeting
    join public.class_enrollments enrollment on enrollment.class_id = meeting.class_id
    where meeting.id::text = (storage.foldername(name))[2]
      and enrollment.student_id = (select auth.uid())
      and enrollment.is_active
      and meeting.attendance_enabled
      and meeting.attendance_mode in (
        'self_on_site'::public.attendance_mode,
        'self_online'::public.attendance_mode
      )
      and now() between meeting.attendance_opens_at and meeting.attendance_closes_at
  )
);

comment on table private.student_face_templates is
  'Private biometric face embeddings for student-owned attendance verification; raw enrollment photos are not stored.';
comment on column public.attendance_records.face_verified is
  'True when a recent server-authorized face-template match preceded this self-check.';

-- Verification proofs are intentionally short-lived. Periodic deletion keeps
-- biometric-derived audit data from accumulating after it can no longer be
-- consumed by submit_self_attendance.
create or replace function private.cleanup_expired_face_verification_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  delete from private.face_verification_sessions verification
  where verification.expires_at <= now();

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function private.cleanup_expired_face_verification_sessions()
from public, anon, authenticated;
grant execute on function private.cleanup_expired_face_verification_sessions()
to service_role;

do $face_cleanup_cron$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'attendance-cleanup-face-verification-sessions';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'attendance-cleanup-face-verification-sessions',
    '*/15 * * * *',
    $job$select private.cleanup_expired_face_verification_sessions();$job$
  );
end;
$face_cleanup_cron$;
