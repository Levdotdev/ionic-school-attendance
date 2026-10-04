<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Teacher approvals</ion-title>
        <ion-buttons slot="end">
          <ion-button :disabled="signingOut" @click="logout">Sign out</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="section-heading">
        <div>
          <h2>Teacher registrations</h2>
          <p>Review each applicant before they can use teacher tools or manage attendance.</p>
        </div>
        <ion-button fill="outline" size="small" :disabled="loading" @click="loadApplicants">
          Refresh
        </ion-button>
      </div>

      <ion-card v-if="message" :color="messageKind === 'error' ? 'danger' : 'success'">
        <ion-card-content>{{ message }}</ion-card-content>
      </ion-card>

      <div v-if="loading" class="centered">
        <ion-spinner name="crescent" />
      </div>

      <ion-card v-else-if="applicants.length === 0">
        <ion-card-header>
          <ion-card-title>No teacher registrations</ion-card-title>
        </ion-card-header>
        <ion-card-content>New teacher applicants will appear here.</ion-card-content>
      </ion-card>

      <template v-else>
        <ion-card v-for="applicant in applicants" :key="applicant.id">
          <ion-card-header>
            <div class="applicant-heading">
              <div>
                <ion-card-title>{{ applicant.full_name }}</ion-card-title>
                <ion-card-subtitle>{{ applicant.email }}</ion-card-subtitle>
              </div>
              <ion-badge :color="statusColor(applicant.teacher_approval_status)">
                {{ statusLabel(applicant.teacher_approval_status) }}
              </ion-badge>
            </div>
          </ion-card-header>
          <ion-card-content>
            <p>Registered {{ formatDateTime(applicant.created_at) }}</p>
            <p v-if="applicant.teacher_approved_at">
              Last reviewed {{ formatDateTime(applicant.teacher_approved_at) }}
            </p>

            <ion-textarea
              v-model="reviewNotes[applicant.id]"
              label="Decision note (optional)"
              label-placement="stacked"
              fill="outline"
              auto-grow
              :disabled="reviewingTeacherId === applicant.id"
              placeholder="Add a note the teacher can see"
            />

            <div class="review-buttons">
              <ion-button
                color="success"
                size="small"
                :disabled="reviewingTeacherId === applicant.id"
                @click="reviewApplicant(applicant, 'approved')"
              >
                <ion-spinner v-if="reviewingTeacherId === applicant.id && reviewDecision === 'approved'" name="crescent" />
                <span v-else>Approve</span>
              </ion-button>
              <ion-button
                color="danger"
                fill="outline"
                size="small"
                :disabled="reviewingTeacherId === applicant.id"
                @click="reviewApplicant(applicant, 'rejected')"
              >
                <ion-spinner v-if="reviewingTeacherId === applicant.id && reviewDecision === 'rejected'" name="crescent" />
                <span v-else>Reject</span>
              </ion-button>
            </div>
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
  IonPage,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useSession } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'
import type { TeacherApprovalStatus } from '@/types/database'

interface TeacherApplicant {
  id: string
  full_name: string
  email: string
  teacher_approval_status: TeacherApprovalStatus | null
  teacher_approval_note: string | null
  teacher_approved_at: string | null
  created_at: string
}

const router = useRouter()
const { initializeSession, profile, signOut } = useSession()
const applicants = ref<TeacherApplicant[]>([])
const reviewNotes = reactive<Record<string, string>>({})
const loading = ref(true)
const reviewingTeacherId = ref('')
const reviewDecision = ref<TeacherApprovalStatus | null>(null)
const signingOut = ref(false)
const message = ref('')
const messageKind = ref<'success' | 'error'>('success')

async function loadApplicants() {
  loading.value = true
  clearMessage()

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id,full_name,email,teacher_approval_status,teacher_approval_note,teacher_approved_at,created_at',
      )
      .eq('role', 'teacher')
      .order('created_at', { ascending: false })
    if (error) throw error

    applicants.value = ((data ?? []) as TeacherApplicant[]).sort(
      (first, second) =>
        statusPriority(first.teacher_approval_status) - statusPriority(second.teacher_approval_status)
        || second.created_at.localeCompare(first.created_at),
    )
    for (const applicant of applicants.value) {
      reviewNotes[applicant.id] = applicant.teacher_approval_note ?? ''
    }
  } catch (error) {
    applicants.value = []
    showError(error)
  } finally {
    loading.value = false
  }
}

async function reviewApplicant(
  applicant: TeacherApplicant,
  decision: Extract<TeacherApprovalStatus, 'approved' | 'rejected'>,
) {
  reviewingTeacherId.value = applicant.id
  reviewDecision.value = decision
  clearMessage()

  try {
    const { error } = await supabase.rpc('review_teacher_registration', {
      p_teacher_id: applicant.id,
      p_decision: decision,
      p_note: reviewNotes[applicant.id]?.trim() || null,
    })
    if (error) throw error

    await loadApplicants()
    showSuccess(`${applicant.full_name}'s registration was ${decision}.`)
  } catch (error) {
    showError(error)
  } finally {
    reviewingTeacherId.value = ''
    reviewDecision.value = null
  }
}

function statusColor(status: TeacherApprovalStatus | null) {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  return 'warning'
}

function statusPriority(status: TeacherApprovalStatus | null) {
  if (status === 'approved') return 2
  if (status === 'rejected') return 1
  return 0
}

function statusLabel(status: TeacherApprovalStatus | null) {
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  return 'Pending'
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function showError(error: unknown) {
  messageKind.value = 'error'
  message.value = error instanceof Error ? error.message : 'Unable to review teacher registrations.'
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

onMounted(async () => {
  await initializeSession()
  if (profile.value?.role === 'admin') await loadApplicants()
  else loading.value = false
})
</script>

<style scoped>
.centered {
  display: grid;
  min-height: 40vh;
  place-items: center;
}

.section-heading,
.applicant-heading,
.review-buttons {
  display: flex;
  gap: 1rem;
  align-items: start;
  justify-content: space-between;
}

.section-heading {
  margin-bottom: 1rem;
}

.section-heading h2,
.section-heading p,
.applicant-heading ion-card-title,
.applicant-heading ion-card-subtitle {
  margin: 0 0 0.25rem;
}

.review-buttons {
  flex-wrap: wrap;
  justify-content: flex-start;
  margin-top: 1rem;
}
</style>
