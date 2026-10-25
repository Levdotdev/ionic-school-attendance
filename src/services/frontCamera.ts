import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import '@/theme/frontCamera.css'

interface FrontCameraPhoto { blob: Blob; capturedAt: string }
let cameraOpen = false

/** Android's external camera ignores CameraDirection. Keep selfie capture in
 * the WebView so the requested front-facing lens is actually selected. */
export async function captureFrontCameraPhoto(): Promise<FrontCameraPhoto> {
  if (cameraOpen) throw new Error('The camera is already open.')
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('The front camera is unavailable on this device.')
  cameraOpen = true
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const overlay = document.createElement('section')
  overlay.className = 'front-camera-dialog'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', 'Front camera')
  const heading = document.createElement('h2')
  heading.textContent = 'Take a photo'
  const help = document.createElement('p')
  help.textContent = 'Look at the front camera and keep your face in view.'
  const video = document.createElement('video')
  video.autoplay = true; video.muted = true; video.playsInline = true
  video.setAttribute('aria-label', 'Front camera preview')
  const actions = document.createElement('div')
  actions.className = 'front-camera-actions'
  const cancel = document.createElement('button')
  cancel.type = 'button'; cancel.textContent = 'Cancel'
  const capture = document.createElement('button')
  capture.type = 'button'; capture.textContent = 'Take photo'; capture.disabled = true
  actions.append(cancel, capture)
  overlay.append(heading, help, video, actions)
  document.body.append(overlay)
  cancel.focus()

  let stream: MediaStream | undefined
  let backListener: PluginListenerHandle | undefined
  let settled = false
  let finish!: (value: FrontCameraPhoto) => void
  let fail!: (error: Error) => void
  const result = new Promise<FrontCameraPhoto>((resolve, reject) => { finish = resolve; fail = reject })
  // Attach a rejection handler immediately while permission is still pending.
  void result.catch(() => undefined)
  const cancelCapture = () => {
    if (!settled) { settled = true; fail(new Error('Camera capture cancelled.')) }
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); cancelCapture() }
    if (event.key === 'Tab') {
      event.preventDefault()
      if (!capture.disabled && document.activeElement === cancel) capture.focus()
      else cancel.focus()
    }
  }
  // Ionic also handles Android's document back event. Consume its priority
  // chain so cancelling this camera does not also navigate the underlying page.
  const onIonicBack = (event: Event) => {
    (event as CustomEvent<{ register(priority: number, handler: () => void): void }>).detail.register(1000, cancelCapture)
  }
  cancel.addEventListener('click', cancelCapture)
  document.addEventListener('keydown', onKey)
  document.addEventListener('ionBackButton', onIonicBack)
  window.addEventListener('pagehide', cancelCapture)
  capture.addEventListener('click', async () => {
    if (settled || capture.disabled) return
    capture.disabled = true
    try {
      if (!video.videoWidth || !video.videoHeight) throw new Error('Wait for the front camera preview, then try again.')
      const ratio = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('The camera photo could not be prepared.')
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const capturedAt = new Date().toISOString()
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .88))
      if (!blob) throw new Error('The camera photo could not be saved. Please try again.')
      if (!settled) { settled = true; finish({ blob, capturedAt }) }
    } catch (error) {
      if (!settled) { settled = true; fail(error instanceof Error ? error : new Error('The camera photo could not be taken.')) }
    }
  })
  try {
    backListener = await App.addListener('backButton', cancelCapture)
    if (settled) return await result
    const acquiring = navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { exact: 'user' }, width: { ideal: 1280 }, height: { ideal: 1280 } } })
    // A cancelled permission prompt may resolve later. Always stop that stream.
    void acquiring.then(value => { if (settled) value.getTracks().forEach(track => track.stop()) }, () => undefined)
    stream = await Promise.race([acquiring, result.then(() => { throw new Error('Camera capture cancelled.') })])
    if (settled) return await result
    const facing = stream.getVideoTracks()[0]?.getSettings().facingMode
    if (facing && facing !== 'user') throw new Error('The front camera is unavailable. A rear-camera photo was not taken.')
    video.srcObject = stream
    await Promise.race([video.play(), result])
    capture.disabled = false
    return await result
  } catch (error) {
    const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new Error('Allow camera access in your device settings, then try again.')
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new Error('The front camera is unavailable on this device.')
    throw error
  } finally {
    settled = true
    stream?.getTracks().forEach(track => track.stop())
    video.srcObject = null
    await Promise.resolve(backListener?.remove()).catch(() => undefined)
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('ionBackButton', onIonicBack)
    window.removeEventListener('pagehide', cancelCapture)
    overlay.remove(); cameraOpen = false
    previousFocus?.focus()
  }
}
