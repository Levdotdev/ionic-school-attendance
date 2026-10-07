<template>
  <section class="barcode-reader" :class="{ 'is-capturing': capturing }" aria-labelledby="barcode-reader-title">
    <div class="reader-heading">
      <div class="reader-icon" aria-hidden="true">
        <ion-icon :icon="capturing ? scanOutline : barcodeOutline" />
      </div>
      <div>
        <span class="reader-kicker">Connected scanner</span>
        <h3 id="barcode-reader-title">USB / dongle barcode reader</h3>
      </div>
    </div>

    <p class="reader-description">
      Select the button, then scan the physical student ID. Keyboard-wedge and paste-mode readers
      are supported. The ID number always stays hidden.
    </p>

    <ion-button
      class="reader-button"
      type="button"
      fill="outline"
      :disabled="disabled"
      @click="beginCapture"
    >
      <ion-icon slot="start" :icon="scanOutline" />
      {{ capturing ? 'Reader ready - scan now' : 'Use barcode reader' }}
    </ion-button>

    <input
      ref="hiddenInput"
      class="wedge-input"
      type="text"
      inputmode="none"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      :maxlength="MAX_STUDENT_BARCODE_LENGTH"
      tabindex="-1"
      aria-hidden="true"
      @keydown="onKeydown"
      @paste.prevent="onPaste"
      @drop.prevent="rejectManualInput"
      @blur="onBlur"
    />

    <div v-if="status" class="reader-status" :class="{ 'is-error': invalid }" role="status">
      <ion-icon :icon="invalid ? alertCircleOutline : capturing ? scanOutline : checkmarkCircleOutline" />
      <ion-note :color="statusColor">{{ status }}</ion-note>
    </div>
  </section>
</template>

<script setup lang="ts">
import { IonButton, IonIcon, IonNote } from '@ionic/vue'
import { alertCircleOutline, barcodeOutline, checkmarkCircleOutline, scanOutline } from 'ionicons/icons'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import {
  DEFAULT_SCANNER_AVERAGE_INTERVAL_MS,
  isLikelyHardwareScan,
  MAX_STUDENT_BARCODE_LENGTH,
  validateStudentBarcode,
} from '@/services/barcode'

const CAPTURE_TIMEOUT_MS = 30_000
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock'])

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    maxIntervalMs?: number
  }>(),
  {
    disabled: false,
    maxIntervalMs: DEFAULT_SCANNER_AVERAGE_INTERVAL_MS,
  },
)

const emit = defineEmits<{
  scan: [value: string]
  invalid: [message: string]
}>()

const hiddenInput = ref<HTMLInputElement | null>(null)
const capturing = ref(false)
const status = ref('')
const invalid = ref(false)

let characters = ''
let startedAt = 0
let lastCharacterAt = 0
let captureTimeout: ReturnType<typeof setTimeout> | null = null

const statusColor = computed(() => (invalid.value ? 'danger' : capturing.value ? 'primary' : 'success'))

function clearCaptureTimeout() {
  if (captureTimeout) clearTimeout(captureTimeout)
  captureTimeout = null
}

function resetBuffer() {
  characters = ''
  startedAt = 0
  lastCharacterAt = 0
  if (hiddenInput.value) hiddenInput.value.value = ''
}

function restartCaptureTimeout() {
  clearCaptureTimeout()
  captureTimeout = setTimeout(
    () => fail('No barcode was received. Select the reader button and try again.'),
    CAPTURE_TIMEOUT_MS,
  )
}

function stopCapture() {
  clearCaptureTimeout()
  capturing.value = false
  hiddenInput.value?.blur()
  resetBuffer()
}

function fail(message: string) {
  invalid.value = true
  status.value = message
  emit('invalid', message)
  stopCapture()
}

function rejectScanAndKeepArmed(message: string) {
  invalid.value = true
  status.value = `${message} The reader is still ready; scan again.`
  emit('invalid', message)
  resetBuffer()
  restartCaptureTimeout()
  queueMicrotask(() => hiddenInput.value?.focus({ preventScroll: true }))
}

async function beginCapture() {
  if (props.disabled) return

  clearCaptureTimeout()
  resetBuffer()
  invalid.value = false
  status.value = 'Reader ready. Scan the barcode now.'
  capturing.value = true
  restartCaptureTimeout()

  await nextTick()
  hiddenInput.value?.focus({ preventScroll: true })
}

function rejectManualInput() {
  if (capturing.value) {
    rejectScanAndKeepArmed('Dropped text is not accepted. Scan the physical ID barcode.')
  }
}

function onPaste(event: ClipboardEvent) {
  if (!capturing.value) return

  try {
    const barcode = validateStudentBarcode(event.clipboardData?.getData('text') ?? '')
    invalid.value = false
    status.value = 'Student ID barcode captured.'
    emit('scan', barcode)
    stopCapture()
  } catch (error) {
    rejectScanAndKeepArmed(error instanceof Error ? error.message : 'The barcode is invalid.')
  }
}

function onBlur() {
  if (!capturing.value) return
  queueMicrotask(() => hiddenInput.value?.focus({ preventScroll: true }))
}

function finishScan() {
  if (!characters) {
    rejectScanAndKeepArmed('No barcode was received. Please scan the ID again.')
    return
  }

  if (!isLikelyHardwareScan(characters.length, lastCharacterAt - startedAt, props.maxIntervalMs)) {
    rejectScanAndKeepArmed('Input was too slow to be a barcode scan. Manual typing is not accepted.')
    return
  }

  try {
    const barcode = validateStudentBarcode(characters)
    invalid.value = false
    status.value = 'Student ID barcode captured.'
    emit('scan', barcode)
    stopCapture()
  } catch (error) {
    rejectScanAndKeepArmed(error instanceof Error ? error.message : 'The barcode is invalid.')
  }
}

function onKeydown(event: KeyboardEvent) {
  if (!capturing.value) return

  // Some dongle readers paste a whole scan. Let the subsequent paste event
  // handle it while the hidden reader is armed.
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return

  // Wedge scanners can emit Shift before uppercase letters or punctuation.
  // Ignore modifier-only events and assess the complete scan at its suffix.
  if (MODIFIER_KEYS.has(event.key)) return

  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'Enter' || event.key === 'Tab') {
    finishScan()
    return
  }

  if (event.key === 'Escape') {
    fail('Barcode capture was cancelled.')
    return
  }

  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.key.length !== 1) {
    rejectScanAndKeepArmed('Manual keyboard input is not accepted. Scan the physical ID barcode.')
    return
  }

  const now = performance.now()

  if (!startedAt) startedAt = now
  lastCharacterAt = now
  characters += event.key

  if (characters.length > MAX_STUDENT_BARCODE_LENGTH) {
    rejectScanAndKeepArmed('The scanned barcode is too long.')
  }
}

onBeforeUnmount(clearCaptureTimeout)

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && capturing.value) stopCapture()
  },
)
</script>

<style scoped>
.barcode-reader {
  display: grid;
  gap: 0.9rem;
  padding: 1rem;
  border: 1px solid var(--campus-border, #d9e2e9);
  border-radius: var(--campus-radius-md, 16px);
  background: var(--campus-surface-soft, #f4f8fb);
  transition: border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
}

.barcode-reader.is-capturing {
  border-color: var(--campus-accent, #245f86);
  background: var(--campus-accent-soft, #e8f2f8);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--campus-accent, #245f86) 12%, transparent);
}

.reader-heading {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.reader-icon {
  display: grid;
  flex: 0 0 auto;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  border-radius: 0.85rem;
  background: var(--campus-accent-soft, #e1edf5);
  color: var(--campus-accent, #245f86);
  font-size: 1.25rem;
}

.barcode-reader h3,
.barcode-reader p {
  margin: 0;
}

.barcode-reader h3 {
  margin-top: 0.15rem;
  color: var(--campus-text, #182632);
  font-size: 0.98rem;
  font-weight: 650;
  line-height: 1.25;
}

.reader-kicker {
  color: var(--campus-muted, #62727f);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.reader-description {
  color: var(--campus-muted, #62727f);
  font-size: 0.85rem;
  line-height: 1.55;
}

.reader-button {
  width: fit-content;
  min-height: 42px;
  margin: 0;
  --border-color: var(--campus-border-strong, #b8c8d3);
  --border-radius: 11px;
  --color: var(--campus-accent, #245f86);
}

.reader-status {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  color: var(--ion-color-success, #147a50);
  font-size: 0.84rem;
  line-height: 1.35;
}

.reader-status.is-error {
  color: var(--ion-color-danger, #bb3e45);
}

.reader-status ion-icon {
  flex: 0 0 auto;
  margin-top: 0.05rem;
  font-size: 1rem;
}

.wedge-input {
  position: fixed;
  top: -100px;
  left: -100px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

@media (max-width: 520px) {
  .reader-button {
    width: 100%;
  }
}
</style>
