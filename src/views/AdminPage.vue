<template>
  <ion-page class="admin-page">
    <portal-header portal="Administration" :busy="signingOut" @logout="logout" />

    <ion-content class="admin-content">
      <main class="admin-shell">
        <header class="page-heading">
          <div>
            <p class="eyebrow">School administration</p>
            <h1>{{ activeSection === 'teachers' ? 'Teacher approvals' : activeSection === 'verification' ? 'Student face verification' : activeSection === 'parents' ? 'Family connections' : 'Administration overview' }}</h1>
            <p>{{ activeSection === 'teachers' ? 'Review teacher registrations before they can create classes or manage attendance.' : activeSection === 'verification' ? 'Face enrollment is completed once. Authorize a new enrollment only when a student needs to replace it.' : activeSection === 'parents' ? 'Review each student’s parent-approved links and invite parents to register.' : 'Manage teacher access, family connections, and student verification.' }}</p>
          </div>
        </header>

        <section v-if="activeSection === 'overview'" class="summary-grid" aria-label="Teacher registration totals">
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

        <section v-if="activeSection === 'overview'" class="queue-card overview-next">
          <div><p class="eyebrow">Teacher access</p><h2>{{ pendingCount ? 'Registrations need your review' : 'Your approval queue is clear' }}</h2><p>Review teachers before they can create classes and record student attendance.</p></div>
          <ion-button @click="router.push({ path: '/admin', query: { section: 'teachers' } })">Open teacher approvals</ion-button>
        </section>
        <section v-if="activeSection === 'overview'" class="queue-card overview-next verification-overview"><div><p class="eyebrow">Student identity</p><h2>Face verification access</h2><p>Manage one-time face enrollment and authorize a retake when needed.</p></div><ion-button fill="outline" @click="router.push({ path: '/admin', query: { section: 'verification' } })">Manage verification</ion-button></section>
        <section v-if="activeSection === 'overview'" class="queue-card overview-next verification-overview"><div><p class="eyebrow">Parent access</p><h2>Family connections</h2><p>Inspect student links. Only the parent can approve a new family connection.</p></div><ion-button fill="outline" @click="router.push({ path: '/admin', query: { section: 'parents' } })">View family connections</ion-button></section>

        <div
          v-if="message"
          class="page-message"
          :class="messageKind === 'error' ? 'is-error' : 'is-success'"
          :role="messageKind === 'error' ? 'alert' : 'status'"
        >
          <ion-icon :icon="messageKind === 'error' ? alertCircleOutline : checkmarkCircleOutline" aria-hidden="true" />
          <span>{{ message }}</span>
        </div>

        <section v-if="activeSection === 'verification'" class="queue-card" aria-labelledby="verification-heading">
          <header class="queue-heading"><div><p class="eyebrow">Student identity</p><h2 id="verification-heading">Face enrollment</h2></div><label class="student-search"><span class="sr-only">Find a student</span><input v-model="studentSearch" type="search" placeholder="Search student name or email" /></label></header>
          <div class="status-tabs" role="group" aria-label="Face enrollment status"><button type="button" :aria-pressed="faceView === 'enrolled'" :class="{ selected: faceView === 'enrolled' }" @click="faceView = 'enrolled'">Enrolled <span>{{ enrolledCount }}</span></button><button type="button" :aria-pressed="faceView === 'not_enrolled'" :class="{ selected: faceView === 'not_enrolled' }" @click="faceView = 'not_enrolled'">Not enrolled <span>{{ faceStudents.length - enrolledCount }}</span></button></div>
          <div v-if="loadingFaces" class="loading-state" role="status"><ion-spinner name="crescent" /><p>Loading verification access…</p></div>
          <div v-else-if="!visibleStudents.length" class="queue-empty"><span class="empty-icon"><ion-icon :icon="peopleOutline" /></span><h3>{{ studentSearch ? 'No matching students' : faceView === 'enrolled' ? 'No enrolled students' : 'Every registered student is enrolled' }}</h3></div>
          <div v-else class="applicant-list"><article v-for="student in visibleStudents" :key="student.student_id" class="applicant-row verification-row"><div class="applicant-summary"><span class="applicant-avatar">{{ initials(student.full_name || 'Student') }}</span><div class="applicant-copy"><h3>{{ student.full_name || 'Student' }}</h3><p>{{ student.email }}</p><small>{{ student.enrolled ? `Enrolled ${formatDateTime(student.enrolled_at)}` : 'Face enrollment not completed' }}</small><small v-if="student.can_retake">A one-time retake is authorized.</small></div></div><div class="review-panel verification-actions"><span class="status-pill" :class="student.can_retake ? 'is-pending' : student.enrolled ? 'is-approved' : 'is-rejected'">{{ student.can_retake ? 'Retake authorized' : student.enrolled ? 'Enrolled' : 'Not enrolled' }}</span><ion-button v-if="student.enrolled && !student.can_retake" fill="outline" class="approve-button" @click="openRetake(student)">Authorize retake</ion-button></div></article></div>
        </section>

        <section v-if="activeSection === 'parents'" class="queue-card" aria-labelledby="family-connections-heading">
          <header class="queue-heading"><div><p class="eyebrow">Parent access</p><h2 id="family-connections-heading">Student family connections</h2></div><ion-button @click="inviteParentOpen = true">Invite a parent</ion-button></header>
          <div class="status-tabs" role="group" aria-label="Parent connection status"><button type="button" :aria-pressed="familyView === 'linked'" :class="{ selected: familyView === 'linked' }" @click="familyView = 'linked'">Linked parents <span>{{ linkedStudentCount }}</span></button><button type="button" :aria-pressed="familyView === 'unlinked'" :class="{ selected: familyView === 'unlinked' }" @click="familyView = 'unlinked'">No linked parent <span>{{ parentStatusesLoaded ? faceStudents.length - linkedStudentCount : '—' }}</span></button></div>
          <div class="queue-search"><label class="student-search"><span class="sr-only">Find a student for parent links</span><input v-model="familySearch" type="search" placeholder="Search student name or email" /></label></div>
          <p class="family-help">Only parent-approved connections count as linked. Pending and declined requests appear under no linked parent.</p>
          <div v-if="loadingFaces || loadingParentStatuses" class="loading-state" role="status"><ion-spinner /><p>Loading parent connections…</p></div>
          <div v-else-if="parentStatusesError" class="queue-empty" role="alert"><h3>Parent connections could not be loaded</h3><p>{{ parentStatusesError }}</p></div>
          <div v-else-if="!familyStudents.length" class="queue-empty"><h3>{{ familySearch ? 'No matching students' : familyView === 'linked' ? 'No students have an approved parent yet' : 'Every student has an approved parent' }}</h3></div>
          <div v-else class="applicant-list"><article v-for="student in familyStudents" :key="student.student_id" class="applicant-row verification-row"><div class="applicant-summary"><span class="applicant-avatar">{{ initials(student.full_name) }}</span><div class="applicant-copy"><h3>{{ student.full_name }}</h3><p>{{ student.email }}</p><small>{{ parentStatusByStudent.get(student.student_id)?.has_approved_parent ? 'Parent-approved connection' : 'Parent approval needed' }}</small></div></div><ion-button fill="outline" @click="guardianStudent = { id: student.student_id, full_name: student.full_name }">View parent connections</ion-button></article></div>
        </section>

        <section v-if="activeSection === 'teachers'" class="queue-card" aria-labelledby="queue-heading">
          <header class="queue-heading">
            <div>
              <p class="eyebrow">Registration queue</p>
              <h2 id="queue-heading">{{ selectedView === 'pending' ? 'Needs review' : selectedView === 'approved' ? 'Approved teachers' : 'Rejected registrations' }}</h2>
            </div>
            <ion-segment v-model="selectedView" class="queue-filter" aria-label="Filter teacher registrations">
              <ion-segment-button value="pending">
                <ion-label>Pending {{ pendingCount }}</ion-label>
              </ion-segment-button>
              <ion-segment-button value="approved">
                <ion-label>Approved {{ approvedCount }}</ion-label>
              </ion-segment-button>
              <ion-segment-button value="rejected">
                <ion-label>Rejected {{ rejectedCount }}</ion-label>
              </ion-segment-button>
            </ion-segment>
          </header>
          <div class="queue-search"><label class="student-search"><span class="sr-only">Find a teacher</span><input v-model="teacherSearch" type="search" placeholder="Search teacher name or email" /></label></div>

          <div v-if="loading" class="loading-state" role="status" aria-label="Loading teacher registrations">
            <ion-spinner name="crescent" />
            <p>Loading teacher registrations…</p>
          </div>

          <div v-else-if="visibleApplicants.length === 0" class="queue-empty">
            <span class="empty-icon" aria-hidden="true">
              <ion-icon :icon="selectedView === 'pending' ? shieldCheckmarkOutline : peopleOutline" />
            </span>
            <h3>{{ teacherSearch ? 'No matching teachers' : selectedView === 'pending' ? 'The approval queue is clear' : `No ${selectedView} registrations` }}</h3>
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
                <p v-if="applicant.teacher_approval_note" class="existing-review-note">
                  {{ applicant.teacher_approval_note }}
                </p>
                <ion-button class="approve-button" fill="outline" @click="openReviewModal(applicant)">
                  {{ applicant.teacher_approval_status === 'pending' || !applicant.teacher_approval_status ? 'Review registration' : 'Change decision' }}
                </ion-button>
              </div>
            </article>
          </div>
        </section>
      </main>
    </ion-content>

    <app-modal :open="Boolean(selectedApplicant)" title="Teacher registration" :busy="Boolean(reviewingTeacherId)" @close="closeReviewModal">
      <template v-if="selectedApplicant">
        <section class="review-modal-summary">
          <span class="applicant-avatar" aria-hidden="true">{{ initials(selectedApplicant.full_name) }}</span>
          <div>
            <p class="eyebrow">Teacher account</p>
            <h2>{{ selectedApplicant.full_name }}</h2>
            <p><ion-icon :icon="mailOutline" /> {{ selectedApplicant.email }}</p>
            <span class="status-pill" :class="`is-${selectedApplicant.teacher_approval_status ?? 'pending'}`">
              <span aria-hidden="true"></span>
              {{ statusLabel(selectedApplicant.teacher_approval_status) }}
            </span>
          </div>
        </section>

        <ion-textarea
          v-model="reviewNotes[selectedApplicant.id]"
          class="review-note"
          label="Decision note (optional)"
          label-placement="stacked"
          fill="outline"
          auto-grow
          :disabled="reviewingTeacherId === selectedApplicant.id"
          placeholder="Add a short note the teacher can see"
        />

        <p v-if="messageKind === 'error' && message" class="page-message is-error" role="alert">{{ message }}</p>

        <div
          class="review-buttons"
          role="group"
          :aria-label="`Review ${selectedApplicant.full_name}'s registration`"
        >
          <ion-button
            class="reject-button"
            fill="outline"
            :disabled="reviewingTeacherId === selectedApplicant.id"
            @click="reviewApplicant(selectedApplicant, 'rejected')"
          >
            <ion-spinner v-if="reviewDecision === 'rejected'" name="crescent" />
            <template v-else>
              <ion-icon slot="start" :icon="closeCircleOutline" />
              Reject
            </template>
          </ion-button>
          <ion-button
            class="approve-button"
            :disabled="reviewingTeacherId === selectedApplicant.id"
            @click="reviewApplicant(selectedApplicant, 'approved')"
          >
            <ion-spinner v-if="reviewDecision === 'approved'" name="crescent" />
            <template v-else>
              <ion-icon slot="start" :icon="checkmarkCircleOutline" />
              Approve
            </template>
          </ion-button>
        </div>
      </template>
    </app-modal>
    <student-guardian-modal :student="guardianStudent" @close="guardianStudent = null" @invite="guardianStudent = null; inviteParentOpen = true" />
    <invite-parent-modal :open="inviteParentOpen" @close="inviteParentOpen = false" />
    <app-modal :open="Boolean(selectedStudent)" title="Authorize one face retake?" :busy="grantingRetake" @close="selectedStudent = null">
      <template v-if="selectedStudent"><p class="retake-description">{{ selectedStudent.full_name }} can replace their face enrollment once. Their existing enrollment remains active until they complete the new one.</p><ion-textarea v-model="retakeNote" label="Reason (optional)" label-placement="stacked" fill="outline" auto-grow :maxlength="500" :disabled="grantingRetake" /><p v-if="retakeError" class="retake-error" role="alert">{{ retakeError }}</p></template>
      <template #actions><ion-button fill="outline" :disabled="grantingRetake" @click="selectedStudent = null">Cancel</ion-button><ion-button :disabled="grantingRetake" @click="grantRetake">{{ grantingRetake ? 'Authorizing…' : 'Authorize retake' }}</ion-button></template>
    </app-modal>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonContent,
  IonIcon,
  IonLabel,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTextarea,
  onIonViewWillEnter,
} from '@ionic/vue'
import {
  alertCircleOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  hourglassOutline,
  logOutOutline,
  mailOutline,
  peopleOutline,
  schoolOutline,
  shieldCheckmarkOutline,
  timeOutline,
} from 'ionicons/icons'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useSession } from '@/composables/useSession'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'
import { supabase } from '@/lib/supabase'
import type { TeacherApprovalStatus } from '@/types/database'
import PortalHeader from '@/components/PortalHeader.vue'
import AppModal from '@/components/AppModal.vue'
import StudentGuardianModal from '@/components/StudentGuardianModal.vue'
import InviteParentModal from '@/components/InviteParentModal.vue'
import { toUserFacingErrorMessage } from '@/utils/errors'

interface TeacherApplicant {
  id: string
  full_name: string
  email: string
  teacher_approval_status: TeacherApprovalStatus | null
  teacher_approval_note: string | null
  teacher_approved_at: string | null
  created_at: string
}
interface FaceEnrollment { student_id: string; full_name: string; email: string; enrolled: boolean; can_retake: boolean; granted_at: string | null; enrolled_at: string | null }
interface ParentStatus { student_id: string; has_approved_parent: boolean; approved_parent_count: number }

type QueueView = 'pending' | 'approved' | 'rejected'

const router = useRouter()
const route = useRoute()
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
const selectedApplicant = ref<TeacherApplicant | null>(null)
const activeSection = computed(() => route.query.section === 'teachers' ? 'teachers' : route.query.section === 'verification' ? 'verification' : route.query.section === 'parents' ? 'parents' : 'overview')
const faceStudents = ref<FaceEnrollment[]>([])
const selectedStudent = ref<FaceEnrollment | null>(null)
const studentSearch = ref(''), retakeNote = ref(''), retakeError = ref('')
const loadingFaces = ref(false), grantingRetake = ref(false)
const faceView = ref<'enrolled' | 'not_enrolled'>('enrolled')
const teacherSearch = ref(''), familySearch = ref(''), inviteParentOpen = ref(false)
const familyView = ref<'linked' | 'unlinked'>('linked')
const parentStatuses = ref<ParentStatus[]>([]), loadingParentStatuses = ref(false), parentStatusesLoaded = ref(false), parentStatusesError = ref('')
const parentStatusByStudent = computed(() => new Map(parentStatuses.value.map(status => [status.student_id, status])))
const linkedStudentCount = computed(() => faceStudents.value.filter(student => parentStatusByStudent.value.get(student.student_id)?.has_approved_parent).length)
const guardianStudent = ref<{ id: string; full_name: string } | null>(null)
const enrolledCount = computed(() => faceStudents.value.filter(student => student.enrolled).length)
const visibleStudents = computed(() => faceStudents.value.filter(student => student.enrolled === (faceView.value === 'enrolled') && `${student.full_name} ${student.email}`.toLowerCase().includes(studentSearch.value.trim().toLowerCase())))
const familyStudents = computed(() => parentStatusesLoaded.value ? faceStudents.value.filter(student => Boolean(parentStatusByStudent.value.get(student.student_id)?.has_approved_parent) === (familyView.value === 'linked') && `${student.full_name} ${student.email}`.toLowerCase().includes(familySearch.value.trim().toLowerCase())) : [])

const pendingCount = computed(() => applicants.value.filter((applicant) => !applicant.teacher_approval_status || applicant.teacher_approval_status === 'pending').length)
const approvedCount = computed(() => applicants.value.filter((applicant) => applicant.teacher_approval_status === 'approved').length)
const rejectedCount = computed(() => applicants.value.filter((applicant) => applicant.teacher_approval_status === 'rejected').length)
const visibleApplicants = computed(() => applicants.value.filter(applicant => (applicant.teacher_approval_status || 'pending') === selectedView.value && `${applicant.full_name} ${applicant.email}`.toLowerCase().includes(teacherSearch.value.trim().toLowerCase())))
let feedbackTimeout: ReturnType<typeof setTimeout> | undefined
watch(message, value => { clearTimeout(feedbackTimeout); if (value) feedbackTimeout = setTimeout(clearMessage, 5000) })
watch(activeSection, () => { clearMessage(); selectedApplicant.value = null; selectedStudent.value = null; guardianStudent.value = null })
watch(() => profile.value?.id, () => { clearMessage(); applicants.value = []; faceStudents.value = []; parentStatuses.value = []; parentStatusesLoaded.value = false; selectedApplicant.value = null; selectedStudent.value = null; guardianStudent.value = null; inviteParentOpen.value = false })
onBeforeUnmount(() => { clearTimeout(feedbackTimeout) })

async function loadApplicants(background = false) {
  if (!background) { loading.value = true; clearMessage() }

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
      if (selectedApplicant.value?.id !== applicant.id) reviewNotes[applicant.id] = applicant.teacher_approval_note ?? ''
    }
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function loadFaceStudents() {
  loadingFaces.value = faceStudents.value.length === 0
  try {
    const { data, error } = await supabase.rpc('admin_student_face_enrollments')
    if (error) throw error
    faceStudents.value = (data ?? []) as FaceEnrollment[]
  } catch (error) { showError(error) }
  finally { loadingFaces.value = false }
}
let parentStatusRequest = 0
async function loadParentStatuses() {
  const actor = profile.value?.id, request = ++parentStatusRequest
  if (!actor || profile.value?.role !== 'admin') return
  loadingParentStatuses.value = !parentStatusesLoaded.value
  try {
    const { data, error } = await supabase.rpc('admin_student_parent_statuses')
    if (request !== parentStatusRequest || profile.value?.id !== actor || profile.value?.role !== 'admin') return
    if (error) throw error
    parentStatuses.value = Array.isArray(data) ? data : []
    parentStatusesLoaded.value = true; parentStatusesError.value = ''
  } catch (error) {
    if (request === parentStatusRequest && profile.value?.id === actor) { parentStatuses.value = []; parentStatusesLoaded.value = false; parentStatusesError.value = toUserFacingErrorMessage(error, 'Unable to load parent connections.') }
  } finally { if (request === parentStatusRequest) loadingParentStatuses.value = false }
}
function openRetake(student: FaceEnrollment) { selectedStudent.value = student; retakeNote.value = ''; retakeError.value = '' }
async function grantRetake() {
  if (!selectedStudent.value || grantingRetake.value) return
  grantingRetake.value = true; retakeError.value = ''
  try {
    const { error } = await supabase.rpc('admin_grant_face_retake', { p_student_id: selectedStudent.value.student_id, p_note: retakeNote.value.trim() || null })
    if (error) throw error
    const name = selectedStudent.value.full_name
    await loadFaceStudents(); selectedStudent.value = null; showSuccess(`A one-time face retake is now authorized for ${name}.`)
  } catch (error) { retakeError.value = toUserFacingErrorMessage(error, 'Unable to authorize a face retake.') }
  finally { grantingRetake.value = false }
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
    selectedApplicant.value = null
  } catch (error) {
    showError(error)
  } finally {
    reviewingTeacherId.value = ''
    reviewDecision.value = null
  }
}

function openReviewModal(applicant: TeacherApplicant) {
  reviewNotes[applicant.id] = applicant.teacher_approval_note ?? ''
  selectedApplicant.value = applicant
}

function closeReviewModal() {
  if (reviewingTeacherId.value) return
  selectedApplicant.value = null
  reviewDecision.value = null
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

function formatDateTime(value: string | null) {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Not recorded'
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function showError(error: unknown) {
  messageKind.value = 'error'
  message.value = toUserFacingErrorMessage(error, 'Unable to review teacher registrations.')
}

function showSuccess(text: string) {
  messageKind.value = 'success'
  message.value = text
}

function clearMessage() {
  clearTimeout(feedbackTimeout)
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
  if (profile.value?.role === 'admin') await Promise.all([loadApplicants(), loadFaceStudents(), loadParentStatuses()])
  else loading.value = false
})

onIonViewWillEnter(async () => {
  if (loading.value || signingOut.value || reviewingTeacherId.value || selectedApplicant.value || profile.value?.role !== 'admin') return
  await Promise.all([loadApplicants(true), loadFaceStudents(), loadParentStatuses()])
})
useRealtimeRefresh({ channel: 'administration', enabled: () => profile.value?.role === 'admin', onChange: async () => { await Promise.all([loadApplicants(true), loadFaceStudents(), loadParentStatuses()]) } })
</script>

<style scoped>
.family-help { margin:0 22px 20px; color:var(--campus-muted); font-size:12px; line-height:1.6; }
.admin-page {
  --campus-accent-local: var(--campus-accent, #087443);
  --campus-navy-local: var(--campus-navy, #063f2a);
  --campus-bg-local: var(--campus-bg, #f5f5ef);
  --campus-surface-local: var(--campus-surface, #ffffff);
  --campus-accent-soft-local: var(--campus-accent-soft, #e6f0e9);
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
  width: min(100%, 1180px);
  margin: 0 auto;
  padding: 32px 28px 56px;
}
.overview-next { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 24px; }
.overview-next h2 { margin: 0; font-size: 18px; letter-spacing: -.025em; }
.overview-next p:not(.eyebrow) { margin: 8px 0 0; color: var(--campus-muted); font-size: 13px; line-height: 1.5; }

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
  box-shadow: var(--campus-shadow, 0 15px 45px rgba(6, 63, 42, 0.08));
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
  width: min(100%, 430px);
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
.queue-search { padding:16px 24px; border-bottom:1px solid var(--campus-border); }.queue-search .student-search { display:block; max-width:480px; }.status-tabs { display:flex; flex-wrap:wrap; gap:8px; padding:16px 24px; border-bottom:1px solid var(--campus-border); }.status-tabs button { display:flex; gap:9px; align-items:center; min-height:42px; padding:10px 14px; border:1px solid var(--campus-border); border-radius:10px; color:var(--campus-muted); background:var(--campus-surface); font:inherit; font-size:13px; font-weight:650; cursor:pointer; }.status-tabs button.selected { background:var(--campus-accent-soft); border-color:var(--campus-accent); color:var(--campus-accent); }.status-tabs button span { padding:2px 6px; border-radius:6px; background:var(--campus-surface-soft); font-size:11px; }.verification-row { grid-template-columns:minmax(0,1fr) auto; align-items:center; }.verification-actions { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:12px; }.verification-actions ion-button { flex:0 0 auto; }.verification-actions .status-pill { flex:0 0 auto; }

.existing-review-note {
  display: -webkit-box;
  overflow: hidden;
  margin: 0 0 10px;
  color: var(--campus-muted-local);
  font-size: 12px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.review-modal-summary {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  max-width: 560px;
  margin: 6px auto 22px;
  padding: 18px;
  border: 1px solid var(--campus-border-local);
  border-radius: 16px;
  background: var(--campus-surface-local);
}

.review-modal-summary h2,
.review-modal-summary p {
  margin: 0;
}

.review-modal-summary p:not(.eyebrow) {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 10px;
  color: var(--campus-muted-local);
  font-size: 13px;
}

ion-modal .review-note,
ion-modal .review-buttons {
  max-width: 560px;
  margin-right: auto;
  margin-left: auto;
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
  --background: var(--ion-color-primary);
  --background-hover: var(--ion-color-primary);
  --background-hover-opacity: 0.88;
  --color: var(--ion-color-primary-contrast);
}
.approve-button[fill="outline"] { --background: transparent; --color: var(--campus-green); --border-color: var(--campus-green); }

.reject-button {
  --border-color: var(--campus-danger);
  --color: var(--campus-danger);
}
.review-modal-summary, .review-note, .review-buttons, .page-message { --campus-text-local: var(--campus-text); --campus-muted-local: var(--campus-muted); --campus-border-local: var(--campus-border); --campus-accent-local: var(--campus-accent); --campus-accent-soft-local: var(--campus-accent-soft); --campus-success-local: var(--campus-success); --campus-success-soft-local: var(--campus-success-soft); --campus-danger-local: var(--campus-danger); --campus-danger-soft-local: var(--campus-danger-soft); --campus-warning-local: var(--campus-warning); --campus-warning-soft-local: var(--campus-warning-soft); }
.verification-overview { margin-top: 18px; }
.student-search { min-width: min(100%, 270px); }
.student-search input { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid var(--campus-border); border-radius: 10px; color: var(--campus-text); background: var(--campus-surface); font: inherit; font-size: 13px; }
.retake-description { margin: 0 0 18px; color: var(--campus-muted); font-size: 14px; line-height: 1.6; }
.retake-error { color: var(--campus-danger); font-size: 13px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

@media (max-width: 820px) {
  .applicant-row {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .verification-row { grid-template-columns:1fr; }.verification-actions { justify-content:flex-start; }
}

@media (max-width: 600px) {
  .overview-next { align-items: start; flex-direction: column; }
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
