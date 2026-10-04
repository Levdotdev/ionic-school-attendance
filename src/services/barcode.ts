import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from '@capacitor/barcode-scanner'

const MIN_BARCODE_LENGTH = 4
const MAX_BARCODE_LENGTH = 64
const VALID_BARCODE = /^[A-Za-z0-9._/-]+$/

export class BarcodeCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BarcodeCaptureError'
  }
}

export function isLikelyHardwareScan(
  characterCount: number,
  durationMs: number,
  maxAverageIntervalMs = 80,
): boolean {
  if (characterCount < 2 || durationMs < 0 || maxAverageIntervalMs <= 0) return false
  return durationMs / (characterCount - 1) <= maxAverageIntervalMs
}

/** Keep barcode values normalized and reject control/whitespace characters. */
export function validateStudentBarcode(rawValue: string): string {
  const value = rawValue.trim()

  if (value.length < MIN_BARCODE_LENGTH || value.length > MAX_BARCODE_LENGTH) {
    throw new BarcodeCaptureError(
      `The scanned ID must be between ${MIN_BARCODE_LENGTH} and ${MAX_BARCODE_LENGTH} characters.`,
    )
  }

  if (!VALID_BARCODE.test(value)) {
    throw new BarcodeCaptureError('The scanned ID contains unsupported characters. Please scan it again.')
  }

  return value
}

/** Scan a student ID with the official Capacitor v8 barcode scanner plugin. */
export async function scanStudentBarcode(): Promise<string> {
  const result = await CapacitorBarcodeScanner.scanBarcode({
    hint: CapacitorBarcodeScannerTypeHint.ALL,
    cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
    scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
    scanInstructions: 'Center the barcode on the student ID inside the frame.',
    scanButton: false,
    cancelButtonAccessibilityLabel: 'Cancel barcode scan',
    torchButtonOnAccessibilityLabel: 'Turn torch on',
    torchButtonOffAccessibilityLabel: 'Turn torch off',
    android: {
      scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.ZXING,
    },
    web: {
      showCameraSelection: true,
      scannerFPS: 12,
    },
  })

  if (!result.ScanResult) {
    throw new BarcodeCaptureError('No barcode was captured.')
  }

  return validateStudentBarcode(result.ScanResult)
}
