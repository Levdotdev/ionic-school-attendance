-- Student task planner.
--
-- Courses are first-class task groupings through student_tasks.class_id.
-- Students may alternatively use one of their own custom categories. Task
-- links, private file metadata, and recurring occurrence exceptions are kept
-- normalized so they can be edited independently without duplicating tasks.

create type public.student_task_priority as enum ('low', 'medium', 'high');
create type public.student_task_recurrence as enum (
  'none',
  'daily',
  'weekdays',
  'weekly',
  'monthly'
);
create type public.student_task_occurrence_status as enum ('completed', 'skipped');

create table public.student_task_categories (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null
    references public.profiles (id) on delete cascade,
  name text not null
    check (char_length(btrim(name)) between 1 and 60),
  color text not null default '#087443'
    check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index student_task_categories_student_name_uidx
on public.student_task_categories (student_id, lower(btrim(name)));

create table public.student_tasks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null
    references public.profiles (id) on delete cascade,
  class_id uuid
    references public.classes (id) on delete set null,
  category_id uuid
    references public.student_task_categories (id) on delete set null,
  title text not null
    check (char_length(btrim(title)) between 1 and 160),
  description text not null default ''
    check (char_length(description) <= 5000),
  due_at timestamptz not null,
  priority public.student_task_priority not null default 'medium',
  recurrence public.student_task_recurrence not null default 'none',
  recurrence_until timestamptz,
  reminder_minutes smallint[] not null default '{}'::smallint[],
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_tasks_one_grouping check (
    num_nonnulls(class_id, category_id) <= 1
  ),
  constraint student_tasks_recurrence_until_after_due check (
    recurrence_until is null or recurrence_until > due_at
  ),
  constraint student_tasks_reminders_supported check (
    reminder_minutes <@ array[5, 15, 30, 60, 1440]::smallint[]
  )
);

create table public.student_task_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null
    references public.student_tasks (id) on delete cascade,
  title text not null
    check (char_length(btrim(title)) between 1 and 160),
  url text not null
    check (
      char_length(url) between 8 and 2048
      and (url ~* '^https://[^[:space:]]+$' or url ~* '^http://[^[:space:]]+$')
    ),
  position smallint not null default 0
    check (position >= 0),
  created_at timestamptz not null default now()
);

create table public.student_task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null
    references public.student_tasks (id) on delete cascade,
  storage_path text not null unique
    check (
      char_length(storage_path) between 5 and 1024
      and storage_path not like '/%'
      and storage_path not like '%\\%'
      and storage_path not like '%..%'
    ),
  file_name text not null
    check (char_length(btrim(file_name)) between 1 and 255),
  mime_type text
    check (mime_type is null or char_length(mime_type) <= 160),
  size_bytes bigint not null
    check (size_bytes between 1 and 5242880),
  position smallint not null default 0
    check (position >= 0),
  created_at timestamptz not null default now()
);

-- A missing occurrence row means pending. Only completed and intentionally
-- skipped dates are persisted, which keeps an indefinitely recurring task
-- bounded while preserving each exception.
create table public.student_task_occurrences (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null
    references public.student_tasks (id) on delete cascade,
  due_at timestamptz not null,
  status public.student_task_occurrence_status not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, due_at),
  constraint student_task_occurrences_completion_consistency check (
    (status = 'completed' and completed_at is not null)
    or (status = 'skipped' and completed_at is null)
  )
);

comment on table public.student_task_categories is
  'Student-owned custom task categories. Enrolled classes are used directly for course/subject grouping.';
comment on table public.student_task_occurrences is
  'Completion and skipped-date exceptions for both single and recurring student tasks.';

-- Foreign keys are not indexed automatically. The owner/due index also
-- supports the task dashboard's most common range and ordering query.
create index student_tasks_student_due_idx
on public.student_tasks (student_id, due_at, id);
create index student_tasks_class_id_idx
on public.student_tasks (class_id) where class_id is not null;
create index student_tasks_category_id_idx
on public.student_tasks (category_id) where category_id is not null;
create index student_task_links_task_position_idx
on public.student_task_links (task_id, position, id);
create index student_task_files_task_position_idx
on public.student_task_files (task_id, position, id);
-- The occurrence unique constraint already supplies (task_id, due_at).

create trigger student_task_categories_set_updated_at
before update on public.student_task_categories
for each row execute function private.set_updated_at();

create trigger student_tasks_set_updated_at
before update on public.student_tasks
for each row execute function private.set_updated_at();

create trigger student_task_occurrences_set_updated_at
before update on public.student_task_occurrences
for each row execute function private.set_updated_at();

alter table public.student_task_categories enable row level security;
alter table public.student_tasks enable row level security;
alter table public.student_task_links enable row level security;
alter table public.student_task_files enable row level security;
alter table public.student_task_occurrences enable row level security;

create policy student_task_categories_select_own
on public.student_task_categories
for select
to authenticated
using (
  student_id = (select auth.uid())
  and (select private.current_profile_role()) = 'student'
);

create policy student_task_categories_insert_own
on public.student_task_categories
for insert
to authenticated
with check (
  student_id = (select auth.uid())
  and (select private.current_profile_role()) = 'student'
);

create policy student_task_categories_update_own
on public.student_task_categories
for update
to authenticated
using (
  student_id = (select auth.uid())
  and (select private.current_profile_role()) = 'student'
)
with check (
  student_id = (select auth.uid())
  and (select private.current_profile_role()) = 'student'
);

create policy student_task_categories_delete_own
on public.student_task_categories
for delete
to authenticated
using (
  student_id = (select auth.uid())
  and (select private.current_profile_role()) = 'student'
);

create policy student_tasks_select_own
on public.student_tasks
for select
to authenticated
using (
  student_id = (select auth.uid())
  and (select private.current_profile_role()) = 'student'
);

create policy student_tasks_insert_own
on public.student_tasks
for insert
to authenticated
with check (
  student_id = (select auth.uid())
  and (select private.current_profile_role()) = 'student'
  and (class_id is null or (select private.student_in_class(class_id)))
  and (
    category_id is null
    or exists (
      select 1
      from public.student_task_categories category_row
      where category_row.id = category_id
        and category_row.student_id = (select auth.uid())
    )
  )
);

create policy student_tasks_update_own
on public.student_tasks
for update
to authenticated
using (
  student_id = (select auth.uid())
  and (select private.current_profile_role()) = 'student'
)
with check (
  student_id = (select auth.uid())
  and (select private.current_profile_role()) = 'student'
  and (class_id is null or (select private.student_in_class(class_id)))
  and (
    category_id is null
    or exists (
      select 1
      from public.student_task_categories category_row
      where category_row.id = category_id
        and category_row.student_id = (select auth.uid())
    )
  )
);

create policy student_tasks_delete_own
on public.student_tasks
for delete
to authenticated
using (
  student_id = (select auth.uid())
  and (select private.current_profile_role()) = 'student'
);

create policy student_task_links_select_own
on public.student_task_links
for select
to authenticated
using (
  exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = task_id
      and task_row.student_id = (select auth.uid())
  )
);

create policy student_task_links_insert_own
on public.student_task_links
for insert
to authenticated
with check (
  exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = task_id
      and task_row.student_id = (select auth.uid())
  )
);

create policy student_task_links_update_own
on public.student_task_links
for update
to authenticated
using (
  exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = task_id
      and task_row.student_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = task_id
      and task_row.student_id = (select auth.uid())
  )
);

create policy student_task_links_delete_own
on public.student_task_links
for delete
to authenticated
using (
  exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = task_id
      and task_row.student_id = (select auth.uid())
  )
);

create policy student_task_files_select_own
on public.student_task_files
for select
to authenticated
using (
  exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = task_id
      and task_row.student_id = (select auth.uid())
  )
);

create policy student_task_files_insert_own
on public.student_task_files
for insert
to authenticated
with check (
  split_part(storage_path, '/', 1) = (select auth.uid())::text
  and split_part(storage_path, '/', 2) = task_id::text
  and exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = task_id
      and task_row.student_id = (select auth.uid())
  )
);

create policy student_task_files_delete_own
on public.student_task_files
for delete
to authenticated
using (
  split_part(storage_path, '/', 1) = (select auth.uid())::text
  and exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = task_id
      and task_row.student_id = (select auth.uid())
  )
);

create policy student_task_occurrences_select_own
on public.student_task_occurrences
for select
to authenticated
using (
  exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = task_id
      and task_row.student_id = (select auth.uid())
  )
);

create policy student_task_occurrences_insert_own
on public.student_task_occurrences
for insert
to authenticated
with check (
  exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = task_id
      and task_row.student_id = (select auth.uid())
      and student_task_occurrences.due_at >= task_row.due_at
      and (
        task_row.recurrence_until is null
        or student_task_occurrences.due_at <= task_row.recurrence_until
      )
  )
);

create policy student_task_occurrences_update_own
on public.student_task_occurrences
for update
to authenticated
using (
  exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = task_id
      and task_row.student_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = task_id
      and task_row.student_id = (select auth.uid())
      and student_task_occurrences.due_at >= task_row.due_at
      and (
        task_row.recurrence_until is null
        or student_task_occurrences.due_at <= task_row.recurrence_until
      )
  )
);

create policy student_task_occurrences_delete_own
on public.student_task_occurrences
for delete
to authenticated
using (
  exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = task_id
      and task_row.student_id = (select auth.uid())
  )
);

-- Explicit grants are required for Data API exposure. RLS remains the second,
-- row-level authorization layer. Anonymous clients receive no task access.
revoke all on table public.student_task_categories from anon, authenticated;
revoke all on table public.student_tasks from anon, authenticated;
revoke all on table public.student_task_links from anon, authenticated;
revoke all on table public.student_task_files from anon, authenticated;
revoke all on table public.student_task_occurrences from anon, authenticated;

grant select, insert, update, delete
on table public.student_task_categories to authenticated;
grant select, insert, update, delete
on table public.student_tasks to authenticated;
grant select, insert, update, delete
on table public.student_task_links to authenticated;
grant select, insert, delete
on table public.student_task_files to authenticated;
grant select, insert, update, delete
on table public.student_task_occurrences to authenticated;

grant all on table public.student_task_categories to service_role;
grant all on table public.student_tasks to service_role;
grant all on table public.student_task_links to service_role;
grant all on table public.student_task_files to service_role;
grant all on table public.student_task_occurrences to service_role;

grant usage on type public.student_task_priority to authenticated, service_role;
grant usage on type public.student_task_recurrence to authenticated, service_role;
grant usage on type public.student_task_occurrence_status to authenticated, service_role;

-- Attachments are private and addressable only under the signed-in student's
-- first path segment. File rows additionally require an owned task.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'student-task-files',
  'student-task-files',
  false,
  5242880,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy student_task_files_storage_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'student-task-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.current_profile_role()) = 'student'
  and coalesce((storage.foldername(name))[2], '')
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = ((storage.foldername(name))[2])::uuid
      and task_row.student_id = (select auth.uid())
  )
);

create policy student_task_files_storage_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'student-task-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.current_profile_role()) = 'student'
  and coalesce((storage.foldername(name))[2], '')
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.student_tasks task_row
    where task_row.id = ((storage.foldername(name))[2])::uuid
      and task_row.student_id = (select auth.uid())
  )
);

create policy student_task_files_storage_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'student-task-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.current_profile_role()) = 'student'
);
