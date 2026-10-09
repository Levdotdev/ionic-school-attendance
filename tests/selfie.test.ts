import { describe, expect, it } from 'vitest'

import { attendanceWatermarkLines } from '@/services/selfie'

describe('attendance photo watermark', () => {
  const capturedAt = '2026-10-08T12:30:45.000Z'

  it('uses a timestamp-only watermark for an online class', () => {
    const lines = attendanceWatermarkLines(capturedAt, { location: null })

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Captured:')
    expect(lines[0]).toContain('Oct')
  })

  it('adds fixed-precision verified coordinates and accuracy on site', () => {
    const lines = attendanceWatermarkLines(capturedAt, {
      location: {
        latitude: 13.387419,
        longitude: 121.162494,
        accuracyM: 8.6,
      },
    })

    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('Location: 13.387419, 121.162494 (±9 m)')
  })
})
