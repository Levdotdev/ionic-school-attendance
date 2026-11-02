<template>
  <app-modal :open="open" title="Retake school ID barcode" :busy="scanning || saving" @close="close">
    <div class="barcode-retake">
      <p class="eyebrow">Student identity</p>
      <p v-if="loading" class="retake-status" role="status"><ion-spinner name="crescent" /> Checking retake approval…</p>
      <template v-else-if="ready && allowed">
        <p class="retake-intro">An administrator approved one replacement. Your current school ID stays active until you save the new scan.</p>
        <div class="scan-state" :class="{ captured: Boolean(capturedBarcode) }" role="status">
          <ion-icon :icon="capturedBarcode ? checkmarkCircleOutline : barcodeOutline" />
          <span>{{ capturedBarcode ? 'New school ID captured' : 'Scan the long barcode on your physical school ID.' }}</span>
        </div>
        <ion-button type="button" expand="block" fill="outline" :disabled="scanning || saving" @click="scan">
          <ion-spinner v-if="scanning" name="crescent" />
          <template v-else><ion-icon slot="start" :icon="scanOutline" />{{ capturedBarcode ? 'Scan again' : 'Scan barcode with camera' }}</template>
        </ion-button>
        <p class="retake-help">Manual typing is disabled. The captured value stays hidden here; authorized administrators and your class teachers can view the saved ID.</p>
      </template>
      <p v-else-if="ready" class="retake-intro">{{ registered ? 'Your school ID is locked. Ask an administrator to approve a retake before replacing it.' : 'Complete your initial student registration before retaking your school ID.' }}</p>
      <p v-if="message" class="retake-error" role="alert">{{ message }}</p>
    </div>
    <template #actions>
      <ion-button type="button" fill="outline" :disabled="scanning || saving" @click="close">Cancel</ion-button>
      <ion-button v-if="ready && allowed" type="button" :disabled="!capturedBarcode || scanning || saving" @click="save">{{ saving ? 'Saving…' : 'Save new school ID' }}</ion-button>
    </template>
  </app-modal>
</template>

<script setup lang="ts">
import { IonButton, IonIcon, IonSpinner } from '@ionic/vue'
import { barcodeOutline, checkmarkCircleOutline, scanOutline } from 'ionicons/icons'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppModal from '@/components/AppModal.vue'
import { useSession } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'
import { scanStudentBarcode } from '@/services/barcode'
import { toUserFacingErrorMessage } from '@/utils/errors'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const { user, profile } = useSession()
const loading = ref(false), scanning = ref(false), saving = ref(false), ready = ref(false)
const registered = ref(false), granted = ref(false), capturedBarcode = ref<string | null>(null), message = ref('')
const allowed = computed(() => registered.value && granted.value)
let generation = 0, ownerId: string | null = null, disposed = false

function current(request: number, actor: string): boolean {
  return !disposed && props.open && generation === request && ownerId === actor && user.value?.id === actor && profile.value?.role === 'student'
}
function clear() {
  capturedBarcode.value = null; message.value = ''; ready.value = false; registered.value = false; granted.value = false
  loading.value = false; scanning.value = false; saving.value = false
}

watch([() => props.open, () => user.value?.id, () => profile.value?.role], async ([open, actor, role]) => {
  const previousOwner = ownerId, request = ++generation
  clear()
  ownerId = null
  if (!open) return
  if (previousOwner && (actor !== previousOwner || role !== 'student')) { emit('close'); return }
  if (!actor || role !== 'student') { message.value = 'Sign in to your student account before retaking your ID.'; return }
  ownerId = actor
  loading.value = true
  try {
    const { data, error } = await supabase.rpc('my_barcode_registration_access')
    if (!current(request, actor)) return
    if (error) throw error
    const access = Array.isArray(data) ? data[0] : data
    if (!access || typeof access.is_registered !== 'boolean' || typeof access.can_retake !== 'boolean') throw new Error('Your school ID retake approval could not be checked. Close this dialog and try again.')
    registered.value = access.is_registered; granted.value = access.can_retake; ready.value = true
  } catch (error) {
    if (current(request, actor)) message.value = toUserFacingErrorMessage(error, 'Unable to check school ID retake approval.')
  } finally { if (current(request, actor)) loading.value = false }
}, { immediate: true, flush: 'sync' })

async function scan() {
  if (!ready.value || !allowed.value || scanning.value || saving.value || !ownerId) return
  const actor = ownerId, request = generation
  if (!current(request, actor)) return
  scanning.value = true; capturedBarcode.value = null; message.value = ''
  try {
    const barcode = await scanStudentBarcode()
    if (current(request, actor)) capturedBarcode.value = barcode
  } catch (error) {
    if (current(request, actor)) message.value = toUserFacingErrorMessage(error, 'The school ID scan could not be completed.')
  } finally { if (current(request, actor)) scanning.value = false }
}

async function save() {
  if (!ready.value || !allowed.value || !capturedBarcode.value || scanning.value || saving.value || !ownerId) return
  const actor = ownerId, request = generation
  if (!current(request, actor)) return
  saving.value = true; message.value = ''
  try {
    const authentication = await supabase.auth.getUser()
    if (!current(request, actor)) return
    if (authentication.error) throw authentication.error
    if (authentication.data.user?.id !== actor) {
      capturedBarcode.value = null; granted.value = false
      throw new Error('Your account changed. Close this dialog and sign in to your original student account.')
    }
    const { error } = await supabase.rpc('replace_student_barcode', { p_raw_barcode: capturedBarcode.value, p_expected_student_id: actor })
    if (!current(request, actor)) return
    if (error) throw error
    capturedBarcode.value = null; granted.value = false
    emit('saved'); emit('close')
  } catch (error) {
    if (current(request, actor)) {
      const fallback = 'Unable to confirm the new school ID. Close this dialog and check your ID access before trying again.'
      const readable = toUserFacingErrorMessage(error, fallback)
      // Never turn a provider/database error that echoes the credential into
      // a visible student ID field.
      message.value = capturedBarcode.value && readable.includes(capturedBarcode.value.trim()) ? fallback : readable
      if (error && typeof error === 'object' && 'code' in error && error.code === '42501') { capturedBarcode.value = null; granted.value = false }
    }
  } finally { if (current(request, actor)) saving.value = false }
}

function close() {
  if (scanning.value || saving.value) return
  generation++; clear(); ownerId = null; emit('close')
}
onBeforeUnmount(() => { disposed = true; generation++; clear(); ownerId = null })
</script>

<style scoped>
.barcode-retake{display:grid;gap:16px}.eyebrow{margin:0;color:var(--campus-muted);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.retake-intro,.retake-help{margin:0;color:var(--campus-muted);font-size:14px;line-height:1.65}.retake-help{font-size:12px}.retake-status,.scan-state{display:flex;align-items:center;gap:10px;margin:0;color:var(--campus-muted);font-size:14px;line-height:1.5}.scan-state{padding:16px;border:1px solid var(--campus-border);border-radius:12px;background:var(--campus-surface-soft)}.scan-state.captured{color:var(--campus-green);background:var(--campus-green-soft)}.scan-state ion-icon{flex:0 0 auto;font-size:23px}.retake-error{margin:0;color:var(--campus-danger);font-size:13px;line-height:1.6}.barcode-retake ion-button{margin:0}
</style>
