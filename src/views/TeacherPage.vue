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
      <div v-if="approvalLoading" class="centered">
        <ion-spinner name="crescent" />
      </div>

      <ion-card v-else-if="!teacherApproved" class="approval-card">
        <ion-card-header>
          <ion-card-title>
            {{ teacherApprovalStatus === 'rejected' ? 'Teacher registration rejected' : 'Approval pending' }}
          </ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-badge :color="teacherApprovalStatus === 'rejected' ? 'danger' : 'warning'">
            {{ teacherApprovalStatus === 'rejected' ? 'Rejected' : 'Pending' }}
          </ion-badge>
          <p v-if="teacherApprovalStatus === 'rejected'">
            Your teacher registration was not approved. Contact the school administrator if you need the decision reviewed.
          </p>
          <p v-else>
            An administrator must approve your teacher registration before you can create classes or manage attendance.
          </p>
          <p v-if="teacherApprovalNote"><strong>Administrator note:</strong> {{ teacherApprovalNote }}</p>
          <ion-button fill="outline" size="small" @click="checkApprovalStatus">Check status</ion-button>
        </ion-card-content>
      </ion-card>

      <template v-else>
        <ion-card>
          <ion-card-header>
            <ion-card-title>{{ editingClassId ? 'Edit class' : 'Create a class' }}</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <form class="form-grid" @submit.prevent="saveClass">
              <ion-input v-model="classForm.name" label="Class name" label-placement="stacked" fill="outline" required />
              <ion-input v-model="classForm.section" label="Section" label-placement="stacked" fill="outline" />
              <ion-note class="full-row">
                School location is set automatically: {{ SCHOOL_LATITUDE }}, {{ SCHOOL_LONGITUDE }} within
                {{ SCHOOL_RADIUS_M }} meters.
              </ion-note>
              <div class="form-actions full-row">
                <ion-button type="submit" :disabled="savingClass">
                  <ion-spinner v-if="savingClass" name="crescent" />
                  <span v-else>{{ editingClassId ? 'Save class' : 'Create class' }}</span>
                </ion-button>
                <ion-button v-if="editingClassId" type="button" fill="outline" :disabled="savingClass" @click="cancelClassEdit">
                  Cancel
                </ion-button>
              </div>
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
              <p><strong>School boundary:</strong> {{ SCHOOL_RADIUS_M }} meters from the saved school center</p>
              <div class="row-actions">
                <ion-button size="small" fill="outline" @click="beginClassEdit(activeClass)">Edit class</ion-button>
                <ion-button size="small" fill="outline" color="danger" :disabled="savingClass" @click="deleteClass(activeClass)">
                  Delete class
                </ion-button>
              </div>
            </div>
          </ion-card-content>
        </ion-card>

        <template v-if="activeClass">
          <ion-card>
            <ion-card-header>
              <ion-card-title>Weekly schedule</ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <ion-note>
                {{ currentWeekLabel }}. Each active schedule automatically creates one meeting for this week.
              </ion-note>

              <form class="form-grid spaced-form" @submit.prevent="saveSchedule">
                <ion-select v-model="scheduleForm.day_of_week" label="Day" label-placement="stacked" fill="outline">
                  <ion-select-option v-for="day in weekdays" :key="day.value" :value="day.value">
                    {{ day.label }}
                  </ion-select-option>
                </ion-select>
                <ion-input v-model="scheduleForm.starts_at" label="Starts" label-placement="stacked" fill="outline" type="time" required />
                <ion-input v-model="scheduleForm.ends_at" label="Ends" label-placement="stacked" fill="outline" type="time" required />
                <ion-input v-model="scheduleForm.room" label="Room (optional)" label-placement="stacked" fill="outline" />
                <div class="form-actions full-row">
                  <ion-button type="submit" :disabled="savingSchedule">
                    {{ editingScheduleId ? 'Save schedule' : 'Add schedule' }}
                  </ion-button>
                  <ion-button
                    v-if="editingScheduleId"
                    type="button"
                    fill="outline"
                    :disabled="savingSchedule"
                    @click="cancelScheduleEdit"
                  >
                    Cancel
                  </ion-button>
                </div>
              </form>

              <ion-list v-if="schedules.length">
                <ion-item v-for="schedule in schedules" :key="schedule.id">
                  <ion-label>
                    <h3>{{ dayLabel(schedule.day_of_week) }} - {{ scheduleDateLabel(schedule.day_of_week) }}</h3>
                    <p>
                      {{ formatTime(schedule.starts_at) }} - {{ formatTime(schedule.ends_at) }}
                      <span v-if="schedule.room"> - {{ schedule.room }}</span>
                    </p>
                    <ion-badge v-if="!schedule.is_active" color="medium">Inactive</ion-badge>
                  </ion-label>
                  <div slot="end" class="item-actions">
                    <ion-button size="small" fill="outline" @click="beginScheduleEdit(schedule)">Edit</ion-button>
                    <ion-button size="small" fill="outline" color="danger" @click="deleteSchedule(schedule)">Delete</ion-button>
                  </div>
                </ion-item>
              </ion-list>
              <ion-note v-else>No weekly schedule has been added.</ion-note>
            </ion-card-content>
          </ion-card>

          <ion-card>
            <ion-card-header>
              <ion-card-title>{{ editingMeetingId ? 'Edit meeting' : 'Create an additional meeting' }}</ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <form class="form-grid" @submit.prevent="saveMeeting">
                <ion-input v-model="meetingForm.title" label="Meeting title" label-placement="stacked" fill="outline" required />
                <ion-select v-model="meetingForm.mode" label="Attendance mode" label-placement="stacked" fill="outline">
                  <ion-select-option value="teacher_manual">Teacher marks attendance</ion-select-option>
                  <ion-select-option value="self_on_site">Student self-check on site</ion-select-option>
                  <ion-select-option value="self_event">Student self-check at an event</ion-select-option>
                  <ion-select-option value="self_online">Online class self-check</ion-select-option>
                </ion-select>

                <label class="native-field">
                  <span>Meeting starts</span>
                  <input v-model="meetingForm.starts_at" type="datetime-local" :min="meetingInputMin" :max="meetingInputMax" required />
                </label>
                <label class="native-field">
                  <span>Meeting ends</span>
                  <input v-model="meetingForm.ends_at" type="datetime-local" :min="meetingInputMin" :max="meetingInputMax" required />
                </label>
                <label class="native-field">
                  <span>Check-in opens</span>
                  <input v-model="meetingForm.check_in_opens_at" type="datetime-local" :min="meetingInputMin" :max="meetingInputMax" required />
                </label>
                <label class="native-field">
                  <span>Check-in closes</span>
                  <input v-model="meetingForm.check_in_closes_at" type="datetime-local" :min="meetingInputMin" :max="meetingInputMax" required />
                </label>

                <ion-note class="full-row">
                  Additional meetings must be within {{ currentWeekLabel.toLowerCase() }}.
                  Physical self-checks automatically use the school location and {{ SCHOOL_RADIUS_M }}-meter boundary.
                  Online self-checks do not request location.
                </ion-note>
                <div class="form-actions full-row">
                  <ion-button type="submit" :disabled="savingMeeting">
                    {{ editingMeetingId ? 'Save meeting' : 'Create meeting' }}
                  </ion-button>
                  <ion-button
                    v-if="editingMeetingId"
                    type="button"
                    fill="outline"
                    :disabled="savingMeeting"
                    @click="cancelMeetingEdit"
                  >
                    Cancel
                  </ion-button>
                </div>
              </form>
            </ion-card-content>
          </ion-card>

          <ion-card>
            <ion-card-header>
              <ion-card-title>This week's meetings</ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <ion-note>{{ currentWeekLabel }}. Older and future meetings are hidden here.</ion-note>
              <ion-item v-if="meetings.length">
                <ion-select v-model="selectedMeetingId" label="Attendance meeting" label-placement="stacked">
                  <ion-select-option v-for="meeting in meetings" :key="meeting.id" :value="meeting.id">
                    {{ meeting.title }} - {{ formatDateTime(meeting.starts_at) }}
                  </ion-select-option>
                </ion-select>
              </ion-item>
              <ion-note v-else>No meetings are scheduled for this week.</ion-note>

              <div v-if="selectedMeeting" class="meeting-actions">
                <div>
                  <ion-badge :color="selectedMeeting.attendance_enabled ? 'success' : 'medium'">
                    {{ selectedMeeting.attendance_enabled ? 'Attendance counts' : 'Attendance does not count' }}
                  </ion-badge>
                  <ion-badge color="tertiary">{{ modeLabel(selectedMeeting.attendance_mode) }}</ion-badge>
                  <ion-badge v-if="selectedMeeting.schedule_id" color="primary">Weekly</ion-badge>
                </div>
                <ion-button
                  :color="selectedMeeting.attendance_enabled ? 'warning' : 'success'"
                  fill="outline"
                  size="small"
                  :disabled="updatingMeeting"
                  @click="toggleAttendance(selectedMeeting)"
                >
                  {{ selectedMeeting.attendance_enabled ? 'Do not count this meeting' : 'Count this meeting' }}
                </ion-button>
                <ion-button size="small" fill="outline" :disabled="updatingMeeting" @click="beginMeetingEdit(selectedMeeting)">
                  Edit meeting
                </ion-button>
                <ion-button
                  size="small"
                  fill="outline"
                  color="danger"
                  :disabled="updatingMeeting"
                  @click="deleteMeeting(selectedMeeting)"
                >
                  Delete meeting
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
</style>
