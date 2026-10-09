import { describe, expect, it } from 'vitest'

import {
  BarcodeCaptureError,
  getOneDimensionalScanRegion,
  MAX_STUDENT_BARCODE_LENGTH,
  validateStudentBarcode,
} from '@/services/barcode'

describe('student ID barcode validation', () => {
  it('normalizes a scanned value without changing its contents', () => {
    expect(validateStudentBarcode('  2026-00123  ')).toBe('2026-00123')
  })

  it.each(['abc', '123\n456', '123\t456', 'A'.repeat(MAX_STUDENT_BARCODE_LENGTH + 1)])(
    'rejects an invalid scan: %s',
    (value) => {
      expect(() => validateStudentBarcode(value)).toThrow(BarcodeCaptureError)
    },
  )

  it('accepts printable spaces and punctuation used by Code 128 barcodes', () => {
    expect(validateStudentBarcode('BSIT/2026_001.4-A')).toBe('BSIT/2026_001.4-A')
    expect(validateStudentBarcode('STUDENT ID #42 (A); ROOM=3')).toBe('STUDENT ID #42 (A); ROOM=3')
  })

  it('accepts a 256-character payload and trims common scanner suffixes', () => {
    const longestValidBarcode = 'A'.repeat(MAX_STUDENT_BARCODE_LENGTH)

    expect(validateStudentBarcode(longestValidBarcode)).toBe(longestValidBarcode)
    expect(validateStudentBarcode('CODE128-00001234\r\n')).toBe('CODE128-00001234')
  })
})

describe('browser 1D scan region', () => {
  it('uses a wide rectangle bounded by the camera view', () => {
    const region = getOneDimensionalScanRegion(640, 480)

    expect(region.width).toBeLessThan(640)
    expect(region.height).toBeLessThan(480)
    expect(region.width).toBeGreaterThan(region.height * 3)
  })

  it('caps the region on large camera streams', () => {
    expect(getOneDimensionalScanRegion(1920, 1080)).toEqual({ width: 720, height: 201 })
  })
})
