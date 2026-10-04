-- Keep the teacher queue and approval-review foreign key efficient.
drop index if exists public.profiles_teacher_approval_queue_idx;

create index profiles_teacher_approval_queue_idx
on public.profiles (created_at desc)
where role = 'teacher';

create index profiles_teacher_approved_by_idx
on public.profiles (teacher_approved_by)
where teacher_approved_by is not null;

-- Consolidate admin profile visibility into the existing SELECT policy and
-- require the parent's currently confirmed Auth email to still match the
-- verified guardian link for every parent-facing access path.
create or replace function private.can_access_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.classes c
        join public.profiles teacher
          on teacher.id = c.teacher_id
         and teacher.role = 'teacher'
         and teacher.teacher_approval_status = 'approved'
        where c.id = p_class_id
          and c.teacher_id = (select auth.uid())
      )
      or exists (
        select 1 from public.class_enrollments ce
        where ce.class_id = p_class_id
          and ce.student_id = (select auth.uid())
          and ce.is_active
      )
      or exists (
        select 1
        from public.guardian_links gl
        join public.class_enrollments ce
          on ce.student_id = gl.student_id
         and ce.class_id = p_class_id
         and ce.is_active
        join public.profiles parent_profile
          on parent_profile.id = gl.parent_id
         and parent_profile.role = 'parent'
        join auth.users parent_auth on parent_auth.id = gl.parent_id
        where gl.parent_id = (select auth.uid())
          and parent_auth.email_confirmed_at is not null
          and lower(parent_auth.email) = gl.verified_guardian_email
      )
    )
$$;

create or replace function private.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      p_profile_id = (select auth.uid())
      or exists (
        select 1
        from public.profiles admin_profile
        where admin_profile.id = (select auth.uid())
          and admin_profile.role = 'admin'
      )
      or exists (
        select 1
        from public.class_enrollments ce
        join public.classes c on c.id = ce.class_id
        where ce.is_active
          and (
            (
              c.teacher_id = (select auth.uid())
              and ce.student_id = p_profile_id
              and exists (
                select 1
                from public.profiles teacher
                where teacher.id = (select auth.uid())
                  and teacher.role = 'teacher'
                  and teacher.teacher_approval_status = 'approved'
              )
            )
            or (
              ce.student_id = (select auth.uid())
              and c.teacher_id = p_profile_id
            )
          )
      )
      or (select private.parent_has_student(p_profile_id))
    )
$$;

create or replace function private.can_access_attendance(
  p_meeting_id uuid,
  p_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      p_student_id = (select auth.uid())
      or exists (
        select 1
        from public.meetings m
        join public.classes c on c.id = m.class_id
        join public.profiles teacher
          on teacher.id = c.teacher_id
         and teacher.role = 'teacher'
         and teacher.teacher_approval_status = 'approved'
        where m.id = p_meeting_id
          and c.teacher_id = (select auth.uid())
      )
      or (select private.parent_has_student(p_student_id))
    )
$$;

drop policy if exists profiles_select_admin on public.profiles;
