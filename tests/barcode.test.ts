import { describe, expect, it } from 'vitest'

import {
  BarcodeCaptureError,
  isLikelyHardwareScan,
  validateStudentBarcode,
} from '@/services/barcode'

describe('student ID barcode validation', () => {
  it('normalizes a scanned value without changing its contents', () => {
    expect(validateStudentBarcode('  2026-00123  ')).toBe('2026-00123')
  })

  it.each(['abc', 'student id 123', '123\n456', 'A'.repeat(65)])(
    'rejects an invalid scan: %s',
    (value) => {
      expect(() => validateStudentBarcode(value)).toThrow(BarcodeCaptureError)
    },
  )

  it('accepts the characters commonly used by school ID barcodes', () => {
    expect(validateStudentBarcode('BSIT/2026_001.4-A')).toBe('BSIT/2026_001.4-A')
  })
})

describe('keyboard-wedge timing', () => {
  it('accepts a rapid hardware-like scan', () => {
    expect(isLikelyHardwareScan(10, 90, 80)).toBe(true)
  })

  it('rejects slow manual typing and a single key', () => {
    expect(isLikelyHardwareScan(10, 2_000, 80)).toBe(false)
    expect(isLikelyHardwareScan(1, 0, 80)).toBe(false)
  })
})
