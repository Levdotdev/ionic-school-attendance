<template>
  <ion-page class="teacher-page">
    <ion-header class="app-header">
      <ion-toolbar class="app-toolbar">
        <ion-title>
          <span class="brand-lockup">
            <span class="brand-mark" aria-hidden="true">M</span>
            <span>
              <strong>MinSU Attendance</strong>
              <small>Teacher portal</small>
            </span>
          </span>
        </ion-title>
        <ion-buttons slot="end">
          <ion-button class="sign-out-button" :disabled="signingOut" @click="logout">
            {{ signingOut ? 'Signing out…' : 'Sign out' }}
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="teacher-content">
      <main class="dashboard-shell">
        <div v-if="approvalLoading" class="centered" role="status" aria-label="Loading teacher dashboard">
          <ion-spinner name="crescent" />
          <span>Preparing your dashboard…</span>
        </div>

        <ion-card v-else-if="!teacherApproved" class="approval-card surface-card">
          <ion-card-content>
            <div class="approval-icon" :class="{ rejected: teacherApprovalStatus === 'rejected' }" aria-hidden="true">
              {{ teacherApprovalStatus === 'rejected' ? '!' : '✓' }}
            </div>
            <p class="eyebrow">Teacher access</p>
            <h1>{{ teacherApprovalStatus === 'rejected' ? 'Registration not approved' : 'Approval pending' }}</h1>
            <ion-badge :color="teacherApprovalStatus === 'rejected' ? 'danger' : 'warning'">
              {{ teacherApprovalStatus === 'rejected' ? 'Rejected' : 'Pending review' }}
            </ion-badge>
            <p v-if="teacherApprovalStatus === 'rejected'" class="approval-copy">
              Your teacher registration was not approved. Contact the school administrator if you need the decision reviewed.
            </p>
            <p v-else class="approval-copy">
              An administrator must approve your teacher registration before you can create classes or manage attendance.
            </p>
            <p v-if="teacherApprovalNote" class="admin-note"><strong>Administrator note:</strong> {{ teacherApprovalNote }}</p>
            <div
              v-if="message"
              class="status-message approval-message"
              :class="messageKind"
              :role="messageKind === 'error' ? 'alert' : 'status'"
              aria-live="polite"
            >
              <span class="status-message-icon" aria-hidden="true">{{ messageKind === 'error' ? '!' : '✓' }}</span>
              <span>{{ message }}</span>
            </div>
            <ion-button fill="outline" @click="checkApprovalStatus">Check approval status</ion-button>
          </ion-card-content>
        </ion-card>

        <template v-else>
          <section class="dashboard-heading" aria-labelledby="teacher-dashboard-title">
            <div>
              <p class="eyebrow">Teacher dashboard</p>
              <h1 id="teacher-dashboard-title">Welcome back, {{ profile?.full_name || 'Teacher' }}</h1>
              <p>Manage attendance, schedules, and student evidence for the current school week.</p>
            </div>
            <div class="week-chip">
              <span>This school week</span>
              <strong>{{ displayDate(week.startDate) }} – {{ displayDate(week.endDateInclusive) }}</strong>
            </div>
          </section>

          <div
            v-if="message"
            class="status-message"
            :class="messageKind"
            :role="messageKind === 'error' ? 'alert' : 'status'"
            aria-live="polite"
          >
            <span class="status-message-icon" aria-hidden="true">{{ messageKind === 'error' ? '!' : '✓' }}</span>
            <span>{{ message }}</span>
          </div>

          <section class="surface-card class-workspace" aria-labelledby="class-workspace-title">
            <div class="section-heading class-heading">
              <div>
                <p class="eyebrow">Class workspace</p>
                <h2 id="class-workspace-title">My classes</h2>
                <p>Select a class to manage this week’s attendance and planning.</p>
              </div>
              <ion-spinner v-if="loadingClasses" name="crescent" />
            </div>

            <div class="class-workspace-grid">
              <div class="class-selection">
                <ion-note v-if="!loadingClasses && classes.length === 0" class="empty-note">
                  No classes yet. Create your first class using the form.
                </ion-note>
                <div v-else-if="classes.length" class="select-shell">
                  <ion-select v-model="selectedClassId" label="Open class" label-placement="stacked" fill="outline">
                    <ion-select-option v-for="item in classes" :key="item.id" :value="item.id">
                      {{ item.name }}{{ item.section ? ` · ${item.section}` : '' }} ({{ item.join_code }})
                    </ion-select-option>
                  </ion-select>
                </div>

                <div v-if="activeClass" class="active-class-summary">
                  <div class="class-avatar" aria-hidden="true">{{ activeClass.name.charAt(0).toUpperCase() }}</div>
                  <div class="class-identity">
                    <strong>{{ activeClass.name }}</strong>
                    <span>{{ activeClass.section || 'No section specified' }}</span>
                  </div>
                  <div class="join-code-block">
                    <span>Student join code</span>
                    <strong>{{ activeClass.join_code }}</strong>
                  </div>
                </div>

                <div v-if="activeClass" class="row-actions class-actions">
                  <ion-button size="small" fill="outline" @click="beginClassEdit(activeClass)">Edit class</ion-button>
                  <ion-button size="small" fill="clear" color="danger" :disabled="savingClass" @click="deleteClass(activeClass)">
                    Delete class
                  </ion-button>
                </div>

                <div class="location-note">
                  <span class="location-pin" aria-hidden="true">⌖</span>
                  <span>School location is protected automatically within a {{ SCHOOL_RADIUS_M }}-meter boundary.</span>
                </div>
              </div>

              <form class="class-form" @submit.prevent="saveClass">
                <div class="form-heading">
                  <strong>{{ editingClassId ? 'Edit selected class' : classes.length ? 'Create another class' : 'Create your first class' }}</strong>
                  <span>{{ editingClassId ? 'Update its name or section.' : 'A secure join code is generated automatically.' }}</span>
                </div>
                <ion-input v-model="classForm.name" label="Class name" label-placement="stacked" fill="outline" required />
                <ion-input v-model="classForm.section" label="Section (optional)" label-placement="stacked" fill="outline" />
                <div class="form-actions">
                  <ion-button type="submit" :disabled="savingClass">
                    <ion-spinner v-if="savingClass" name="crescent" />
                    <span v-else>{{ editingClassId ? 'Save changes' : 'Create class' }}</span>
                  </ion-button>
                  <ion-button v-if="editingClassId" type="button" fill="outline" :disabled="savingClass" @click="cancelClassEdit">
                    Cancel
                  </ion-button>
                </div>
              </form>
            </div>
          </section>

          <template v-if="activeClass">
            <section class="stats-grid" aria-label="Attendance summary">
              <article class="stat-card present-stat">
                <span class="stat-icon" aria-hidden="true">✓</span>
                <div><span>Present</span><strong>{{ presentCount }}</strong></div>
              </article>
              <article class="stat-card absent-stat">
                <span class="stat-icon" aria-hidden="true">×</span>
                <div><span>Absent</span><strong>{{ absentCount }}</strong></div>
              </article>
              <article class="stat-card unchecked-stat">
                <span class="stat-icon" aria-hidden="true">…</span>
                <div><span>Unchecked</span><strong>{{ uncheckedCount }}</strong></div>
              </article>
              <article class="stat-card review-stat">
                <span class="stat-icon" aria-hidden="true">⌕</span>
                <div><span>Needs review</span><strong>{{ pendingEvidenceCount }}</strong></div>
              </article>
            </section>

            <section class="attendance-layout">
              <article class="surface-card attendance-card" aria-labelledby="student-attendance-title">
                <div class="section-heading attendance-heading">
                  <div>
                    <p class="eyebrow">Current meeting</p>
                    <h2 id="student-attendance-title">Student attendance</h2>
                    <p v-if="selectedMeeting">{{ formatDateTime(selectedMeeting.starts_at) }} · {{ modeLabel(selectedMeeting.attendance_mode) }}</p>
                    <p v-else>Select a meeting before marking attendance.</p>
                  </div>
                  <span
                    class="status-pill"
                    :class="selectedMeeting?.attendance_enabled ? 'open' : 'closed'"
                  >
                    <span aria-hidden="true"></span>
                    {{ selectedMeeting?.attendance_enabled ? 'Attendance active' : 'Attendance inactive' }}
                  </span>
                </div>

                <div v-if="meetings.length" class="meeting-selector select-shell">
                  <ion-select v-model="selectedMeetingId" label="This week’s meeting" label-placement="stacked" fill="outline">
                    <ion-select-option v-for="meeting in meetings" :key="meeting.id" :value="meeting.id">
                      {{ meeting.title }} · {{ formatDateTime(meeting.starts_at) }}
                    </ion-select-option>
                  </ion-select>
                </div>
                <div v-else class="empty-state compact-empty">
                  <span aria-hidden="true">＋</span>
                  <div><strong>No meeting this week</strong><p>Add a weekly schedule or create an additional meeting below.</p></div>
                </div>

                <div v-if="loadingDetails" class="inline-loading" role="status">
                  <ion-spinner name="crescent" />
                  <span>Loading students…</span>
                </div>
                <div v-else-if="students.length" class="student-list">
                  <div v-for="student in students" :key="student.id" class="student-row">
                    <div class="student-avatar" aria-hidden="true">{{ student.full_name.charAt(0).toUpperCase() }}</div>
                    <div class="student-copy">
                      <strong>{{ student.full_name }}</strong>
                      <span>{{ student.email || 'No email recorded' }}</span>
                      <ion-badge
                        v-if="attendanceByStudent[student.id]"
                        :color="statusColor(attendanceByStudent[student.id].status)"
                        class="attendance-badge"
                      >
                        {{ attendanceByStudent[student.id].status }}
                      </ion-badge>
                    </div>
                    <div class="attendance-buttons" role="group" :aria-label="`Mark attendance for ${student.full_name}`">
                      <ion-button
                        color="success"
                        size="small"
                        :aria-label="`Mark ${student.full_name} present`"
                        :aria-pressed="attendanceByStudent[student.id]?.status === 'present'"
                        :fill="attendanceByStudent[student.id]?.status === 'present' ? 'solid' : 'outline'"
                        :disabled="!canMarkAttendance || markingStudentId === student.id"
                        @click="markAttendance(student.id, 'present')"
                      >
                        Present
                      </ion-button>
                      <ion-button
                        color="danger"
                        size="small"
                        :aria-label="`Mark ${student.full_name} absent`"
                        :aria-pressed="attendanceByStudent[student.id]?.status === 'absent'"
                        :fill="attendanceByStudent[student.id]?.status === 'absent' ? 'solid' : 'outline'"
                        :disabled="!canMarkAttendance || markingStudentId === student.id"
                        @click="markAttendance(student.id, 'absent')"
                      >
                        Absent
                      </ion-button>
                    </div>
                  </div>
                </div>
                <div v-else class="empty-state">
                  <span aria-hidden="true">◎</span>
                  <div><strong>No enrolled students</strong><p>Students will appear here after joining this class.</p></div>
                </div>
              </article>

              <aside class="attendance-side">
                <section class="surface-card meeting-control" aria-labelledby="meeting-control-title">
                  <div class="section-heading">
                    <div><p class="eyebrow">Meeting control</p><h2 id="meeting-control-title">Attendance status</h2></div>
                  </div>
                  <template v-if="selectedMeeting">
                    <div class="badge-row">
                      <ion-badge :color="selectedMeeting.attendance_enabled ? 'success' : 'medium'">
                        {{ selectedMeeting.attendance_enabled ? 'Counts' : 'Does not count' }}
                      </ion-badge>
                      <ion-badge color="tertiary">{{ modeLabel(selectedMeeting.attendance_mode) }}</ion-badge>
                      <ion-badge v-if="selectedMeeting.schedule_id" color="primary">Weekly</ion-badge>
                    </div>
                    <div class="meeting-detail">
                      <strong>{{ selectedMeeting.title }}</strong>
                      <span>Check-in: {{ formatDateTime(selectedMeeting.attendance_opens_at) }}</span>
                      <span>Closes: {{ formatDateTime(selectedMeeting.attendance_closes_at) }}</span>
                    </div>
                    <ion-button
                      class="full-button"
                      :color="selectedMeeting.attendance_enabled ? 'warning' : 'success'"
                      fill="outline"
                      :disabled="updatingMeeting"
                      @click="toggleAttendance(selectedMeeting)"
                    >
                      {{ selectedMeeting.attendance_enabled ? 'Do not count this meeting' : 'Count this meeting' }}
                    </ion-button>
                    <div class="row-actions meeting-edit-actions">
                      <ion-button size="small" fill="outline" :disabled="updatingMeeting" @click="beginMeetingEdit(selectedMeeting)">
                        Edit meeting
                      </ion-button>
                      <ion-button size="small" fill="clear" color="danger" :disabled="updatingMeeting" @click="deleteMeeting(selectedMeeting)">
                        Delete
                      </ion-button>
                    </div>
                  </template>
                  <p v-else class="muted-copy">Create or select a meeting to manage whether attendance counts.</p>
                </section>

                <section class="surface-card week-overview" aria-labelledby="week-overview-title">
                  <div class="section-heading">
                    <div><p class="eyebrow">This week</p><h2 id="week-overview-title">Meeting overview</h2></div>
                    <span class="count-bubble">{{ meetings.length }}</span>
                  </div>
                  <div v-if="meetings.length" class="mini-meeting-list">
                    <button
                      v-for="meeting in meetings"
                      :key="meeting.id"
                      type="button"
                      class="mini-meeting"
                      :class="{ selected: meeting.id === selectedMeetingId }"
                      :aria-pressed="meeting.id === selectedMeetingId"
                      :aria-current="meeting.id === selectedMeetingId ? 'true' : undefined"
                      @click="selectedMeetingId = meeting.id"
                    >
                      <span class="mini-date">{{ formatDateTime(meeting.starts_at).split(',')[0] }}</span>
                      <span><strong>{{ meeting.title }}</strong><small>{{ modeLabel(meeting.attendance_mode) }}</small></span>
                    </button>
                  </div>
                  <p v-else class="muted-copy">No meetings are scheduled for this week.</p>
                </section>
              </aside>
            </section>

            <section class="planning-section" aria-labelledby="planning-title">
              <div class="planning-heading">
                <div><p class="eyebrow">Planning & management</p><h2 id="planning-title">Set up your class week</h2></div>
                <p>Weekly schedules create meetings automatically. Additional meetings are limited to the current week.</p>
              </div>

              <div class="planning-grid">
                <article class="surface-card schedule-card" aria-labelledby="weekly-schedule-title">
                  <div class="section-heading">
                    <div><p class="eyebrow">Repeats every week</p><h2 id="weekly-schedule-title">Weekly schedule</h2></div>
                    <span class="count-bubble">{{ schedules.length }}</span>
                  </div>
                  <p class="section-description">Each active schedule automatically creates one meeting for this week.</p>

                  <form class="form-grid schedule-form" @submit.prevent="saveSchedule">
                    <ion-select v-model="scheduleForm.day_of_week" label="Day" label-placement="stacked" fill="outline">
                      <ion-select-option v-for="day in weekdays" :key="day.value" :value="day.value">{{ day.label }}</ion-select-option>
                    </ion-select>
                    <ion-input v-model="scheduleForm.starts_at" label="Starts" label-placement="stacked" fill="outline" type="time" required />
                    <ion-input v-model="scheduleForm.ends_at" label="Ends" label-placement="stacked" fill="outline" type="time" required />
                    <ion-input v-model="scheduleForm.room" label="Room (optional)" label-placement="stacked" fill="outline" />
                    <div class="form-actions full-row">
                      <ion-button type="submit" :disabled="savingSchedule">{{ editingScheduleId ? 'Save schedule' : 'Add schedule' }}</ion-button>
                      <ion-button v-if="editingScheduleId" type="button" fill="outline" :disabled="savingSchedule" @click="cancelScheduleEdit">
                        Cancel
                      </ion-button>
                    </div>
                  </form>

                  <div v-if="schedules.length" class="schedule-list">
                    <div v-for="schedule in schedules" :key="schedule.id" class="schedule-row">
                      <span class="schedule-day">{{ dayLabel(schedule.day_of_week).slice(0, 3) }}</span>
                      <div class="schedule-copy">
                        <strong>{{ dayLabel(schedule.day_of_week) }} · {{ scheduleDateLabel(schedule.day_of_week) }}</strong>
                        <span>{{ formatTime(schedule.starts_at) }} – {{ formatTime(schedule.ends_at) }}<template v-if="schedule.room"> · {{ schedule.room }}</template></span>
                        <ion-badge v-if="!schedule.is_active" color="medium">Inactive</ion-badge>
                      </div>
                      <div class="item-actions">
                        <ion-button size="small" fill="clear" @click="beginScheduleEdit(schedule)">Edit</ion-button>
                        <ion-button size="small" fill="clear" color="danger" @click="deleteSchedule(schedule)">Delete</ion-button>
                      </div>
                    </div>
                  </div>
                  <div v-else class="empty-state compact-empty"><span aria-hidden="true">↻</span><div><strong>No weekly schedule</strong><p>Add the class’s regular day and time.</p></div></div>
                </article>

                <article class="surface-card meeting-form-card" aria-labelledby="meeting-form-title">
                  <div class="section-heading">
                    <div>
                      <p class="eyebrow">One-time adjustment</p>
                      <h2 id="meeting-form-title">{{ editingMeetingId ? 'Edit meeting' : 'Additional meeting' }}</h2>
                    </div>
                  </div>
                  <p class="section-description">Use this for events, online classes, or a meeting outside the regular schedule.</p>

                  <form class="form-grid meeting-form" @submit.prevent="saveMeeting">
                    <ion-input v-model="meetingForm.title" label="Meeting title" label-placement="stacked" fill="outline" required />
                    <ion-select v-model="meetingForm.mode" label="Attendance mode" label-placement="stacked" fill="outline">
                      <ion-select-option value="teacher_manual">Teacher marks attendance</ion-select-option>
                      <ion-select-option value="self_on_site">Student self-check on site</ion-select-option>
                      <ion-select-option value="self_event">Student self-check at an event</ion-select-option>
                      <ion-select-option value="self_online">Online class self-check</ion-select-option>
                    </ion-select>
                    <label class="native-field"><span>Meeting starts</span><input v-model="meetingForm.starts_at" type="datetime-local" :min="meetingInputMin" :max="meetingInputMax" required /></label>
                    <label class="native-field"><span>Meeting ends</span><input v-model="meetingForm.ends_at" type="datetime-local" :min="meetingInputMin" :max="meetingInputMax" required /></label>
                    <label class="native-field"><span>Check-in opens</span><input v-model="meetingForm.check_in_opens_at" type="datetime-local" :min="meetingInputMin" :max="meetingInputMax" required /></label>
                    <label class="native-field"><span>Check-in closes</span><input v-model="meetingForm.check_in_closes_at" type="datetime-local" :min="meetingInputMin" :max="meetingInputMax" required /></label>
                    <div class="location-note full-row">
                      <span class="location-pin" aria-hidden="true">⌖</span>
                      <span>Physical self-checks use the protected {{ SCHOOL_RADIUS_M }}-meter school boundary. Online checks do not request location.</span>
                    </div>
                    <div class="form-actions full-row">
                      <ion-button type="submit" :disabled="savingMeeting">{{ editingMeetingId ? 'Save meeting' : 'Create meeting' }}</ion-button>
                      <ion-button v-if="editingMeetingId" type="button" fill="outline" :disabled="savingMeeting" @click="cancelMeetingEdit">Cancel</ion-button>
                    </div>
                  </form>
                </article>
              </div>
            </section>

            <section class="surface-card evidence-section" aria-labelledby="evidence-title">
              <div class="section-heading">
                <div><p class="eyebrow">Student submissions</p><h2 id="evidence-title">Self-check verification</h2><p>Review photos and location evidence for the selected meeting.</p></div>
                <span class="count-bubble review-count">{{ evidenceRows.length }}</span>
              </div>
              <div v-if="evidenceRows.length === 0" class="empty-state">
                <span aria-hidden="true">⌕</span>
                <div><strong>No evidence to review</strong><p>Student self-check submissions will appear here.</p></div>
              </div>
              <div v-else class="evidence-grid">
                <article v-for="record in evidenceRows" :key="record.id" class="evidence-card">
                  <div class="evidence-main">
                    <img v-if="record.selfie_url" :src="record.selfie_url" :alt="`${studentName(record.student_id)} self-check selfie`" class="selfie" />
                    <div v-else class="selfie selfie-placeholder" role="img" :aria-label="record.selfie_path ? 'Submitted photo is unavailable' : 'No photo was submitted'">
                      {{ record.selfie_path ? 'Photo unavailable' : 'No photo' }}
                    </div>
                    <div class="evidence-copy">
                      <div class="evidence-title-row">
                        <h3>{{ studentName(record.student_id) }}</h3>
                        <ion-badge :color="verificationColor(record.verification_status)">{{ record.verification_status || 'not reviewed' }}</ion-badge>
                      </div>
                      <p><strong>Attendance:</strong> {{ record.status }}</p>
                      <p><strong>Submitted:</strong> {{ formatDateTime(record.submitted_at || record.created_at) }}</p>
                      <p v-if="record.distance_m != null"><strong>School distance:</strong> {{ Math.round(record.distance_m) }} m</p>
                      <a v-if="record.latitude != null && record.longitude != null" :href="mapUrl(record.latitude, record.longitude)" target="_blank" rel="noopener">View submitted location</a>
                    </div>
                  </div>
                  <ion-textarea v-model="record.review_note" label="Teacher note (optional)" label-placement="stacked" fill="outline" auto-grow />
                  <div class="review-buttons" role="group" :aria-label="`Review evidence for ${studentName(record.student_id)}`">
                    <ion-button
                      color="success"
                      size="small"
                      :aria-label="`Approve evidence for ${studentName(record.student_id)}`"
                      :aria-pressed="record.verification_status === 'approved'"
                      :disabled="reviewingRecordId === record.id"
                      @click="reviewEvidence(record, 'approved')"
                    >
                      Approve
                    </ion-button>
                    <ion-button
                      color="danger"
                      fill="outline"
                      size="small"
                      :aria-label="`Reject evidence for ${studentName(record.student_id)}`"
                      :aria-pressed="record.verification_status === 'rejected'"
                      :disabled="reviewingRecordId === record.id"
                      @click="reviewEvidence(record, 'rejected')"
                    >
                      Reject
                    </ion-button>
                  </div>
                </article>
              </div>
            </section>
          </template>
        </template>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonInput,
  IonNote,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { useSession } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'
import { toUserFacingErrorMessage } from '@/utils/errors'

type MeetingMode = 'teacher_manual' | 'self_on_site' | 'self_event' | 'self_online'
type AttendanceStatus = 'present' | 'absent'
type VerificationStatus = 'pending' | 'approved' | 'rejected'

interface ClassRow {
  id: string
  teacher_id: string
  join_code: string
  name: string
  section: string | null
  timezone: string
  default_latitude: number | null
  default_longitude: number | null
  default_radius_m: number
  default_max_accuracy_m: number
}

interface ScheduleRow {
  id: string
  class_id: string
  day_of_week: number
  starts_at: string
  ends_at: string
  room: string | null
  is_active: boolean
}

interface MeetingRow {
  id: string
  class_id: string
  schedule_id: string | null
  title: string
  starts_at: string
  ends_at: string
  attendance_mode: MeetingMode
  attendance_enabled: boolean
  attendance_opens_at: string
  attendance_closes_at: string
  latitude: number | null
  longitude: number | null
  radius_m: number | null
  max_accuracy_m: number | null
}

interface StudentRow {
  id: string
  full_name: string
  email: string | null
}

interface AttendanceRow {
  id: string
  meeting_id: string
  student_id: string
  status: AttendanceStatus
  source: string
  selfie_path: string | null
  selfie_url?: string | null
  latitude: number | null
  longitude: number | null
  distance_m: number | null
  verification_status: VerificationStatus | null
  teacher_note: string | null
  review_note: string | null
  submitted_at: string | null
  created_at: string
}

const SCHOOL_LATITUDE = 13.387419
const SCHOOL_LONGITUDE = 121.162494
const SCHOOL_RADIUS_M = 180
const MANILA_TIME_ZONE = 'Asia/Manila'

const weekdays = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

const router = useRouter()
const { initializeSession, refreshProfile, profile, signOut } = useSession()
const classes = ref<ClassRow[]>([])
const schedules = ref<ScheduleRow[]>([])
const meetings = ref<MeetingRow[]>([])
const students = ref<StudentRow[]>([])
const attendanceRecords = ref<AttendanceRow[]>([])
const selectedClassId = ref('')
const selectedMeetingId = ref('')
const editingClassId = ref('')
const editingScheduleId = ref('')
const editingMeetingId = ref('')
const approvalLoading = ref(true)
const loadingClasses = ref(true)
const loadingDetails = ref(false)
const savingClass = ref(false)
const savingSchedule = ref(false)
const savingMeeting = ref(false)
const updatingMeeting = ref(false)
const markingStudentId = ref('')
const reviewingRecordId = ref('')
const signingOut = ref(false)
const message = ref('')
const messageKind = ref<'success' | 'error'>('success')

const week = currentManilaWeek()
const meetingInputMin = `${week.startDate}T00:00`
const meetingInputMax = `${week.endDateInclusive}T23:59`

const classForm = reactive({ name: '', section: '' })
const scheduleForm = reactive({ day_of_week: 1, starts_at: '08:00', ends_at: '09:00', room: '' })
const meetingForm = reactive({
  title: '',
  mode: 'teacher_manual' as MeetingMode,
  starts_at: '',
  ends_at: '',
  check_in_opens_at: '',
  check_in_closes_at: '',
})

const activeClass = computed(() => classes.value.find((item) => item.id === selectedClassId.value) ?? null)
const selectedMeeting = computed(() => meetings.value.find((item) => item.id === selectedMeetingId.value) ?? null)
const attendanceByStudent = computed<Record<string, AttendanceRow>>(() =>
  Object.fromEntries(attendanceRecords.value.map((record) => [record.student_id, record])),
)
const evidenceRows = computed(() => attendanceRecords.value.filter((record) => record.source === 'self_check'))
const presentCount = computed(
  () =>
    attendanceRecords.value.filter(
      (record) =>
        record.status === 'present' &&
        (record.verification_status == null || record.verification_status === 'approved'),
    ).length,
)
const absentCount = computed(() => attendanceRecords.value.filter((record) => record.status === 'absent').length)
const uncheckedCount = computed(() => Math.max(students.value.length - attendanceRecords.value.length, 0))
const pendingEvidenceCount = computed(
  () => evidenceRows.value.filter((record) => record.verification_status === 'pending').length,
)
const canMarkAttendance = computed(() => Boolean(selectedMeeting.value?.attendance_enabled))
const teacherApproved = computed(
  () => profile.value?.role === 'teacher' && profile.value.teacher_approval_status === 'approved',
)
const teacherApprovalStatus = computed(() =>
  profile.value?.teacher_approval_status === 'rejected' ? 'rejected' : 'pending',
)
const teacherApprovalNote = computed(() => profile.value?.teacher_approval_note?.trim() || '')
const currentWeekLabel = computed(() => `This week: ${displayDate(week.startDate)} to ${displayDate(week.endDateInclusive)}`)

watch(selectedClassId, async (classId) => {
  if (editingClassId.value && editingClassId.value !== classId) cancelClassEdit()
  cancelScheduleEdit()
  cancelMeetingEdit()
  if (classId) await loadClassDetails(classId)
  else clearClassDetails()
})

watch(selectedMeetingId, async (meetingId) => {
  if (meetingId) await loadAttendance(meetingId)
  else attendanceRecords.value = []
})

onMounted(async () => {
  await initializeSession()
  await checkApprovalStatus()
})

async function checkApprovalStatus() {
  approvalLoading.value = true
  clearMessage()
  try {
    const currentProfile = await refreshProfile()
    if (!currentProfile) throw new Error('Unable to load your teacher registration.')

    if (currentProfile.role === 'teacher' && currentProfile.teacher_approval_status === 'approved') {
      await loadClasses()
    } else {
      loadingClasses.value = false
    }
  } catch (error) {
    loadingClasses.value = false
    showError(error)
  } finally {
    approvalLoading.value = false
  }
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) throw new Error('Please sign in as a teacher.')
  return data.user.id
}

async function loadClasses() {
  loadingClasses.value = true
  try {
    const teacherId = await currentUserId()
    const { data, error } = await supabase
      .from('classes')
      .select('id,teacher_id,join_code,name,section,timezone,default_latitude,default_longitude,default_radius_m,default_max_accuracy_m')
      .eq('teacher_id', teacherId)
      .order('created_at', { ascending: false })
    if (error) throw error

    classes.value = (data ?? []) as ClassRow[]
    if (!classes.value.some((item) => item.id === selectedClassId.value)) {
      selectedClassId.value = classes.value[0]?.id ?? ''
    }
  } catch (error) {
    showError(error)
  } finally {
    loadingClasses.value = false
  }
}

async function saveClass() {
  savingClass.value = true
  clearMessage()
  try {
    const name = classForm.name.trim()
    if (!name) throw new Error('Enter a class name.')

    if (editingClassId.value) {
      const { data, error } = await supabase
        .from('classes')
        .update({
          name,
          section: classForm.section.trim() || null,
          timezone: MANILA_TIME_ZONE,
        })
        .eq('id', editingClassId.value)
        .select('id,teacher_id,join_code,name,section,timezone,default_latitude,default_longitude,default_radius_m,default_max_accuracy_m')
        .single()
      if (error) throw error
      const index = classes.value.findIndex((item) => item.id === data.id)
      if (index >= 0) classes.value[index] = data as ClassRow
      cancelClassEdit()
      showSuccess('Class updated.')
      return
    }

    const { data, error } = await supabase.rpc('create_class', {
      p_name: name,
      p_section: classForm.section.trim() || null,
      p_timezone: MANILA_TIME_ZONE,
    })
    if (error) throw error
    const created = (Array.isArray(data) ? data[0] : data) as ClassRow | null
    resetClassForm()
    await loadClasses()
    if (created?.id) selectedClassId.value = created.id
    showSuccess(
      created?.join_code
        ? `Class created. Students can join with code ${created.join_code}.`
        : 'Class created. Its join code is shown in the class list.',
    )
  } catch (error) {
    showError(error)
  } finally {
    savingClass.value = false
  }
}

function beginClassEdit(item: ClassRow) {
  editingClassId.value = item.id
  classForm.name = item.name
  classForm.section = item.section ?? ''
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function cancelClassEdit() {
  editingClassId.value = ''
  resetClassForm()
}

function resetClassForm() {
  classForm.name = ''
  classForm.section = ''
}

async function deleteClass(item: ClassRow) {
  const confirmed = window.confirm(
    `Delete "${item.name}"? Its schedules, meetings, and attendance records will also be removed. This cannot be undone.`,
  )
  if (!confirmed) return

  savingClass.value = true
  clearMessage()
  try {
    const { error } = await supabase.from('classes').delete().eq('id', item.id)
    if (error) throw error
    if (editingClassId.value === item.id) cancelClassEdit()
    classes.value = classes.value.filter((entry) => entry.id !== item.id)
    selectedClassId.value = classes.value[0]?.id ?? ''
    showSuccess('Class deleted.')
  } catch (error) {
    showError(error)
  } finally {
    savingClass.value = false
  }
}

async function loadClassDetails(classId: string) {
  loadingDetails.value = true
  try {
    const { error: ensureError } = await supabase.rpc('ensure_current_week_meetings', { p_class_id: classId })
    if (ensureError) throw ensureError

    const [scheduleResult, meetingResult, enrollmentResult] = await Promise.all([
      supabase
        .from('class_schedules')
        .select('id,class_id,day_of_week,starts_at,ends_at,room,is_active')
        .eq('class_id', classId),
      supabase
        .from('meetings')
        .select('id,class_id,schedule_id,title,starts_at,ends_at,attendance_mode,attendance_enabled,attendance_opens_at,attendance_closes_at,latitude,longitude,radius_m,max_accuracy_m')
        .eq('class_id', classId)
        .gte('starts_at', week.startIso)
        .lt('starts_at', week.endIso)
        .order('starts_at'),
      supabase.from('class_enrollments').select('student_id').eq('class_id', classId).eq('is_active', true),
    ])
    if (scheduleResult.error) throw scheduleResult.error
    if (meetingResult.error) throw meetingResult.error
    if (enrollmentResult.error) throw enrollmentResult.error

    schedules.value = ((scheduleResult.data ?? []) as ScheduleRow[]).sort(
      (a, b) => scheduleSortValue(a) - scheduleSortValue(b) || a.starts_at.localeCompare(b.starts_at),
    )
    meetings.value = (meetingResult.data ?? []) as MeetingRow[]
    students.value = await loadStudents((enrollmentResult.data ?? []).map((row) => row.student_id))

    const previousMeetingId = selectedMeetingId.value
    const selectionStillExists = meetings.value.some((item) => item.id === previousMeetingId)
    selectedMeetingId.value = selectionStillExists ? previousMeetingId : meetings.value[0]?.id ?? ''
    if (selectedMeetingId.value && selectedMeetingId.value === previousMeetingId) {
      await loadAttendance(selectedMeetingId.value)
    } else if (!selectedMeetingId.value) {
      attendanceRecords.value = []
    }
  } catch (error) {
    clearClassDetails()
    showError(error)
  } finally {
    loadingDetails.value = false
  }
}

function clearClassDetails() {
  schedules.value = []
  meetings.value = []
  students.value = []
  attendanceRecords.value = []
  selectedMeetingId.value = ''
}

async function loadStudents(studentIds: string[]): Promise<StudentRow[]> {
  if (!studentIds.length) return []
  const profileResult = await supabase.from('profiles').select('id,full_name,email').in('id', studentIds)
  if (profileResult.error) throw profileResult.error
  return (profileResult.data ?? [])
    .map((studentProfile) => ({
      id: studentProfile.id,
      full_name: studentProfile.full_name,
      email: studentProfile.email,
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}

async function saveSchedule() {
  if (!selectedClassId.value) return
  savingSchedule.value = true
  clearMessage()
  try {
    if (scheduleForm.ends_at <= scheduleForm.starts_at) throw new Error('Schedule end must be after its start.')
    const payload = {
      class_id: selectedClassId.value,
      day_of_week: scheduleForm.day_of_week,
      starts_at: scheduleForm.starts_at,
      ends_at: scheduleForm.ends_at,
      room: scheduleForm.room.trim() || null,
      is_active: editingScheduleId.value
        ? schedules.value.find((item) => item.id === editingScheduleId.value)?.is_active ?? true
        : true,
    }

    const wasEditing = Boolean(editingScheduleId.value)
    if (wasEditing) {
      const { error } = await supabase.from('class_schedules').update(payload).eq('id', editingScheduleId.value)
      if (error) throw error
    } else {
      const { error } = await supabase.from('class_schedules').insert(payload)
      if (error) throw error
    }

    cancelScheduleEdit()
    await loadClassDetails(selectedClassId.value)
    showSuccess(
      wasEditing
        ? "Weekly schedule updated. This week's generated meeting keeps any teacher edits already made."
        : "Weekly schedule added and this week's meeting created.",
    )
  } catch (error) {
    showError(error)
  } finally {
    savingSchedule.value = false
  }
}

function beginScheduleEdit(schedule: ScheduleRow) {
  editingScheduleId.value = schedule.id
  scheduleForm.day_of_week = schedule.day_of_week
  scheduleForm.starts_at = schedule.starts_at.slice(0, 5)
  scheduleForm.ends_at = schedule.ends_at.slice(0, 5)
  scheduleForm.room = schedule.room ?? ''
}

function cancelScheduleEdit() {
  editingScheduleId.value = ''
  scheduleForm.day_of_week = 1
  scheduleForm.starts_at = '08:00'
  scheduleForm.ends_at = '09:00'
  scheduleForm.room = ''
}

async function deleteSchedule(schedule: ScheduleRow) {
  const confirmed = window.confirm(
    `Delete the ${dayLabel(schedule.day_of_week)} weekly schedule? It will stop creating future meetings. Meetings already created remain available and can be disabled or deleted separately.`,
  )
  if (!confirmed) return

  savingSchedule.value = true
  clearMessage()
  try {
    const { error } = await supabase.from('class_schedules').delete().eq('id', schedule.id)
    if (error) throw error
    if (editingScheduleId.value === schedule.id) cancelScheduleEdit()
    schedules.value = schedules.value.filter((item) => item.id !== schedule.id)
    meetings.value.forEach((meeting) => {
      if (meeting.schedule_id === schedule.id) meeting.schedule_id = null
    })
    showSuccess('Weekly schedule deleted.')
  } catch (error) {
    showError(error)
  } finally {
    savingSchedule.value = false
  }
}

async function saveMeeting() {
  if (!selectedClassId.value) return
  savingMeeting.value = true
  clearMessage()
  try {
    validateMeetingWindow()
    const isOnline = meetingForm.mode === 'self_online'
    const payload = {
      class_id: selectedClassId.value,
      title: meetingForm.title.trim(),
      meeting_date: meetingForm.starts_at.slice(0, 10),
      starts_at: manilaInputToIso(meetingForm.starts_at),
      ends_at: manilaInputToIso(meetingForm.ends_at),
      attendance_mode: meetingForm.mode,
      attendance_enabled: true,
      attendance_opens_at: manilaInputToIso(meetingForm.check_in_opens_at),
      attendance_closes_at: manilaInputToIso(meetingForm.check_in_closes_at),
      latitude: isOnline ? null : SCHOOL_LATITUDE,
      longitude: isOnline ? null : SCHOOL_LONGITUDE,
      radius_m: SCHOOL_RADIUS_M,
      max_accuracy_m: activeClass.value?.default_max_accuracy_m ?? 100,
    }

    if (editingMeetingId.value) {
      const current = meetings.value.find((item) => item.id === editingMeetingId.value)
      const { data, error } = await supabase
        .from('meetings')
        .update({ ...payload, attendance_enabled: current?.attendance_enabled ?? true })
        .eq('id', editingMeetingId.value)
        .select('id,class_id,schedule_id,title,starts_at,ends_at,attendance_mode,attendance_enabled,attendance_opens_at,attendance_closes_at,latitude,longitude,radius_m,max_accuracy_m')
        .single()
      if (error) throw error
      const updated = data as MeetingRow
      if (updated.starts_at >= week.startIso && updated.starts_at < week.endIso) {
        const index = meetings.value.findIndex((item) => item.id === updated.id)
        if (index >= 0) meetings.value[index] = updated
        meetings.value.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      } else {
        meetings.value = meetings.value.filter((item) => item.id !== updated.id)
        selectedMeetingId.value = meetings.value[0]?.id ?? ''
      }
      cancelMeetingEdit()
      showSuccess(
        updated.starts_at >= week.startIso && updated.starts_at < week.endIso
          ? 'Meeting updated.'
          : 'Meeting updated. It will appear in the list during its scheduled week.',
      )
      return
    }

    const creatorId = await currentUserId()
    const { data, error } = await supabase
      .from('meetings')
      .insert({ ...payload, created_by: creatorId })
      .select('id,class_id,schedule_id,title,starts_at,ends_at,attendance_mode,attendance_enabled,attendance_opens_at,attendance_closes_at,latitude,longitude,radius_m,max_accuracy_m')
      .single()
    if (error) throw error

    cancelMeetingEdit()
    const created = data as MeetingRow
    if (created.starts_at >= week.startIso && created.starts_at < week.endIso) {
      meetings.value.push(created)
      meetings.value.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      selectedMeetingId.value = created.id
      showSuccess('Meeting and attendance window created.')
    } else {
      showSuccess('Meeting created. It will appear in the list during its scheduled week.')
    }
  } catch (error) {
    showError(error)
  } finally {
    savingMeeting.value = false
  }
}

function beginMeetingEdit(meeting: MeetingRow) {
  editingMeetingId.value = meeting.id
  meetingForm.title = meeting.title
  meetingForm.mode = meeting.attendance_mode
  meetingForm.starts_at = isoToManilaInput(meeting.starts_at)
  meetingForm.ends_at = isoToManilaInput(meeting.ends_at)
  meetingForm.check_in_opens_at = isoToManilaInput(meeting.attendance_opens_at)
  meetingForm.check_in_closes_at = isoToManilaInput(meeting.attendance_closes_at)
}

function cancelMeetingEdit() {
  editingMeetingId.value = ''
  meetingForm.title = ''
  meetingForm.mode = 'teacher_manual'
  meetingForm.starts_at = ''
  meetingForm.ends_at = ''
  meetingForm.check_in_opens_at = ''
  meetingForm.check_in_closes_at = ''
}

async function toggleAttendance(meeting: MeetingRow) {
  updatingMeeting.value = true
  clearMessage()
  try {
    const attendanceEnabled = !meeting.attendance_enabled
    const { error } = await supabase.from('meetings').update({ attendance_enabled: attendanceEnabled }).eq('id', meeting.id)
    if (error) throw error
    meeting.attendance_enabled = attendanceEnabled
    showSuccess(attendanceEnabled ? 'Attendance will count for this meeting.' : 'Attendance will not count for this meeting.')
  } catch (error) {
    showError(error)
  } finally {
    updatingMeeting.value = false
  }
}

async function deleteMeeting(meeting: MeetingRow) {
  const confirmed = window.confirm(
    `Delete "${meeting.title}"? Its attendance records will also be removed. This cannot be undone.`,
  )
  if (!confirmed) return

  updatingMeeting.value = true
  clearMessage()
  try {
    const { error } = await supabase.from('meetings').delete().eq('id', meeting.id)
    if (error) throw error
    if (editingMeetingId.value === meeting.id) cancelMeetingEdit()
    meetings.value = meetings.value.filter((item) => item.id !== meeting.id)
    selectedMeetingId.value = meetings.value[0]?.id ?? ''
    showSuccess('Meeting deleted.')
  } catch (error) {
    showError(error)
  } finally {
    updatingMeeting.value = false
  }
}

async function loadAttendance(meetingId: string) {
  try {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('id,meeting_id,student_id,status,source,selfie_path,latitude,longitude,accuracy_m,distance_m,barcode_verified,verification_status,teacher_note,review_note,submitted_at,created_at')
      .eq('meeting_id', meetingId)
    if (error) throw error
    const records = (data ?? []) as AttendanceRow[]
    await Promise.all(
      records.map(async (record) => {
        if (!record.selfie_path) return
        const { data: signed, error: signedError } = await supabase.storage
          .from('attendance-selfies')
          .createSignedUrl(record.selfie_path, 900)
        if (!signedError) record.selfie_url = signed?.signedUrl ?? null
      }),
    )
    attendanceRecords.value = records
  } catch (error) {
    attendanceRecords.value = []
    showError(error)
  }
}

async function markAttendance(studentId: string, status: AttendanceStatus) {
  if (!selectedMeetingId.value) return
  markingStudentId.value = studentId
  clearMessage()
  try {
    const { error } = await supabase.rpc('record_manual_attendance', {
      p_meeting_id: selectedMeetingId.value,
      p_student_id: studentId,
      p_status: status,
      p_note: null,
    })
    if (error) throw error
    await loadAttendance(selectedMeetingId.value)
  } catch (error) {
    showError(error)
  } finally {
    markingStudentId.value = ''
  }
}

async function reviewEvidence(record: AttendanceRow, decision: 'approved' | 'rejected') {
  reviewingRecordId.value = record.id
  clearMessage()
  try {
    const { error } = await supabase.rpc('review_self_attendance', {
      p_attendance_id: record.id,
      p_decision: decision,
      p_note: record.review_note?.trim() || null,
    })
    if (error) throw error
    await loadAttendance(record.meeting_id)
    showSuccess(`Evidence ${decision}.`)
  } catch (error) {
    showError(error)
  } finally {
    reviewingRecordId.value = ''
  }
}

function validateMeetingWindow() {
  if (!meetingForm.title.trim()) throw new Error('Enter a meeting title.')
  const starts = new Date(manilaInputToIso(meetingForm.starts_at)).getTime()
  const ends = new Date(manilaInputToIso(meetingForm.ends_at)).getTime()
  const opens = new Date(manilaInputToIso(meetingForm.check_in_opens_at)).getTime()
  const closes = new Date(manilaInputToIso(meetingForm.check_in_closes_at)).getTime()
  if ([starts, ends, opens, closes].some(Number.isNaN)) throw new Error('Complete all meeting date and time fields.')
  if (starts < new Date(week.startIso).getTime() || starts >= new Date(week.endIso).getTime()) {
    throw new Error('Meetings created here must start within the current school week.')
  }
  if (ends <= starts) throw new Error('Meeting end must be after its start.')
  if (closes <= opens) throw new Error('Check-in close must be after check-in open.')
}

function currentManilaWeek() {
  const parts = datePartsInManila(new Date())
  const today = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  const daysSinceMonday = (today.getUTCDay() + 6) % 7
  const monday = new Date(today)
  monday.setUTCDate(today.getUTCDate() - daysSinceMonday)
  const nextMonday = new Date(monday)
  nextMonday.setUTCDate(monday.getUTCDate() + 7)
  const sunday = new Date(nextMonday)
  sunday.setUTCDate(nextMonday.getUTCDate() - 1)
  const startDate = dateKey(monday)
  const endDate = dateKey(nextMonday)
  return {
    startDate,
    endDateInclusive: dateKey(sunday),
    startIso: new Date(`${startDate}T00:00:00+08:00`).toISOString(),
    endIso: new Date(`${endDate}T00:00:00+08:00`).toISOString(),
  }
}

function datePartsInManila(date: Date) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: MANILA_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  return { year: values.year, month: values.month, day: values.day }
}

function dateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function scheduleDateLabel(dayOfWeek: number) {
  const offsetFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const date = new Date(`${week.startDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offsetFromMonday)
  return displayDate(dateKey(date))
}

function displayDate(dateValue: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${dateValue}T00:00:00Z`))
}

function manilaInputToIso(value: string) {
  if (!value) return ''
  return new Date(`${value.length === 16 ? `${value}:00` : value}+08:00`).toISOString()
}

function isoToManilaInput(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(new Date(value))
    .filter((part) => part.type !== 'literal')
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

function scheduleSortValue(schedule: ScheduleRow) {
  return schedule.day_of_week === 0 ? 7 : schedule.day_of_week
}

function dayLabel(value: number) {
  return weekdays.find((day) => day.value === value)?.label ?? String(value)
}

function modeLabel(mode: MeetingMode) {
  return {
    teacher_manual: 'Teacher marks',
    self_on_site: 'On-site self-check',
    self_event: 'Event self-check',
    self_online: 'Online self-check',
  }[mode]
}

function studentName(studentId: string) {
  return students.value.find((student) => student.id === studentId)?.full_name ?? 'Student'
}

function statusColor(status: AttendanceStatus) {
  return status === 'present' ? 'success' : 'danger'
}

function verificationColor(status: VerificationStatus | null) {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  return status === 'pending' ? 'warning' : 'medium'
}

function formatDateTime(value: string | null) {
  if (!value) return 'Not recorded'
  return new Intl.DateTimeFormat(undefined, {
    timeZone: MANILA_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatTime(value: string) {
  const [hours = '0', minutes = '00'] = value.split(':')
  const date = new Date(Date.UTC(2000, 0, 1, Number(hours), Number(minutes)))
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function mapUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`
}

function showError(error: unknown) {
  messageKind.value = 'error'
  message.value = toUserFacingErrorMessage(error)
}

function showSuccess(text: string) {
  messageKind.value = 'success'
  message.value = text
}

function clearMessage() {
  message.value = ''
}

async function logout() {
  signingOut.value = true
  try {
    await signOut()
    await router.replace('/login')
  } finally {
    signingOut.value = false
  }
}
</script>

<style scoped>
.centered {
  display: grid;
  min-height: 40vh;
  place-items: center;
}

.approval-card {
  max-width: 640px;
  margin: 2rem auto;
}

.form-grid {
  display: grid;
  gap: 12px;
}

.spaced-form,
.summary {
  margin-top: 16px;
}

.native-field {
  display: grid;
  gap: 6px;
  color: var(--ion-color-medium-shade);
  font-size: 0.8rem;
}

.native-field input {
  min-height: 48px;
  padding: 10px 12px;
  border: 1px solid var(--ion-color-medium-tint);
  border-radius: 4px;
  color: var(--ion-text-color);
  background: var(--ion-background-color);
  font: inherit;
}

.form-actions,
.row-actions,
.item-actions,
.meeting-actions,
.review-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.meeting-actions {
  margin-top: 14px;
}

.meeting-actions > div {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: 6px;
}

.attendance-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.evidence-card {
  display: grid;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--ion-color-light-shade);
}

.evidence-main {
  display: flex;
  gap: 14px;
}

.evidence-copy h3,
.evidence-copy p {
  margin: 0 0 6px;
}

.selfie {
  width: 104px;
  height: 104px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--ion-color-light);
}

@media (max-width: 560px) {
  .item-actions,
  .attendance-buttons {
    flex-direction: column;
    align-items: stretch;
  }
}

@media (min-width: 720px) {
  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .full-row {
    grid-column: 1 / -1;
  }
}

/* Campus portal layout */
.teacher-page {
  --page-navy: var(--campus-navy, #15364e);
  --page-blue: var(--campus-blue, #245f86);
  --page-blue-soft: var(--campus-blue-soft, #e1edf5);
  --page-bg: var(--campus-bg, #eef3f7);
  --page-surface: var(--campus-surface, #ffffff);
  --page-surface-soft: var(--campus-surface-soft, #f5f8fa);
  --page-text: var(--campus-text, #182632);
  --page-muted: var(--campus-muted, #62727f);
  --page-border: var(--campus-border, #d9e2e9);
  --page-success: var(--campus-success, #147a50);
  --page-success-soft: var(--campus-success-soft, #e1f4eb);
  --page-warning: var(--campus-warning, #91620d);
  --page-warning-soft: var(--campus-warning-soft, #fff3d5);
  --page-danger: var(--campus-danger, #bb3e45);
  --page-danger-soft: var(--campus-danger-soft, #fae9ea);
  --page-radius: var(--campus-radius, 18px);
  --page-shadow: var(--campus-shadow, 0 12px 36px rgba(21, 54, 78, 0.08));
  --ion-color-primary: var(--page-blue);
  color: var(--page-text);
}

.teacher-content { --background: var(--page-bg); }
.app-header { box-shadow: none; }
.app-toolbar {
  --background: var(--page-navy);
  --border-width: 0;
  --color: #f7fbfd;
  --min-height: 72px;
  --padding-start: clamp(12px, 3vw, 32px);
  --padding-end: clamp(8px, 2vw, 24px);
}

.brand-lockup,
.brand-lockup > span:last-child { display: flex; align-items: center; }
.brand-lockup { gap: 11px; }
.brand-lockup > span:last-child { align-items: flex-start; flex-direction: column; gap: 2px; }
.brand-lockup strong { font-size: 1rem; font-weight: 700; letter-spacing: -0.01em; }
.brand-lockup small { color: rgba(247, 251, 253, 0.7); font-size: 0.68rem; font-weight: 500; }
.brand-mark {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
  font-weight: 800;
}
.sign-out-button { --border-radius: 10px; --color: #f7fbfd; font-weight: 600; }

.dashboard-shell { width: min(100%, 1400px); margin: 0 auto; padding: clamp(20px, 3vw, 38px); }
.dashboard-heading,
.planning-heading,
.section-heading,
.active-class-summary,
.evidence-title-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.dashboard-heading { align-items: flex-end; margin-bottom: 24px; }
.dashboard-heading h1,
.approval-card h1 {
  margin: 0;
  color: var(--page-text);
  font-size: clamp(1.6rem, 3vw, 2.15rem);
  font-weight: 700;
  letter-spacing: -0.035em;
}
.dashboard-heading > div > p:last-child,
.section-heading p,
.planning-heading > p,
.section-description,
.muted-copy,
.approval-copy { margin: 6px 0 0; color: var(--page-muted); line-height: 1.55; }
.eyebrow {
  margin: 0 0 5px;
  color: var(--page-blue);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.week-chip {
  display: grid;
  min-width: 230px;
  gap: 3px;
  padding: 12px 15px;
  border: 1px solid var(--page-border);
  border-radius: 14px;
  background: var(--page-surface);
}
.week-chip span { color: var(--page-muted); font-size: 0.7rem; font-weight: 650; text-transform: uppercase; }
.week-chip strong { color: var(--page-text); font-size: 0.86rem; }

.surface-card {
  margin: 0;
  border: 1px solid var(--page-border);
  border-radius: var(--page-radius);
  background: var(--page-surface);
  box-shadow: var(--page-shadow);
}
.class-workspace,
.attendance-card,
.meeting-control,
.week-overview,
.schedule-card,
.meeting-form-card,
.evidence-section { padding: clamp(18px, 2.4vw, 27px); }
.section-heading { align-items: flex-start; margin-bottom: 20px; }
.section-heading h2,
.planning-heading h2 { margin: 0; color: var(--page-text); font-size: 1.05rem; font-weight: 700; }
.class-heading { margin-bottom: 22px; padding-bottom: 18px; border-bottom: 1px solid var(--page-border); }
.class-workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: clamp(22px, 4vw, 46px);
}
.class-selection,
.class-form,
.form-heading,
.meeting-detail,
.evidence-copy { display: grid; }
.class-selection { align-content: start; gap: 15px; }
.class-form,
.schedule-form,
.meeting-form {
  align-content: start;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--page-border);
  border-radius: 15px;
  background: var(--page-surface-soft);
}
.form-heading { gap: 3px; margin-bottom: 2px; }
.form-heading strong { color: var(--page-text); font-size: 0.94rem; }
.form-heading span { color: var(--page-muted); font-size: 0.78rem; line-height: 1.4; }
.active-class-summary {
  justify-content: flex-start;
  padding: 17px;
  border: 1px solid var(--page-border);
  border-radius: 15px;
  background: var(--page-surface-soft);
}
.class-avatar,
.student-avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  background: var(--page-blue-soft);
  color: var(--page-blue);
  font-weight: 750;
}
.class-avatar { width: 48px; height: 48px; border-radius: 15px; font-size: 1.1rem; }
.class-identity { display: grid; min-width: 0; gap: 3px; }
.class-identity strong { overflow: hidden; color: var(--page-text); text-overflow: ellipsis; white-space: nowrap; }
.class-identity span,
.join-code-block span { color: var(--page-muted); font-size: 0.76rem; }
.join-code-block { display: grid; gap: 3px; margin-left: auto; padding-left: 16px; text-align: right; }
.join-code-block strong { color: var(--page-blue); font-size: 1.06rem; letter-spacing: 0.12em; }
.class-actions { justify-content: flex-start; }
.location-note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px 13px;
  border-radius: 12px;
  background: var(--page-blue-soft);
  color: var(--page-muted);
  font-size: 0.78rem;
  line-height: 1.5;
}
.location-pin { color: var(--page-blue); font-size: 1rem; font-weight: 800; }

.status-message {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 20px;
  padding: 13px 15px;
  border: 1px solid transparent;
  border-radius: 13px;
  font-size: 0.88rem;
  font-weight: 600;
}
.status-message.success { border-color: var(--page-success); background: var(--page-success-soft); color: var(--page-success); }
.status-message.error { border-color: var(--page-danger); background: var(--page-danger-soft); color: var(--page-danger); }
.status-message-icon {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  place-items: center;
  border-radius: 50%;
  font-size: 0.75rem;
}
.status-message.success .status-message-icon { background: var(--page-success); color: #fff; }
.status-message.error .status-message-icon { background: var(--page-danger); color: #fff; }
.approval-message { margin: 18px 0; text-align: left; }

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 20px 0;
}
.stat-card {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 13px;
  padding: 17px;
  border: 1px solid var(--page-border);
  border-radius: 16px;
  background: var(--page-surface);
}
.stat-icon {
  display: grid;
  width: 39px;
  height: 39px;
  flex: 0 0 39px;
  place-items: center;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 800;
}
.stat-card > div { display: grid; gap: 2px; }
.stat-card > div > span { color: var(--page-muted); font-size: 0.76rem; font-weight: 650; }
.stat-card strong { color: var(--page-text); font-size: 1.55rem; line-height: 1; }
.present-stat .stat-icon { background: var(--page-success-soft); color: var(--page-success); }
.absent-stat .stat-icon { background: var(--page-danger-soft); color: var(--page-danger); }
.unchecked-stat .stat-icon { background: var(--page-surface-soft); color: var(--page-muted); }
.review-stat .stat-icon { background: var(--page-warning-soft); color: var(--page-warning); }

.attendance-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.85fr) minmax(280px, 0.75fr);
  gap: 18px;
  align-items: start;
}
.attendance-heading { align-items: center; }
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border-radius: 999px;
  font-size: 0.73rem;
  font-weight: 700;
  white-space: nowrap;
}
.status-pill > span { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.status-pill.open { background: var(--page-success-soft); color: var(--page-success); }
.status-pill.closed { background: var(--page-surface-soft); color: var(--page-muted); }
.meeting-selector { margin-bottom: 12px; }
.student-list { border-top: 1px solid var(--page-border); }
.student-row {
  display: grid;
  grid-template-columns: auto minmax(120px, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 15px 0;
  border-bottom: 1px solid var(--page-border);
}
.student-row:last-child { border-bottom: 0; }
.student-avatar { width: 40px; height: 40px; border-radius: 13px; font-size: 0.82rem; }
.student-copy { display: grid; min-width: 0; justify-items: start; gap: 3px; }
.student-copy strong,
.student-copy > span { overflow: hidden; max-width: 100%; text-overflow: ellipsis; white-space: nowrap; }
.student-copy strong { color: var(--page-text); font-size: 0.9rem; }
.student-copy > span { color: var(--page-muted); font-size: 0.76rem; }
.attendance-badge { margin-top: 2px; font-size: 0.64rem; text-transform: capitalize; }
.attendance-buttons,
.form-actions,
.row-actions,
.item-actions,
.review-buttons,
.badge-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.attendance-buttons { justify-content: flex-end; }
.attendance-side { display: grid; gap: 18px; }
.meeting-control .section-heading,
.week-overview .section-heading { margin-bottom: 16px; }
.badge-row { margin-bottom: 17px; }
.meeting-detail { gap: 6px; padding: 15px 0; border-top: 1px solid var(--page-border); }
.meeting-detail strong { color: var(--page-text); font-size: 0.92rem; }
.meeting-detail span { color: var(--page-muted); font-size: 0.77rem; line-height: 1.45; }
.full-button { width: 100%; margin: 6px 0 10px; }
.meeting-edit-actions { justify-content: space-between; }
.count-bubble {
  display: grid;
  min-width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 10px;
  background: var(--page-blue-soft);
  color: var(--page-blue);
  font-size: 0.8rem;
  font-weight: 750;
}
.mini-meeting-list { display: grid; }
.mini-meeting {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 12px 0;
  border: 0;
  border-top: 1px solid var(--page-border);
  background: transparent;
  color: var(--page-text);
  text-align: left;
  cursor: pointer;
}
.mini-meeting:first-child { border-top: 0; }
.mini-meeting.selected { margin: 0 -8px; padding-right: 8px; padding-left: 8px; border-radius: 11px; background: var(--page-blue-soft); }
.mini-date { color: var(--page-blue); font-size: 0.7rem; font-weight: 700; }
.mini-meeting > span:last-child { display: grid; min-width: 0; gap: 3px; }
.mini-meeting strong,
.mini-meeting small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mini-meeting strong { font-size: 0.8rem; }
.mini-meeting small { color: var(--page-muted); font-size: 0.7rem; }

.planning-section { margin-top: 34px; }
.planning-heading { align-items: flex-end; margin-bottom: 17px; }
.planning-heading > p { max-width: 520px; text-align: right; }
.planning-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }
.section-description { margin: -10px 0 18px; font-size: 0.82rem; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.full-row { grid-column: 1 / -1; }
.schedule-list { margin-top: 20px; border-top: 1px solid var(--page-border); }
.schedule-row {
  display: grid;
  grid-template-columns: 43px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 13px 0;
  border-bottom: 1px solid var(--page-border);
}
.schedule-row:last-child { border-bottom: 0; }
.schedule-day { display: grid; height: 38px; place-items: center; border-radius: 11px; background: var(--page-blue-soft); color: var(--page-blue); font-size: 0.72rem; font-weight: 750; }
.schedule-copy { display: grid; min-width: 0; justify-items: start; gap: 3px; }
.schedule-copy strong { color: var(--page-text); font-size: 0.8rem; }
.schedule-copy > span { color: var(--page-muted); font-size: 0.73rem; }
.native-field { display: grid; gap: 7px; color: var(--page-muted); font-size: 0.75rem; font-weight: 600; }
.native-field input {
  min-width: 0;
  min-height: 56px;
  padding: 10px 12px;
  border: 1px solid var(--page-border);
  border-radius: 10px;
  outline: none;
  background: var(--page-surface);
  color: var(--page-text);
  font: inherit;
  font-size: 0.86rem;
}
.native-field input:focus { border-color: var(--page-blue); box-shadow: 0 0 0 3px rgba(36, 95, 134, 0.14); }

.evidence-section { margin-top: 18px; }
.review-count { background: var(--page-warning-soft); color: var(--page-warning); }
.evidence-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.evidence-card {
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 15px;
  border: 1px solid var(--page-border);
  border-radius: 15px;
  background: var(--page-surface-soft);
}
.evidence-main { display: flex; gap: 14px; }
.evidence-copy { min-width: 0; align-content: start; gap: 5px; }
.evidence-title-row { align-items: flex-start; gap: 8px; margin-bottom: 2px; }
.evidence-copy h3,
.evidence-copy p { margin: 0; }
.evidence-copy h3 { color: var(--page-text); font-size: 0.92rem; }
.evidence-copy p,
.evidence-copy a { color: var(--page-muted); font-size: 0.75rem; line-height: 1.45; }
.evidence-copy a { color: var(--page-blue); font-weight: 650; }
.selfie { width: 108px; height: 108px; flex: 0 0 108px; border-radius: 13px; background: var(--page-surface-soft); object-fit: cover; }
.selfie-placeholder { display: grid; place-items: center; color: var(--page-muted); font-size: 0.68rem; }

.empty-state,
.inline-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 105px;
  padding: 18px;
  border: 1px dashed var(--page-border);
  border-radius: 14px;
  color: var(--page-muted);
}
.empty-state > span:first-child { display: grid; width: 38px; height: 38px; flex: 0 0 38px; place-items: center; border-radius: 12px; background: var(--page-surface-soft); color: var(--page-blue); font-weight: 750; }
.empty-state div { display: grid; gap: 3px; }
.empty-state strong { color: var(--page-text); font-size: 0.86rem; }
.empty-state p { margin: 0; font-size: 0.76rem; line-height: 1.45; }
.compact-empty { min-height: 82px; }
.inline-loading { justify-content: center; border: 0; }
.empty-note { display: block; padding: 13px 14px; border-radius: 12px; background: var(--page-blue-soft); color: var(--page-muted); }

.centered { min-height: 56vh; align-content: center; gap: 12px; color: var(--page-muted); font-size: 0.86rem; }
.approval-card { max-width: 620px; margin: clamp(30px, 9vh, 100px) auto; text-align: center; }
.approval-card ion-card-content { padding: clamp(26px, 5vw, 48px); }
.approval-icon { display: grid; width: 62px; height: 62px; margin: 0 auto 18px; place-items: center; border-radius: 20px; background: var(--page-warning-soft); color: var(--page-warning); font-size: 1.4rem; font-weight: 800; }
.approval-icon.rejected { background: var(--page-danger-soft); color: var(--page-danger); }
.approval-card ion-badge { margin-top: 14px; }
.approval-copy { max-width: 470px; margin: 18px auto; }
.admin-note { padding: 12px; border-radius: 11px; background: var(--page-bg); color: var(--page-muted); font-size: 0.82rem; }

ion-input,
ion-select,
ion-textarea { --background: var(--page-surface); --border-color: var(--page-border); --border-radius: 10px; --color: var(--page-text); --highlight-color-focused: var(--page-blue); --placeholder-color: var(--page-muted); }
ion-button { --border-radius: 10px; min-height: 38px; font-weight: 650; letter-spacing: 0; text-transform: none; }
ion-badge { --padding-start: 8px; --padding-end: 8px; border-radius: 999px; font-weight: 650; }

@media (max-width: 1100px) {
  .attendance-layout { grid-template-columns: 1fr; }
  .attendance-side { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .evidence-grid { grid-template-columns: 1fr; }
}

@media (max-width: 860px) {
  .class-workspace-grid,
  .planning-grid { grid-template-columns: 1fr; }
  .planning-heading { align-items: flex-start; flex-direction: column; }
  .planning-heading > p { max-width: none; text-align: left; }
}

@media (max-width: 680px) {
  .app-toolbar { --min-height: 64px; }
  .dashboard-shell { padding: 18px 13px 34px; }
  .dashboard-heading { align-items: flex-start; flex-direction: column; }
  .week-chip { width: 100%; }
  .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
  .stat-card { gap: 9px; padding: 13px; }
  .stat-icon { width: 34px; height: 34px; flex-basis: 34px; }
  .stat-card strong { font-size: 1.3rem; }
  .attendance-side { grid-template-columns: 1fr; }
  .class-workspace,
  .attendance-card,
  .meeting-control,
  .week-overview,
  .schedule-card,
  .meeting-form-card,
  .evidence-section { padding: 17px; }
  .student-row { grid-template-columns: auto minmax(0, 1fr); }
  .attendance-buttons { grid-column: 1 / -1; justify-content: stretch; }
  .attendance-buttons ion-button { flex: 1 1 120px; }
  .form-grid { grid-template-columns: 1fr; }
  .full-row { grid-column: auto; }
  .schedule-row { grid-template-columns: 40px minmax(0, 1fr); }
  .schedule-row .item-actions { grid-column: 1 / -1; justify-content: flex-end; }
}

@media (max-width: 450px) {
  .brand-lockup small { display: none; }
  .brand-lockup strong { font-size: 0.9rem; }
  .brand-mark { width: 34px; height: 34px; flex-basis: 34px; }
  .sign-out-button { font-size: 0.78rem; }
  .active-class-summary { display: grid; grid-template-columns: auto 1fr; }
  .join-code-block { grid-column: 1 / -1; margin-left: 0; padding: 11px 0 0; border-top: 1px solid var(--page-border); text-align: left; }
  .attendance-heading { align-items: flex-start; flex-direction: column; }
  .evidence-main { display: grid; }
  .selfie { width: 100%; height: 210px; }
}
</style>
