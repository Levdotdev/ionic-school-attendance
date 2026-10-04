<template>
  <section class="barcode-reader" aria-labelledby="barcode-reader-title">
    <h3 id="barcode-reader-title">USB / dongle barcode reader</h3>
    <p>
      Select the button, then scan the physical student ID. Keyboard-wedge and paste-mode readers
      are supported, including readers ending with Enter or Tab; the ID value always stays hidden.
    </p>

    <ion-button
      type="button"
      fill="outline"
      :disabled="disabled"
      @click="beginCapture"
    >
      {{ capturing ? 'Reader ready — scan now' : 'Use barcode reader' }}
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

    <ion-note v-if="status" :color="statusColor" role="status">{{ status }}</ion-note>
  </section>
</template>

<script setup lang="ts">
import { IonButton, IonNote } from '@ionic/vue'
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

const statusColor = computed(() => (invalid.value ? 'danger' : 'medium'))

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
  gap: 0.5rem;
}

.barcode-reader h3,
.barcode-reader p {
  margin: 0;
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
</style>
