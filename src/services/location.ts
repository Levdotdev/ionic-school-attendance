import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'

export interface AttendanceLocation {
  latitude: number
  longitude: number
  accuracyM: number
  capturedAt: string
}

export async function captureAttendanceLocation(): Promise<AttendanceLocation> {
  if (Capacitor.isNativePlatform()) {
    const current = await Geolocation.checkPermissions()

    if (current.location !== 'granted') {
      const requested = await Geolocation.requestPermissions({ permissions: ['location'] })
      if (requested.location !== 'granted') {
        throw new Error('Precise location permission is required for this attendance check.')
      }
    }
  }

  const position = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 20_000,
    maximumAge: 0,
    enableLocationFallback: true,
  })

  const { latitude, longitude, accuracy } = position.coords
  if (![latitude, longitude, accuracy].every(Number.isFinite)) {
    throw new Error('The device returned an invalid location. Please try again outdoors.')
  }

  return {
    latitude,
    longitude,
    accuracyM: accuracy,
    capturedAt: new Date(position.timestamp).toISOString(),
  }
}
