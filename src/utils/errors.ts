const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Please try again.'

const GEOLOCATION_ERROR_MESSAGES: Record<number, string> = {
  1: 'Location permission was denied. Allow location access in your browser or device settings, then try again.',
  2: 'Your location is currently unavailable. Turn on location services, move somewhere with a clearer signal, and try again.',
  3: 'Getting your location took too long. Move somewhere with a clearer signal and try again.',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readableString(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized || normalized === '[object Object]') return null

  return normalized
}

/** Converts browser, Capacitor, and Supabase errors into safe text for the UI. */
export function toUserFacingErrorMessage(
  error: unknown,
  fallback = DEFAULT_ERROR_MESSAGE,
): string {
  const directMessage = readableString(error)
  if (directMessage) return directMessage

  if (!isRecord(error)) return fallback

  const geolocationMessage =
    typeof error.code === 'number' ? GEOLOCATION_ERROR_MESSAGES[error.code] : undefined
  if (geolocationMessage) return geolocationMessage

  const message = readableString(error.message)
  if (message) return message

  const description = readableString(error.error_description)
  if (description) return description

  if (isRecord(error.error)) {
    const nestedMessage = readableString(error.error.message)
    if (nestedMessage) return nestedMessage
  }

  const details = readableString(error.details)
  if (details) return details

  return fallback
}
