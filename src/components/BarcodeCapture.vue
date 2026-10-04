<template>
  <section class="barcode-reader" aria-labelledby="barcode-reader-title">
    <h3 id="barcode-reader-title">USB / dongle barcode reader</h3>
    <p>
      Select the button, then scan the physical student ID. Keyboard-wedge and paste-mode readers
      are supported; the ID value always stays hidden.
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
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

import { isLikelyHardwareScan, validateStudentBarcode } from '@/services/barcode'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    maxIntervalMs?: number
  }>(),
  {
    disabled: false,
    maxIntervalMs: 80,
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

async function beginCapture() {
  if (props.disabled) return

  resetBuffer()
  invalid.value = false
  status.value = 'Reader ready. Scan the barcode now.'
  capturing.value = true
  captureTimeout = setTimeout(() => fail('No barcode was received. Select the reader button and try again.'), 12_000)

  await nextTick()
  hiddenInput.value?.focus({ preventScroll: true })
}

function rejectManualInput() {
  if (capturing.value) fail('Dropped text is not accepted. Scan the physical ID barcode.')
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
    fail(error instanceof Error ? error.message : 'The barcode is invalid.')
  }
}

function onBlur() {
  if (!capturing.value) return
  queueMicrotask(() => hiddenInput.value?.focus({ preventScroll: true }))
}

function finishScan() {
  if (!characters) {
    fail('No barcode was received. Please scan the ID again.')
    return
  }

  if (!isLikelyHardwareScan(characters.length, lastCharacterAt - startedAt, props.maxIntervalMs)) {
    fail('Input was too slow to be a barcode scan. Manual typing is not accepted.')
    return
  }

  try {
    const barcode = validateStudentBarcode(characters)
    invalid.value = false
    status.value = 'Student ID barcode captured.'
    emit('scan', barcode)
    stopCapture()
  } catch (error) {
    fail(error instanceof Error ? error.message : 'The barcode is invalid.')
  }
}

function onKeydown(event: KeyboardEvent) {
  if (!capturing.value) return

  // Some dongle readers paste a whole scan. Let the subsequent paste event
  // handle it while the hidden reader is armed.
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return

  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'Enter') {
    finishScan()
    return
  }

  if (event.key === 'Escape') {
    fail('Barcode capture was cancelled.')
    return
  }

  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.key.length !== 1) {
    fail('Manual keyboard input is not accepted. Scan the physical ID barcode.')
    return
  }

  const now = performance.now()

  if (lastCharacterAt && now - lastCharacterAt > props.maxIntervalMs) {
    fail('Input was too slow to be a barcode scan. Manual typing is not accepted.')
    return
  }

  if (!startedAt) startedAt = now
  lastCharacterAt = now
  characters += event.key

  if (characters.length > 64) {
    fail('The scanned barcode is too long.')
  }
}

onBeforeUnmount(clearCaptureTimeout)
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
