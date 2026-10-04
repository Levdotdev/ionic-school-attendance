<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Teacher attendance</ion-title>
        <ion-buttons slot="end">
          <ion-button :disabled="signingOut" @click="logout">Sign out</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-card>
        <ion-card-header>
          <ion-card-title>Create a class</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <form class="form-grid" @submit.prevent="createClass">
            <ion-input v-model="classForm.name" label="Class name" label-placement="stacked" fill="outline" required />
            <ion-input v-model="classForm.section" label="Section" label-placement="stacked" fill="outline" />
            <ion-input
              v-model="classForm.default_latitude"
              label="Default latitude"
              label-placement="stacked"
              fill="outline"
              type="number"
              step="any"
              required
            />
            <ion-input
              v-model="classForm.default_longitude"
              label="Default longitude"
              label-placement="stacked"
              fill="outline"
              type="number"
              step="any"
              required
            />
            <ion-input
              v-model="classForm.default_radius_m"
              label="Allowed radius (meters)"
              label-placement="stacked"
              fill="outline"
              type="number"
              min="10"
              required
            />
            <ion-button type="submit" :disabled="savingClass">
              <ion-spinner v-if="savingClass" name="crescent" />
              <span v-else>Create class</span>
            </ion-button>
          </form>
        </ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header>
          <ion-card-title>My classes</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-spinner v-if="loadingClasses" name="crescent" />
          <ion-note v-else-if="classes.length === 0">Create your first class above.</ion-note>
          <ion-list v-else>
            <ion-item>
              <ion-select v-model="selectedClassId" label="Open class" label-placement="stacked">
                <ion-select-option v-for="item in classes" :key="item.id" :value="item.id">
                  {{ item.name }}{{ item.section ? ` - ${item.section}` : '' }} ({{ item.join_code }})
                </ion-select-option>
              </ion-select>
            </ion-item>
          </ion-list>

          <div v-if="activeClass" class="summary">
            <p><strong>Code:</strong> {{ activeClass.join_code }}</p>
            <p>
              <strong>Location:</strong>
              {{ activeClass.default_latitude }}, {{ activeClass.default_longitude }}
              within {{ activeClass.default_radius_m }} m
            </p>
          </div>
        </ion-card-content>
      </ion-card>

      <template v-if="activeClass">
        <ion-card>
          <ion-card-header>
            <ion-card-title>Weekly schedule</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <form class="form-grid" @submit.prevent="addSchedule">
              <ion-select v-model="scheduleForm.day_of_week" label="Day" label-placement="stacked" fill="outline">
                <ion-select-option v-for="day in weekdays" :key="day.value" :value="day.value">
                  {{ day.label }}
                </ion-select-option>
              </ion-select>
              <ion-input v-model="scheduleForm.starts_at" label="Starts" label-placement="stacked" fill="outline" type="time" required />
              <ion-input v-model="scheduleForm.ends_at" label="Ends" label-placement="stacked" fill="outline" type="time" required />
              <ion-input v-model="scheduleForm.room" label="Room (optional)" label-placement="stacked" fill="outline" />
              <ion-button type="submit" :disabled="savingSchedule">Add schedule</ion-button>
            </form>

            <ion-list v-if="schedules.length">
              <ion-item v-for="schedule in schedules" :key="schedule.id">
                <ion-label>
                  <h3>{{ dayLabel(schedule.day_of_week) }}</h3>
                  <p>
                    {{ formatTime(schedule.starts_at) }} - {{ formatTime(schedule.ends_at) }}
                    <span v-if="schedule.room"> · {{ schedule.room }}</span>
                  </p>
                </ion-label>
              </ion-item>
            </ion-list>
            <ion-note v-else>No weekly schedule has been added.</ion-note>
          </ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header>
            <ion-card-title>Create a meeting</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <form class="form-grid" @submit.prevent="createMeeting">
              <ion-input v-model="meetingForm.title" label="Meeting title" label-placement="stacked" fill="outline" required />
              <ion-select v-model="meetingForm.mode" label="Attendance mode" label-placement="stacked" fill="outline">
                <ion-select-option value="teacher_manual">Teacher marks attendance</ion-select-option>
                <ion-select-option value="self_on_site">Student self-check on site</ion-select-option>
                <ion-select-option value="self_event">Student self-check at an event</ion-select-option>
                <ion-select-option value="self_online">Online class self-check</ion-select-option>
              </ion-select>

              <label class="native-field">
                <span>Meeting starts</span>
                <input v-model="meetingForm.starts_at" type="datetime-local" required />
              </label>
              <label class="native-field">
                <span>Meeting ends</span>
                <input v-model="meetingForm.ends_at" type="datetime-local" required />
              </label>
              <label class="native-field">
                <span>Check-in opens</span>
                <input v-model="meetingForm.check_in_opens_at" type="datetime-local" required />
              </label>
              <label class="native-field">
                <span>Check-in closes</span>
                <input v-model="meetingForm.check_in_closes_at" type="datetime-local" required />
              </label>

              <template v-if="meetingForm.mode !== 'self_online'">
                <ion-input
                  v-model="meetingForm.latitude"
                  label="Required latitude"
                  label-placement="stacked"
                  fill="outline"
                  type="number"
                  step="any"
                  required
                />
                <ion-input
                  v-model="meetingForm.longitude"
                  label="Required longitude"
                  label-placement="stacked"
                  fill="outline"
                  type="number"
                  step="any"
                  required
                />
                <ion-input
                  v-model="meetingForm.allowed_radius_m"
                  label="Allowed radius (meters)"
                  label-placement="stacked"
                  fill="outline"
                  type="number"
                  min="10"
                  required
                />
              </template>

              <ion-note>
                On-site and event self-checks require an ID scan, selfie, and location. Online self-checks require a selfie only.
              </ion-note>
              <ion-button type="submit" :disabled="savingMeeting">Create meeting</ion-button>
            </form>
          </ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header>
            <ion-card-title>Meetings</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <ion-item v-if="meetings.length">
              <ion-select v-model="selectedMeetingId" label="Attendance meeting" label-placement="stacked">
                <ion-select-option v-for="meeting in meetings" :key="meeting.id" :value="meeting.id">
                  {{ meeting.title }} - {{ formatDateTime(meeting.starts_at) }}
                </ion-select-option>
              </ion-select>
            </ion-item>
            <ion-note v-else>Create a meeting to record attendance.</ion-note>

            <div v-if="selectedMeeting" class="meeting-actions">
              <div>
                <ion-badge :color="selectedMeeting.attendance_enabled ? 'success' : 'medium'">
                  {{ selectedMeeting.attendance_enabled ? 'Attendance enabled' : 'Attendance disabled' }}
                </ion-badge>
                <ion-badge color="tertiary">{{ modeLabel(selectedMeeting.attendance_mode) }}</ion-badge>
              </div>
              <ion-button
                color="warning"
                fill="outline"
                size="small"
                :disabled="!selectedMeeting.attendance_enabled || updatingMeeting"
                @click="disableAttendance(selectedMeeting)"
              >
                Disable attendance
              </ion-button>
            </div>
          </ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header>
            <ion-card-title>Enrolled students</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <ion-spinner v-if="loadingDetails" name="crescent" />
            <ion-list v-else-if="students.length">
              <ion-item v-for="student in students" :key="student.id">
                <ion-label>
                  <h2>{{ student.full_name }}</h2>
                  <p>{{ student.email }}</p>
                  <ion-badge v-if="attendanceByStudent[student.id]" :color="statusColor(attendanceByStudent[student.id].status)">
                    {{ attendanceByStudent[student.id].status }}
                  </ion-badge>
                </ion-label>
                <div slot="end" class="attendance-buttons">
                  <ion-button
                    color="success"
                    size="small"
                    :disabled="!canMarkAttendance || markingStudentId === student.id"
                    @click="markAttendance(student.id, 'present')"
                  >
                    Present
                  </ion-button>
                  <ion-button
                    color="danger"
                    fill="outline"
                    size="small"
                    :disabled="!canMarkAttendance || markingStudentId === student.id"
                    @click="markAttendance(student.id, 'absent')"
                  >
                    Absent
                  </ion-button>
                </div>
              </ion-item>
            </ion-list>
            <ion-note v-else>No active students are enrolled in this class.</ion-note>
            <ion-note v-if="!selectedMeetingId">Select or create a meeting before marking attendance.</ion-note>
          </ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header>
            <ion-card-title>Self-check verification</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <ion-note v-if="evidenceRows.length === 0">No student self-check evidence for this meeting.</ion-note>
            <div v-for="record in evidenceRows" :key="record.id" class="evidence-card">
              <div class="evidence-main">
                <img v-if="record.selfie_url" :src="record.selfie_url" alt="Student self-check selfie" class="selfie" />
                <div class="evidence-copy">
                  <h3>{{ studentName(record.student_id) }}</h3>
                  <p>Status: {{ record.status }}</p>
                  <p>Submitted: {{ formatDateTime(record.submitted_at || record.created_at) }}</p>
                  <p v-if="record.latitude != null && record.longitude != null">
                    Location: {{ record.latitude }}, {{ record.longitude }}
                    <a :href="mapUrl(record.latitude, record.longitude)" target="_blank" rel="noopener">Open map</a>
                  </p>
                  <p v-if="record.distance_m != null">Distance: {{ Math.round(record.distance_m) }} m</p>
                  <ion-badge :color="verificationColor(record.verification_status)">
                    {{ record.verification_status }}
                  </ion-badge>
                </div>
              </div>
              <ion-textarea
                v-model="record.review_note"
                label="Teacher note"
                label-placement="stacked"
                fill="outline"
                auto-grow
              />
              <div class="review-buttons">
                <ion-button
                  color="success"
                  size="small"
                  :disabled="reviewingRecordId === record.id"
                  @click="reviewEvidence(record, 'approved')"
                >
                  Approve
                </ion-button>
                <ion-button
                  color="danger"
                  fill="outline"
                  size="small"
                  :disabled="reviewingRecordId === record.id"
                  @click="reviewEvidence(record, 'rejected')"
                >
                  Reject
                </ion-button>
              </div>
            </div>
          </ion-card-content>
        </ion-card>
      </template>

      <ion-card v-if="message" :color="messageKind === 'error' ? 'danger' : 'success'">
        <ion-card-content>{{ message }}</ion-card-content>
      </ion-card>
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
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
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
const { signOut } = useSession()
const classes = ref<ClassRow[]>([])
const schedules = ref<ScheduleRow[]>([])
const meetings = ref<MeetingRow[]>([])
const students = ref<StudentRow[]>([])
const attendanceRecords = ref<AttendanceRow[]>([])
const selectedClassId = ref('')
const selectedMeetingId = ref('')
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

const classForm = reactive({
  name: '',
  section: '',
  default_latitude: '',
  default_longitude: '',
  default_radius_m: '100',
})

const scheduleForm = reactive({ day_of_week: 1, starts_at: '08:00', ends_at: '09:00', room: '' })

const meetingForm = reactive({
  title: '',
  mode: 'teacher_manual' as MeetingMode,
  starts_at: '',
  ends_at: '',
  check_in_opens_at: '',
  check_in_closes_at: '',
  latitude: '',
  longitude: '',
  allowed_radius_m: '100',
})

const activeClass = computed(() => classes.value.find((item) => item.id === selectedClassId.value) ?? null)
const selectedMeeting = computed(() => meetings.value.find((item) => item.id === selectedMeetingId.value) ?? null)
const attendanceByStudent = computed<Record<string, AttendanceRow>>(() =>
  Object.fromEntries(attendanceRecords.value.map((record) => [record.student_id, record])),
)
const evidenceRows = computed(() =>
  attendanceRecords.value.filter((record) => record.source === 'self_check'),
)
const canMarkAttendance = computed(
  () => Boolean(selectedMeeting.value?.attendance_enabled),
)

watch(selectedClassId, async (classId) => {
  if (!classId) return
  const selected = classes.value.find((item) => item.id === classId)
  if (selected) {
    meetingForm.latitude = selected.default_latitude == null ? '' : String(selected.default_latitude)
    meetingForm.longitude = selected.default_longitude == null ? '' : String(selected.default_longitude)
    meetingForm.allowed_radius_m = String(selected.default_radius_m)
  }
  await loadClassDetails(classId)
})

watch(selectedMeetingId, async (meetingId) => {
  if (meetingId) await loadAttendance(meetingId)
  else attendanceRecords.value = []
})

onMounted(loadClasses)

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
      .select(
        'id,teacher_id,join_code,name,section,timezone,default_latitude,default_longitude,default_radius_m,default_max_accuracy_m',
      )
      .eq('teacher_id', teacherId)
      .order('created_at', { ascending: false })
    if (error) throw error
    classes.value = (data ?? []) as ClassRow[]
    if (!selectedClassId.value && classes.value[0]) selectedClassId.value = classes.value[0].id
  } catch (error) {
    showError(error)
  } finally {
    loadingClasses.value = false
  }
}

async function createClass() {
  savingClass.value = true
  clearMessage()
  try {
    const { data, error } = await supabase.rpc('create_class', {
      p_name: classForm.name.trim(),
      p_section: classForm.section.trim() || null,
      p_timezone: 'Asia/Manila',
      p_default_latitude: requiredNumber(classForm.default_latitude, 'latitude'),
      p_default_longitude: requiredNumber(classForm.default_longitude, 'longitude'),
      p_default_radius_m: requiredNumber(classForm.default_radius_m, 'radius'),
      p_default_max_accuracy_m: 100,
    })
    if (error) throw error
    const created = (Array.isArray(data) ? data[0] : data) as ClassRow | null
    await loadClasses()
    if (created?.id) selectedClassId.value = created.id
    classForm.name = ''
    classForm.section = ''
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

async function loadClassDetails(classId: string) {
  loadingDetails.value = true
  clearMessage()
  try {
    const [scheduleResult, meetingResult, enrollmentResult] = await Promise.all([
      supabase
        .from('class_schedules')
        .select('id,class_id,day_of_week,starts_at,ends_at,room,is_active')
        .eq('class_id', classId)
        .eq('is_active', true)
        .order('day_of_week')
        .order('starts_at'),
      supabase
        .from('meetings')
        .select(
          'id,class_id,title,starts_at,ends_at,attendance_mode,attendance_enabled,attendance_opens_at,attendance_closes_at,latitude,longitude,radius_m,max_accuracy_m',
        )
        .eq('class_id', classId)
        .order('starts_at', { ascending: false }),
      supabase.from('class_enrollments').select('student_id').eq('class_id', classId).eq('is_active', true),
    ])
    if (scheduleResult.error) throw scheduleResult.error
    if (meetingResult.error) throw meetingResult.error
    if (enrollmentResult.error) throw enrollmentResult.error

    schedules.value = (scheduleResult.data ?? []) as ScheduleRow[]
    meetings.value = (meetingResult.data ?? []) as MeetingRow[]

    const studentIds = (enrollmentResult.data ?? []).map((row) => row.student_id)
    students.value = await loadStudents(studentIds)

    selectedMeetingId.value = meetings.value[0]?.id ?? ''
    if (!selectedMeetingId.value) attendanceRecords.value = []
  } catch (error) {
    schedules.value = []
    meetings.value = []
    students.value = []
    attendanceRecords.value = []
    showError(error)
  } finally {
    loadingDetails.value = false
  }
}

async function loadStudents(studentIds: string[]): Promise<StudentRow[]> {
  if (!studentIds.length) return []
  const profileResult = await supabase.from('profiles').select('id,full_name,email').in('id', studentIds)
  if (profileResult.error) throw profileResult.error
  return (profileResult.data ?? [])
    .map((profile) => ({
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}

async function addSchedule() {
  if (!selectedClassId.value) return
  savingSchedule.value = true
  clearMessage()
  try {
    const { data, error } = await supabase
      .from('class_schedules')
      .insert({
        class_id: selectedClassId.value,
        day_of_week: scheduleForm.day_of_week,
        starts_at: scheduleForm.starts_at,
        ends_at: scheduleForm.ends_at,
        room: scheduleForm.room.trim() || null,
        is_active: true,
      })
      .select('id,class_id,day_of_week,starts_at,ends_at,room,is_active')
      .single()
    if (error) throw error
    schedules.value.push(data as ScheduleRow)
    schedules.value.sort((a, b) => a.day_of_week - b.day_of_week || a.starts_at.localeCompare(b.starts_at))
    showSuccess('Weekly schedule added.')
  } catch (error) {
    showError(error)
  } finally {
    savingSchedule.value = false
  }
}

async function createMeeting() {
  if (!selectedClassId.value) return
  savingMeeting.value = true
  clearMessage()
  try {
    validateMeetingWindow()
    const isOnline = meetingForm.mode === 'self_online'
    const creatorId = await currentUserId()
    const { data, error } = await supabase
      .from('meetings')
      .insert({
        class_id: selectedClassId.value,
        title: meetingForm.title.trim(),
        meeting_date: meetingForm.starts_at.slice(0, 10),
        starts_at: new Date(meetingForm.starts_at).toISOString(),
        ends_at: new Date(meetingForm.ends_at).toISOString(),
        attendance_mode: meetingForm.mode,
        attendance_enabled: true,
        attendance_opens_at: new Date(meetingForm.check_in_opens_at).toISOString(),
        attendance_closes_at: new Date(meetingForm.check_in_closes_at).toISOString(),
        latitude: isOnline ? null : requiredNumber(meetingForm.latitude, 'latitude'),
        longitude: isOnline ? null : requiredNumber(meetingForm.longitude, 'longitude'),
        radius_m: isOnline ? 100 : requiredNumber(meetingForm.allowed_radius_m, 'radius'),
        max_accuracy_m: activeClass.value?.default_max_accuracy_m ?? 100,
        created_by: creatorId,
      })
      .select(
        'id,class_id,title,starts_at,ends_at,attendance_mode,attendance_enabled,attendance_opens_at,attendance_closes_at,latitude,longitude,radius_m,max_accuracy_m',
      )
      .single()
    if (error) throw error
    meetings.value.unshift(data as MeetingRow)
    selectedMeetingId.value = data.id
    meetingForm.title = ''
    showSuccess('Meeting and attendance window created.')
  } catch (error) {
    showError(error)
  } finally {
    savingMeeting.value = false
  }
}

async function disableAttendance(meeting: MeetingRow) {
  updatingMeeting.value = true
  clearMessage()
  try {
    const { error } = await supabase
      .from('meetings')
      .update({ attendance_enabled: false })
      .eq('id', meeting.id)
    if (error) throw error
    meeting.attendance_enabled = false
    showSuccess('Attendance checking is disabled for this meeting.')
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
      .select(
        'id,meeting_id,student_id,status,source,selfie_path,latitude,longitude,accuracy_m,distance_m,barcode_verified,verification_status,teacher_note,review_note,submitted_at,created_at',
      )
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
  const starts = new Date(meetingForm.starts_at).getTime()
  const ends = new Date(meetingForm.ends_at).getTime()
  const opens = new Date(meetingForm.check_in_opens_at).getTime()
  const closes = new Date(meetingForm.check_in_closes_at).getTime()
  if ([starts, ends, opens, closes].some(Number.isNaN)) throw new Error('Complete all meeting date and time fields.')
  if (ends <= starts) throw new Error('Meeting end must be after its start.')
  if (closes <= opens) throw new Error('Check-in close must be after check-in open.')
}

function requiredNumber(value: string, label: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Enter a valid ${label}.`)
  return parsed
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
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatTime(value: string) {
  const [hours = '0', minutes = '00'] = value.split(':')
  const date = new Date()
  date.setHours(Number(hours), Number(minutes), 0, 0)
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

function mapUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`
}

function showError(error: unknown) {
  messageKind.value = 'error'
  message.value = error instanceof Error ? error.message : 'Something went wrong.'
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
.form-grid {
  display: grid;
  gap: 12px;
}

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

.meeting-actions,
.review-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
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

@media (min-width: 720px) {
  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .form-grid > ion-note,
  .form-grid > ion-button {
    grid-column: 1 / -1;
  }
}
</style>
