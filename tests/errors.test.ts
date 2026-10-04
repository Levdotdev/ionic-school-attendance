import { describe, expect, it } from 'vitest'

import { toUserFacingErrorMessage } from '@/utils/errors'

describe('toUserFacingErrorMessage', () => {
  it('uses the message from Supabase and PostgREST error objects', () => {
    expect(
      toUserFacingErrorMessage({
        code: 'P0001',
        details: null,
        hint: null,
        message: 'The attendance window has closed.',
      }),
    ).toBe('The attendance window has closed.')
  })

  it.each([
    [1, 'Location permission was denied. Allow location access in your browser or device settings, then try again.'],
    [2, 'Your location is currently unavailable. Turn on location services, move somewhere with a clearer signal, and try again.'],
    [3, 'Getting your location took too long. Move somewhere with a clearer signal and try again.'],
  ])('maps geolocation error code %i to a helpful message', (code, expected) => {
    expect(toUserFacingErrorMessage({ code, message: 'Browser-specific message' })).toBe(expected)
  })

  it('preserves normal Error and string messages', () => {
    expect(toUserFacingErrorMessage(new Error('Camera permission is required.'))).toBe(
      'Camera permission is required.',
    )
    expect(toUserFacingErrorMessage('Barcode scan was cancelled.')).toBe(
      'Barcode scan was cancelled.',
    )
  })

  it('never displays an unhelpful object conversion', () => {
    expect(toUserFacingErrorMessage({ unknown: true })).toBe(
      'Something went wrong. Please try again.',
    )
    expect(toUserFacingErrorMessage({ message: '[object Object]' })).toBe(
      'Something went wrong. Please try again.',
    )
  })
})
