<template>
  <ion-page class="admin-page">
    <ion-header class="app-header">
      <ion-toolbar class="app-toolbar">
        <ion-title>
          <span class="toolbar-brand">
            <span class="toolbar-mark" aria-hidden="true"><ion-icon :icon="schoolOutline" /></span>
            <span><strong>MinSU Attendance</strong><small>Administration</small></span>
          </span>
        </ion-title>
        <ion-buttons slot="end">
          <ion-button
            class="sign-out-button"
            aria-label="Sign out of the administration portal"
            :disabled="signingOut"
            @click="logout"
          >
            <ion-icon slot="start" :icon="logOutOutline" aria-hidden="true" />
            <span class="button-label">Sign out</span>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="admin-content">
      <main class="admin-shell">
        <header class="page-heading">
          <div>
            <p class="eyebrow">School administration</p>
            <h1>Teacher approvals</h1>
            <p>Review teacher registrations before they can create classes or manage attendance.</p>
          </div>
          <ion-button class="secondary-button" fill="outline" :disabled="loading" @click="loadApplicants">
            <ion-spinner v-if="loading" name="crescent" />
            <ion-icon v-else slot="start" :icon="refreshOutline" aria-hidden="true" />
            <span>Refresh</span>
          </ion-button>
        </header>

        <section class="summary-grid" aria-label="Teacher registration totals">
          <article class="summary-card is-pending">
            <span class="summary-icon"><ion-icon :icon="hourglassOutline" /></span>
            <span><small>Needs review</small><strong>{{ pendingCount }}</strong></span>
          </article>
          <article class="summary-card is-approved">
            <span class="summary-icon"><ion-icon :icon="checkmarkCircleOutline" /></span>
            <span><small>Approved</small><strong>{{ approvedCount }}</strong></span>
          </article>
          <article class="summary-card is-rejected">
            <span class="summary-icon"><ion-icon :icon="closeCircleOutline" /></span>
            <span><small>Rejected</small><strong>{{ rejectedCount }}</strong></span>
          </article>
        </section>

        <div
          v-if="message"
          class="page-message"
          :class="messageKind === 'error' ? 'is-error' : 'is-success'"
          :role="messageKind === 'error' ? 'alert' : 'status'"
        >
          <ion-icon :icon="messageKind === 'error' ? alertCircleOutline : checkmarkCircleOutline" aria-hidden="true" />
          <span>{{ message }}</span>
        </div>

        <section class="queue-card" aria-labelledby="queue-heading">
          <header class="queue-heading">
            <div>
              <p class="eyebrow">Registration queue</p>
              <h2 id="queue-heading">{{ selectedView === 'pending' ? 'Needs review' : 'All teachers' }}</h2>
            </div>
            <ion-segment v-model="selectedView" class="queue-filter" aria-label="Filter teacher registrations">
              <ion-segment-button value="pending">
                <ion-label>Pending {{ pendingCount }}</ion-label>
              </ion-segment-button>
              <ion-segment-button value="all">
                <ion-label>All {{ applicants.length }}</ion-label>
              </ion-segment-button>
            </ion-segment>
          </header>

          <div v-if="loading" class="loading-state" role="status" aria-label="Loading teacher registrations">
            <ion-spinner name="crescent" />
            <p>Loading teacher registrations…</p>
          </div>

          <div v-else-if="visibleApplicants.length === 0" class="queue-empty">
            <span class="empty-icon" aria-hidden="true">
              <ion-icon :icon="selectedView === 'pending' ? shieldCheckmarkOutline : peopleOutline" />
            </span>
            <h3>{{ selectedView === 'pending' ? 'The approval queue is clear' : 'No teacher registrations yet' }}</h3>
            <p>
              {{ selectedView === 'pending'
                ? 'There are no teacher accounts waiting for a decision.'
                : 'New teacher registrations will appear here for review.' }}
            </p>
          </div>

          <div v-else class="applicant-list">
            <article
              v-for="applicant in visibleApplicants"
              :key="applicant.id"
              class="applicant-row"
              :class="`is-${applicant.teacher_approval_status ?? 'pending'}`"
            >
              <div class="applicant-summary">
                <span class="applicant-avatar" aria-hidden="true">{{ initials(applicant.full_name) }}</span>
                <div class="applicant-copy">
                  <div class="name-line">
                    <h3>{{ applicant.full_name }}</h3>
                    <span class="status-pill" :class="`is-${applicant.teacher_approval_status ?? 'pending'}`">
                      <span aria-hidden="true"></span>
                      {{ statusLabel(applicant.teacher_approval_status) }}
                    </span>
                  </div>
                  <p><ion-icon :icon="mailOutline" aria-hidden="true" /> {{ applicant.email }}</p>
                  <small>
                    <ion-icon :icon="timeOutline" aria-hidden="true" />
                    Registered {{ formatDateTime(applicant.created_at) }}
                    <template v-if="applicant.teacher_approved_at">
                      · Reviewed {{ formatDateTime(applicant.teacher_approved_at) }}
                    </template>
                  </small>
                </div>
              </div>

              <div class="review-panel">
                <ion-textarea
                  v-model="reviewNotes[applicant.id]"
                  class="review-note"
                  label="Decision note (optional)"
                  label-placement="stacked"
                  fill="outline"
                  auto-grow
                  :disabled="reviewingTeacherId === applicant.id"
                  placeholder="Add a short note the teacher can see"
                />

                <div
                  class="review-buttons"
                  role="group"
                  :aria-label="`Review ${applicant.full_name}'s registration`"
                >
                  <ion-button
                    class="reject-button"
                    fill="outline"
                    :aria-label="`Reject ${applicant.full_name}'s teacher registration`"
                    :disabled="reviewingTeacherId === applicant.id"
                    @click="reviewApplicant(applicant, 'rejected')"
                  >
                    <ion-spinner
                      v-if="reviewingTeacherId === applicant.id && reviewDecision === 'rejected'"
                      name="crescent"
                    />
                    <template v-else>
                      <ion-icon slot="start" :icon="closeCircleOutline" aria-hidden="true" />
                      Reject
                    </template>
                  </ion-button>
                  <ion-button
                    class="approve-button"
                    :aria-label="`Approve ${applicant.full_name}'s teacher registration`"
                    :disabled="reviewingTeacherId === applicant.id"
                    @click="reviewApplicant(applicant, 'approved')"
                  >
                    <ion-spinner
                      v-if="reviewingTeacherId === applicant.id && reviewDecision === 'approved'"
                      name="crescent"
                    />
                    <template v-else>
                      <ion-icon slot="start" :icon="checkmarkCircleOutline" aria-hidden="true" />
                      Approve
                    </template>
                  </ion-button>
                </div>
              </div>
            </article>
          </div>
        </section>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonLabel,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import {
  alertCircleOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  hourglassOutline,
  logOutOutline,
  mailOutline,
  peopleOutline,
  refreshOutline,
  schoolOutline,
  shieldCheckmarkOutline,
  timeOutline,
} from 'ionicons/icons'
import { computed, onMounted, reactive, ref } from 'vue'
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

type QueueView = 'pending' | 'all'

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
const selectedView = ref<QueueView>('pending')

const pendingCount = computed(() => applicants.value.filter((applicant) => !applicant.teacher_approval_status || applicant.teacher_approval_status === 'pending').length)
const approvedCount = computed(() => applicants.value.filter((applicant) => applicant.teacher_approval_status === 'approved').length)
const rejectedCount = computed(() => applicants.value.filter((applicant) => applicant.teacher_approval_status === 'rejected').length)
const visibleApplicants = computed(() => selectedView.value === 'all'
  ? applicants.value
  : applicants.value.filter((applicant) => !applicant.teacher_approval_status || applicant.teacher_approval_status === 'pending'))

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

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'TR'
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
.admin-page {
  --campus-accent-local: var(--campus-accent, #245f86);
  --campus-navy-local: var(--campus-navy, #15364e);
  --campus-bg-local: var(--campus-bg, #eef3f7);
  --campus-surface-local: var(--campus-surface, #ffffff);
  --campus-accent-soft-local: var(--campus-accent-soft, #e1edf5);
  --campus-text-local: var(--campus-text, #182632);
  --campus-muted-local: var(--campus-muted, #62727f);
  --campus-border-local: var(--campus-border, #d9e2e9);
  --campus-success-local: var(--campus-success, #147a50);
  --campus-success-soft-local: var(--campus-success-soft, #e1f4eb);
  --campus-danger-local: var(--campus-danger, #bb3e45);
  --campus-danger-soft-local: var(--campus-danger-soft, #fae9ea);
  --campus-warning-local: var(--campus-warning, #91620d);
  --campus-warning-soft-local: var(--campus-warning-soft, #fff3d5);
  color: var(--campus-text-local);
}

.app-header {
  box-shadow: none;
}

.app-toolbar {
  --background: var(--campus-surface-local);
  --border-color: var(--campus-border-local);
  --min-height: 70px;
  --padding-start: max(14px, calc((100vw - 1120px) / 2));
  --padding-end: max(8px, calc((100vw - 1120px) / 2));
}

.toolbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}

.toolbar-mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 12px;
  background: var(--campus-navy-local);
  color: #ffffff;
}

.toolbar-brand strong,
.toolbar-brand small {
  display: block;
}

.toolbar-brand strong {
  font-size: 14px;
  font-weight: 650;
}

.toolbar-brand small {
  margin-top: 2px;
  color: var(--campus-muted-local);
  font-size: 11px;
}

.sign-out-button {
  --color: var(--campus-muted-local);
  text-transform: none;
}

.admin-content {
  --background: var(--campus-bg-local);
}

.admin-shell {
  width: min(100%, 1120px);
  margin: 0 auto;
  padding: 34px 20px 64px;
}

.page-heading,
.queue-heading,
.name-line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.page-heading {
  margin-bottom: 22px;
}

.eyebrow {
  margin: 0 0 6px;
  color: var(--campus-muted-local);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.page-heading h1,
.queue-heading h2,
.queue-empty h3,
.applicant-copy h3 {
  margin: 0;
  color: var(--campus-text-local);
  font-weight: 600;
  letter-spacing: -0.025em;
}

.page-heading h1 {
  font-size: clamp(27px, 4vw, 38px);
}

.page-heading > div > p:last-child {
  max-width: 610px;
  margin: 7px 0 0;
  color: var(--campus-muted-local);
  font-size: 13px;
  line-height: 1.5;
}

.secondary-button,
.approve-button,
.reject-button {
  --border-radius: 11px;
  --box-shadow: none;
  min-height: 42px;
  margin: 0;
  font-weight: 600;
  text-transform: none;
}

.secondary-button {
  --border-color: var(--campus-border-local);
  --color: var(--campus-accent-local);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.summary-card {
  display: flex;
  align-items: center;
  gap: 13px;
  min-height: 88px;
  padding: 17px;
  border: 1px solid var(--campus-border-local);
  border-radius: 16px;
  background: var(--campus-surface-local);
}

.summary-icon {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 13px;
  font-size: 21px;
}

.summary-card small,
.summary-card strong {
  display: block;
}

.summary-card small {
  color: var(--campus-muted-local);
  font-size: 11px;
}

.summary-card strong {
  margin-top: 2px;
  color: var(--campus-text-local);
  font-size: 24px;
  font-weight: 650;
}

.summary-card.is-pending .summary-icon {
  background: var(--campus-warning-soft-local);
  color: var(--campus-warning-local);
}

.summary-card.is-approved .summary-icon {
  background: var(--campus-success-soft-local);
  color: var(--campus-success-local);
}

.summary-card.is-rejected .summary-icon {
  background: var(--campus-danger-soft-local);
  color: var(--campus-danger-local);
}

.page-message {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-bottom: 20px;
  padding: 13px 15px;
  border-radius: 13px;
  font-size: 13px;
  line-height: 1.45;
}

.page-message ion-icon {
  flex: 0 0 auto;
  margin-top: 1px;
  font-size: 18px;
}

.page-message.is-error {
  background: var(--campus-danger-soft-local);
  color: var(--campus-danger-local);
}

.page-message.is-success {
  background: var(--campus-success-soft-local);
  color: var(--campus-success-local);
}

.queue-card {
  overflow: hidden;
  border: 1px solid var(--campus-border-local);
  border-radius: var(--campus-radius, 20px);
  background: var(--campus-surface-local);
  box-shadow: var(--campus-shadow, 0 15px 45px rgba(21, 54, 78, 0.055));
}

.queue-heading {
  align-items: center;
  padding: 22px 24px;
  border-bottom: 1px solid var(--campus-border-local);
}

.queue-heading h2 {
  font-size: 19px;
}

.queue-filter {
  width: min(100%, 270px);
  padding: 4px;
  border-radius: 12px;
  background: var(--campus-bg-local);
}

.queue-filter ion-segment-button {
  --border-radius: 9px;
  --indicator-color: var(--campus-surface-local);
  --color: var(--campus-muted-local);
  --color-checked: var(--campus-accent-local);
  min-height: 37px;
  font-size: 11px;
  font-weight: 600;
}

.loading-state,
.queue-empty {
  display: grid;
  min-height: 300px;
  place-items: center;
  align-content: center;
  gap: 9px;
  padding: 30px;
  color: var(--campus-muted-local);
  text-align: center;
}

.loading-state p,
.queue-empty p {
  max-width: 420px;
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

.queue-empty h3 {
  font-size: 18px;
}

.empty-icon {
  display: grid;
  width: 56px;
  height: 56px;
  place-items: center;
  margin-bottom: 5px;
  border-radius: 17px;
  background: var(--campus-success-soft-local);
  color: var(--campus-success-local);
  font-size: 26px;
}

.applicant-list {
  padding: 0 24px;
}

.applicant-row {
  display: grid;
  grid-template-columns: minmax(280px, 0.95fr) minmax(360px, 1.05fr);
  gap: 28px;
  padding: 22px 0;
  border-top: 1px solid var(--campus-border-local);
}

.applicant-row:first-child {
  border-top: 0;
}

.applicant-summary {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
}

.applicant-avatar {
  display: grid;
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 14px;
  background: var(--campus-accent-soft-local);
  color: var(--campus-accent-local);
  font-size: 12px;
  font-weight: 700;
}

.applicant-copy {
  min-width: 0;
  flex: 1;
}

.name-line {
  align-items: center;
  gap: 10px;
}

.applicant-copy h3 {
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.applicant-copy p,
.applicant-copy small {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  margin: 6px 0 0;
  color: var(--campus-muted-local);
  font-size: 11px;
  line-height: 1.45;
}

.applicant-copy p {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.applicant-copy ion-icon {
  flex: 0 0 auto;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 9px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;
}

.status-pill > span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.status-pill.is-pending {
  background: var(--campus-warning-soft-local);
  color: var(--campus-warning-local);
}

.status-pill.is-approved {
  background: var(--campus-success-soft-local);
  color: var(--campus-success-local);
}

.status-pill.is-rejected {
  background: var(--campus-danger-soft-local);
  color: var(--campus-danger-local);
}

.review-panel {
  min-width: 0;
}

.review-note {
  --border-color: var(--campus-border-local);
  --border-radius: 11px;
  --highlight-color-focused: var(--campus-accent-local);
  min-height: 74px;
  color: var(--campus-text-local);
  font-size: 12px;
}

.review-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.approve-button {
  --background: var(--campus-success-local);
  --background-hover: var(--campus-success-local);
  --background-hover-opacity: 0.88;
}

.reject-button {
  --border-color: var(--campus-danger-local);
  --color: var(--campus-danger-local);
}

@media (max-width: 820px) {
  .applicant-row {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}

@media (max-width: 600px) {
  .app-toolbar {
    --min-height: 62px;
  }

  .toolbar-brand small,
  .button-label {
    display: none;
  }

  .admin-shell {
    padding: 24px 14px 44px;
  }

  .page-heading,
  .queue-heading {
    display: grid;
  }

  .secondary-button {
    width: fit-content;
  }

  .summary-grid {
    gap: 7px;
  }

  .summary-card {
    display: grid;
    justify-items: center;
    gap: 7px;
    min-height: 104px;
    padding: 12px 8px;
    text-align: center;
  }

  .summary-card small {
    font-size: 9px;
  }

  .summary-card strong {
    font-size: 20px;
  }

  .queue-heading,
  .applicant-list {
    padding-right: 16px;
    padding-left: 16px;
  }

  .queue-filter {
    width: 100%;
  }

  .name-line {
    align-items: flex-start;
  }

  .review-buttons > ion-button {
    flex: 1;
  }
}

@media (max-width: 380px) {
  .applicant-summary {
    display: grid;
  }
}
</style>
