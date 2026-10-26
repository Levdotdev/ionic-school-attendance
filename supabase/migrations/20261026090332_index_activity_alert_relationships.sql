-- Cover parent-row deletion checks and attendance recipient lookups without
-- scanning the delivery/state queues as attendance history grows.
create index activity_alert_deliveries_meeting_idx
  on private.activity_alert_deliveries(meeting_id);
create index attendance_alert_state_student_idx
  on private.attendance_alert_state(student_id);
