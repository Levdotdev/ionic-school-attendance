-- Make the intentional client deny posture explicit for biometric tables.
-- Direct table access is revoked; students use actor-bound public RPCs only.

drop policy if exists student_face_templates_deny_clients
on private.student_face_templates;
create policy student_face_templates_deny_clients
on private.student_face_templates
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists face_verification_sessions_deny_clients
on private.face_verification_sessions;
create policy face_verification_sessions_deny_clients
on private.face_verification_sessions
for all
to anon, authenticated
using (false)
with check (false);
