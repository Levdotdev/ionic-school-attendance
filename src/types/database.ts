export type AppRole = 'admin' | 'teacher' | 'student' | 'parent'
export type TeacherApprovalStatus = 'pending' | 'approved' | 'rejected'

export type AttendanceMode =
  | 'teacher_manual'
  | 'self_on_site'
  | 'self_event'
  | 'self_online'

export type AttendanceStatus = 'present' | 'absent'
export type AttendanceSource = 'teacher' | 'self_check'
export type AttendanceVerificationStatus = 'pending' | 'approved' | 'rejected'

export interface Profile {
  id: string
  role: AppRole
  full_name: string
  email: string
  teacher_approval_status: TeacherApprovalStatus | null
  teacher_approval_note: string | null
  teacher_approved_at: string | null
  created_at: string
  updated_at: string
}

export interface StudentProfile {
  user_id: string
  guardian_email: string | null
  registration_completed_at: string
  created_at: string
  updated_at: string
}
