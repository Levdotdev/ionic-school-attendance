import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from '@capacitor/barcode-scanner'
import { Capacitor } from '@capacitor/core'

export const MIN_STUDENT_BARCODE_LENGTH = 4
export const MAX_STUDENT_BARCODE_LENGTH = 256
export const DEFAULT_SCANNER_AVERAGE_INTERVAL_MS = 150

const PRINTABLE_ASCII = /^[\x20-\x7e]+$/
const BROWSER_SCANNER_OVERLAY_ID = 'student-barcode-camera-overlay'

const NATIVE_ONE_DIMENSIONAL_FORMATS = new Set<number>([
  CapacitorBarcodeScannerTypeHint.CODABAR,
  CapacitorBarcodeScannerTypeHint.CODE_39,
  CapacitorBarcodeScannerTypeHint.CODE_93,
  CapacitorBarcodeScannerTypeHint.CODE_128,
  CapacitorBarcodeScannerTypeHint.ITF,
  CapacitorBarcodeScannerTypeHint.EAN_13,
  CapacitorBarcodeScannerTypeHint.EAN_8,
  CapacitorBarcodeScannerTypeHint.UPC_A,
  CapacitorBarcodeScannerTypeHint.UPC_E,
  CapacitorBarcodeScannerTypeHint.UPC_EAN_EXTENSION,
])

export class BarcodeCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BarcodeCaptureError'
  }
}

export function isLikelyHardwareScan(
  characterCount: number,
  durationMs: number,
  maxAverageIntervalMs = DEFAULT_SCANNER_AVERAGE_INTERVAL_MS,
): boolean {
  if (characterCount < 2 || durationMs < 0 || maxAverageIntervalMs <= 0) return false
  return durationMs / (characterCount - 1) <= maxAverageIntervalMs
}

/**
 * Use a wide scan region so a long linear barcode can fit without being moved
 * through a square QR-code frame.
 */
export function getOneDimensionalScanRegion(
  viewfinderWidth: number,
  viewfinderHeight: number,
): { width: number; height: number } {
  const availableWidth = Number.isFinite(viewfinderWidth) && viewfinderWidth > 0 ? viewfinderWidth : 1
  const availableHeight = Number.isFinite(viewfinderHeight) && viewfinderHeight > 0 ? viewfinderHeight : 1
  const width = Math.max(1, Math.floor(Math.min(availableWidth * 0.92, 720)))
  const preferredHeight = Math.max(80, width * 0.28)
  const height = Math.max(1, Math.floor(Math.min(availableHeight * 0.48, preferredHeight)))

  return { width, height }
}

/**
 * Trim scanner suffix whitespace, then accept the printable ASCII payloads
 * produced by common Code 128/39/93, Codabar, ITF, EAN and UPC readers.
 */
export function validateStudentBarcode(rawValue: string): string {
  const value = rawValue.trim()

  if (
    value.length < MIN_STUDENT_BARCODE_LENGTH ||
    value.length > MAX_STUDENT_BARCODE_LENGTH
  ) {
    throw new BarcodeCaptureError(
      `The scanned ID must be between ${MIN_STUDENT_BARCODE_LENGTH} and ${MAX_STUDENT_BARCODE_LENGTH} characters.`,
    )
  }

  if (!PRINTABLE_ASCII.test(value)) {
    throw new BarcodeCaptureError(
      'The scanned ID contains a non-printable or unsupported character. Please scan it again.',
    )
  }

  return value
}

function describeCameraError(error: unknown): BarcodeCaptureError {
  if (error instanceof BarcodeCaptureError) return error

  const name = error instanceof DOMException ? error.name : ''
  const message = error instanceof Error ? error.message : String(error ?? '')
  const searchable = `${name} ${message}`.toLowerCase()

  if (searchable.includes('cancel')) {
    return new BarcodeCaptureError('Barcode scanning was cancelled.')
  }

  if (
    name === 'NotAllowedError' ||
    searchable.includes('permission') ||
    searchable.includes('notallowed')
  ) {
    return new BarcodeCaptureError(
      'Camera access was denied. Allow camera access in the browser or device settings, then try again.',
    )
  }

  if (
    name === 'NotFoundError' ||
    searchable.includes('notfound') ||
    searchable.includes('no camera')
  ) {
    return new BarcodeCaptureError('No usable camera was found on this device.')
  }

  if (name === 'NotReadableError' || searchable.includes('could not start video source')) {
    return new BarcodeCaptureError(
      'The camera is already in use or could not be started. Close other camera apps and try again.',
    )
  }

  return new BarcodeCaptureError('The camera barcode scanner could not start. Please try again.')
}

function createBrowserScannerUi(): {
  overlay: HTMLDivElement
  readerId: string
  cancelButton: HTMLButtonElement
} {
  document.getElementById(BROWSER_SCANNER_OVERLAY_ID)?.remove()

  const overlay = document.createElement('div')
  overlay.id = BROWSER_SCANNER_OVERLAY_ID
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', `${BROWSER_SCANNER_OVERLAY_ID}-title`)
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:16px',
    'background:rgba(0,0,0,.78)',
  ].join(';')

  const panel = document.createElement('div')
  panel.style.cssText = [
    'width:min(94vw,820px)',
    'max-height:96vh',
    'overflow:auto',
    'box-sizing:border-box',
    'padding:16px',
    'border-radius:16px',
    'background:#fff',
    'color:#111827',
    'box-shadow:0 24px 64px rgba(0,0,0,.4)',
  ].join(';')

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:16px'

  const copy = document.createElement('div')
  const title = document.createElement('h2')
  title.id = `${BROWSER_SCANNER_OVERLAY_ID}-title`
  title.textContent = 'Scan the student ID barcode'
  title.style.cssText = 'margin:0 0 6px;font:700 20px/1.25 system-ui,sans-serif'

  const instructions = document.createElement('p')
  instructions.textContent =
    'Hold the long barcode horizontally inside the wide frame. Move the card slightly farther away if the whole barcode does not fit.'
  instructions.style.cssText = 'margin:0 0 14px;font:400 14px/1.45 system-ui,sans-serif'

  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.textContent = 'Cancel'
  cancelButton.setAttribute('aria-label', 'Cancel barcode scan')
  cancelButton.style.cssText = [
    'flex:none',
    'min-height:40px',
    'padding:8px 14px',
    'border:1px solid #9ca3af',
    'border-radius:8px',
    'background:#fff',
    'color:#111827',
    'font:600 14px system-ui,sans-serif',
    'cursor:pointer',
  ].join(';')

  const reader = document.createElement('div')
  const readerId = `${BROWSER_SCANNER_OVERLAY_ID}-reader`
  reader.id = readerId
  reader.style.cssText = 'width:100%;min-height:220px;overflow:hidden;border-radius:12px;background:#111'

  copy.append(title, instructions)
  header.append(copy, cancelButton)
  panel.append(header, reader)
  overlay.append(panel)
  document.body.append(overlay)

  return { overlay, readerId, cancelButton }
}

async function scanBrowserStudentBarcode(): Promise<string> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new BarcodeCaptureError(
      'Camera scanning is not available here. Open the deployed HTTPS site in a current browser and try again.',
    )
  }

  if (window.isSecureContext === false) {
    throw new BarcodeCaptureError(
      'Camera scanning requires a secure HTTPS connection. Open the deployed site and try again.',
    )
  }

  const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
  const { overlay, readerId, cancelButton } = createBrowserScannerUi()
  const scanner = new Html5Qrcode(readerId, {
    formatsToSupport: [
      Html5QrcodeSupportedFormats.CODABAR,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODE_93,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
    ],
    useBarCodeDetectorIfSupported: true,
    verbose: false,
  })

  return new Promise<string>((resolve, reject) => {
    let settled = false

    const removeListeners = () => {
      cancelButton.removeEventListener('click', cancel)
      overlay.removeEventListener('click', cancelFromBackdrop)
      document.removeEventListener('keydown', cancelFromEscape)
    }

    const cleanUp = async () => {
      removeListeners()
      if (scanner.isScanning) {
        try {
          await scanner.stop()
        } catch {
          // The stream may already have stopped after a browser-level camera error.
        }
      }
      try {
        scanner.clear()
      } catch {
        // Clearing is best-effort when camera startup did not complete.
      }
      overlay.remove()
    }

    const settle = (result: { value: string } | { error: BarcodeCaptureError }) => {
      if (settled) return
      settled = true
      void cleanUp().finally(() => {
        if ('value' in result) resolve(result.value)
        else reject(result.error)
      })
    }

    function cancel() {
      settle({ error: new BarcodeCaptureError('Barcode scanning was cancelled.') })
    }

    function cancelFromBackdrop(event: MouseEvent) {
      if (event.target === overlay) cancel()
    }

    function cancelFromEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') cancel()
    }

    cancelButton.addEventListener('click', cancel)
    overlay.addEventListener('click', cancelFromBackdrop)
    document.addEventListener('keydown', cancelFromEscape)
    cancelButton.focus({ preventScroll: true })

    void scanner
      .start(
        { facingMode: { ideal: 'environment' } },
        {
          fps: 15,
          qrbox: getOneDimensionalScanRegion,
          aspectRatio: 16 / 9,
          videoConstraints: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        (decodedText) => {
          try {
            settle({ value: validateStudentBarcode(decodedText) })
          } catch (error) {
            settle({ error: describeCameraError(error) })
          }
        },
        () => {
          // No barcode in this frame is expected; keep scanning.
        },
      )
      .then(() => {
        if (settled) void cleanUp()
      })
      .catch((error: unknown) => settle({ error: describeCameraError(error) }))
  })
}

async function scanNativeStudentBarcode(): Promise<string> {
  try {
    const result = await CapacitorBarcodeScanner.scanBarcode({
      // The native API accepts one hint only. ALL lets the official scanner
      // detect each supported 1D type; the returned format is checked below.
      hint: CapacitorBarcodeScannerTypeHint.ALL,
      cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
      scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
      scanInstructions: 'Center the full long barcode inside the frame.',
      scanButton: false,
      cancelButtonAccessibilityLabel: 'Cancel barcode scan',
      torchButtonOnAccessibilityLabel: 'Turn torch on',
      torchButtonOffAccessibilityLabel: 'Turn torch off',
      android: {
        scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.ZXING,
      },
    })

    if (!result.ScanResult) {
      throw new BarcodeCaptureError('No barcode was captured.')
    }

    if (!NATIVE_ONE_DIMENSIONAL_FORMATS.has(result.format)) {
      throw new BarcodeCaptureError(
        'That is not a supported long 1D barcode. Scan the Code 128, Code 39, EAN or UPC barcode on the student ID.',
      )
    }

    return validateStudentBarcode(result.ScanResult)
  } catch (error) {
    throw describeCameraError(error)
  }
}

/** Scan a long 1D student ID barcode with the native or browser camera. */
export async function scanStudentBarcode(): Promise<string> {
  return Capacitor.isNativePlatform()
    ? scanNativeStudentBarcode()
    : scanBrowserStudentBarcode()
}
