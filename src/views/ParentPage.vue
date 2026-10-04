<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Parent attendance</ion-title>
        <ion-buttons slot="end">
          <ion-button :disabled="signingOut" @click="logout">Sign out</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div v-if="loading" class="centered">
        <ion-spinner name="crescent" />
      </div>

      <template v-else>
        <div class="section-heading">
          <div>
            <h2>Linked students</h2>
            <p>Attendance and submitted location are shown here. Student selfies remain visible only to teachers.</p>
          </div>
          <ion-button fill="outline" size="small" :disabled="refreshing" @click="loadDashboard">
            Refresh
          </ion-button>
        </div>

        <ion-note v-if="message" color="danger" role="alert">{{ message }}</ion-note>

        <ion-card v-if="students.length === 0">
          <ion-card-header>
            <ion-card-title>No student is linked yet</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            Ask the student to use this account's confirmed email address as their parent or guardian email during registration.
          </ion-card-content>
        </ion-card>

        <ion-card v-for="student in students" :key="student.id">
          <ion-card-header>
            <ion-card-title>{{ student.full_name }}</ion-card-title>
            <ion-card-subtitle>{{ student.email }}</ion-card-subtitle>
          </ion-card-header>
          <ion-card-content>
            <ion-list v-if="recordsForStudent(student.id).length">
              <ion-item v-for="record in recordsForStudent(student.id)" :key="record.id">
                <ion-label class="ion-text-wrap">
                  <h2>{{ record.class_name }} — {{ record.meeting_title }}</h2>
                  <p>{{ formatDateTime(record.meeting_starts_at) }}</p>
                  <p>
                    <ion-badge :color="record.status === 'present' ? 'success' : 'danger'">
                      {{ record.status }}
                    </ion-badge>
                    <span v-if="record.verification_status === 'pending'"> Awaiting teacher verification</span>
                    <span v-else-if="record.verification_status === 'rejected'"> Evidence rejected</span>
                  </p>
                  <p v-if="record.latitude != null && record.longitude != null">
                    Submitted location:
                    <a :href="mapUrl(record.latitude, record.longitude)" target="_blank" rel="noopener">
                      open map
                    </a>
                    <span v-if="record.distance_m != null"> ({{ Math.round(record.distance_m) }} m from class location)</span>
                  </p>
                  <p v-else>Location was not required for this attendance entry.</p>
                </ion-label>
              </ion-item>
            </ion-list>
            <ion-note v-else>No attendance records are available for this student.</ion-note>
          </ion-card-content>
        </ion-card>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useSession } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'

interface StudentRow {
  id: string
  full_name: string
  email: string
}

interface AttendanceDisplayRow {
  id: string
  student_id: string
  status: 'present' | 'absent'
  verification_status: 'pending' | 'approved' | 'rejected' | null
  latitude: number | null
  longitude: number | null
  distance_m: number | null
  submitted_at: string
  meeting_title: string
  meeting_starts_at: string
  class_name: string
}

const router = useRouter()
const { initializeSession, profile, signOut } = useSession()
const loading = ref(true)
const refreshing = ref(false)
const signingOut = ref(false)
const students = ref<StudentRow[]>([])
const attendance = ref<AttendanceDisplayRow[]>([])
const message = ref('')

async function loadDashboard() {
  refreshing.value = true
  message.value = ''

  try {
    const { data: links, error: linksError } = await supabase
      .from('guardian_links')
      .select('student_id')
      .order('created_at')
    if (linksError) throw linksError

    const studentIds = (links ?? []).map((link) => link.student_id)
    if (!studentIds.length) {
      students.value = []
      attendance.value = []
      return
    }

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id,full_name,email')
      .in('id', studentIds)
    if (profilesError) throw profilesError
    students.value = (profiles ?? []) as StudentRow[]

    const { data: records, error: recordsError } = await supabase
      .from('attendance_records')
      .select('id,meeting_id,student_id,status,verification_status,latitude,longitude,distance_m,submitted_at')
      .in('student_id', studentIds)
      .order('submitted_at', { ascending: false })
    if (recordsError) throw recordsError

    const meetingIds = [...new Set((records ?? []).map((record) => record.meeting_id))]
    if (!meetingIds.length) {
      attendance.value = []
      return
    }

    const { data: meetings, error: meetingsError } = await supabase
      .from('meetings')
      .select('id,class_id,title,starts_at')
      .in('id', meetingIds)
    if (meetingsError) throw meetingsError

    const classIds = [...new Set((meetings ?? []).map((meeting) => meeting.class_id))]
    const { data: classes, error: classesError } = await supabase
      .from('classes')
      .select('id,name')
      .in('id', classIds)
    if (classesError) throw classesError

    const meetingById = new Map((meetings ?? []).map((meeting) => [meeting.id, meeting]))
    const classById = new Map((classes ?? []).map((schoolClass) => [schoolClass.id, schoolClass]))

    attendance.value = (records ?? []).flatMap((record) => {
      const meeting = meetingById.get(record.meeting_id)
      const schoolClass = meeting ? classById.get(meeting.class_id) : null
      if (!meeting || !schoolClass) return []
      return [{
        id: record.id,
        student_id: record.student_id,
        status: record.status,
        verification_status: record.verification_status,
        latitude: record.latitude,
        longitude: record.longitude,
        distance_m: record.distance_m,
        submitted_at: record.submitted_at,
        meeting_title: meeting.title,
        meeting_starts_at: meeting.starts_at,
        class_name: schoolClass.name,
      } as AttendanceDisplayRow]
    })
  } catch (error) {
    students.value = []
    attendance.value = []
    message.value = error instanceof Error ? error.message : 'Unable to load parent attendance.'
  } finally {
    refreshing.value = false
  }
}

function recordsForStudent(studentId: string) {
  return attendance.value.filter((record) => record.student_id === studentId)
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function mapUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`
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

onMounted(async () => {
  try {
    await initializeSession()
    if (profile.value?.role === 'parent') await loadDashboard()
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Unable to load the parent account.'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.centered {
  display: grid;
  min-height: 50vh;
  place-items: center;
}

.section-heading {
  display: flex;
  gap: 1rem;
  align-items: start;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.section-heading h2,
.section-heading p {
  margin: 0 0 0.25rem;
}
</style>
