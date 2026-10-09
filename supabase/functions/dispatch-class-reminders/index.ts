import { createClient } from 'npm:@supabase/supabase-js@2.117.2'

interface FirebaseServiceAccount {
  project_id: string
  client_email: string
  private_key: string
  token_uri?: string
}

interface ClaimedDelivery {
  delivery_id: string
  push_token_id: string
  token: string
  provider: 'fcm'
  platform: 'android'
  meeting_id: string
  class_id: string
  user_id: string
  audience: 'teacher' | 'student'
  reminder_offset_minutes: number
  starts_at: string
  class_name: string
  class_section: string | null
  class_timezone: string
}

interface FcmErrorPayload {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: Array<Record<string, unknown>>
  }
}

class FcmRequestError extends Error {
  readonly status: number
  readonly payload: FcmErrorPayload

  constructor(status: number, payload: FcmErrorPayload) {
    super(payload.error?.message || `FCM request failed with HTTP ${status}`)
    this.name = 'FcmRequestError'
    this.status = status
    this.payload = payload
  }
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required secret: ${name}`)
  return value
}

function safeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }

  return difference === 0
}

function base64Url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replaceAll(/\s/g, '')
  const decoded = atob(body)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

function firebaseServiceAccount(): FirebaseServiceAccount {
  let parsed: Partial<FirebaseServiceAccount>
  try {
    parsed = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT_JSON'))
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON')
  }

  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('The Firebase service account is missing project_id, client_email, or private_key')
  }

  return parsed as FirebaseServiceAccount
}

async function firebaseAccessToken(account: FirebaseServiceAccount): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value
  }

  const issuedAt = Math.floor(Date.now() / 1000)
  const tokenUri = account.token_uri || 'https://oauth2.googleapis.com/token'
  const encodedHeader = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const encodedClaims = base64Url(JSON.stringify({
    iss: account.client_email,
    sub: account.client_email,
    aud: tokenUri,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    iat: issuedAt,
    exp: issuedAt + 3600,
  }))
  const unsignedJwt = `${encodedHeader}.${encodedClaims}`
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsignedJwt),
  )
  const assertion = `${unsignedJwt}.${base64Url(new Uint8Array(signature))}`

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const payload = await response.json() as {
    access_token?: string
    expires_in?: number
    error_description?: string
  }

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || 'Firebase OAuth token exchange failed')
  }

  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in || 3600) * 1000,
  }
  return payload.access_token
}

function offsetLabel(minutes: number): string {
  if (minutes === 0) return 'Class starts now'
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60
    return `Class starts in ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  return `Class starts in ${minutes} minutes`
}

function notificationBody(delivery: ClaimedDelivery): string {
  const classLabel = delivery.class_section
    ? `${delivery.class_name} · ${delivery.class_section}`
    : delivery.class_name
  const time = new Intl.DateTimeFormat('en-PH', {
    timeZone: delivery.class_timezone || 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(delivery.starts_at))

  return `${classLabel} at ${time}`
}

async function sendFcm(
  delivery: ClaimedDelivery,
  account: FirebaseServiceAccount,
  accessToken: string,
): Promise<string> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: delivery.token,
          notification: {
            title: offsetLabel(delivery.reminder_offset_minutes),
            body: notificationBody(delivery),
          },
          data: {
            kind: 'class-reminder',
            meetingId: delivery.meeting_id,
            classId: delivery.class_id,
            audience: delivery.audience,
            reminderOffsetMinutes: String(delivery.reminder_offset_minutes),
            route: delivery.audience === 'teacher'
              ? '/teacher?section=schedules'
              : '/student?section=schedule',
          },
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: 'class-reminders',
              color: '#087443',
              default_sound: true,
            },
          },
        },
      }),
    },
  )
  const payload = await response.json() as FcmErrorPayload & { name?: string }

  if (!response.ok || !payload.name) {
    throw new FcmRequestError(response.status, payload)
  }

  return payload.name
}

function isUnregisteredToken(error: unknown): boolean {
  if (!(error instanceof FcmRequestError)) return false
  return JSON.stringify(error.payload).includes('UNREGISTERED')
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const expectedSecret = requiredEnv('REMINDER_DISPATCH_SECRET')
    const receivedSecret = request.headers.get('x-reminder-secret') || ''
    if (!safeEqual(receivedSecret, expectedSecret)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = createClient(
      requiredEnv('SUPABASE_URL'),
      requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    )
    const workerId = crypto.randomUUID()
    const { data, error: claimError } = await supabaseAdmin.rpc(
      'claim_due_class_notification_deliveries',
      { p_worker_id: workerId, p_limit: 50 },
    )

    if (claimError) throw claimError

    const deliveries = (data || []) as ClaimedDelivery[]
    if (deliveries.length === 0) {
      return Response.json({ claimed: 0, sent: 0, failed: 0 })
    }

    const account = firebaseServiceAccount()
    const accessToken = await firebaseAccessToken(account)
    let sent = 0
    let failed = 0

    // A bounded batch keeps FCM pressure predictable. Cron can pick up the
    // next batch one minute later if more than 50 deliveries are due.
    for (const delivery of deliveries) {
      try {
        const messageName = await sendFcm(delivery, account, accessToken)
        const { error: markError } = await supabaseAdmin.rpc(
          'mark_class_notification_delivery',
          {
            p_delivery_id: delivery.delivery_id,
            p_worker_id: workerId,
            p_succeeded: true,
            p_provider_message_id: messageName,
            p_error: null,
            p_disable_token: false,
          },
        )
        if (markError) throw markError
        sent += 1
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : String(sendError)
        const { error: markError } = await supabaseAdmin.rpc(
          'mark_class_notification_delivery',
          {
            p_delivery_id: delivery.delivery_id,
            p_worker_id: workerId,
            p_succeeded: false,
            p_provider_message_id: null,
            p_error: message,
            p_disable_token: isUnregisteredToken(sendError),
          },
        )
        if (markError) console.error('Could not mark failed delivery', markError)
        failed += 1
      }
    }

    return Response.json({ claimed: deliveries.length, sent, failed })
  } catch (error) {
    console.error('Class reminder dispatch failed', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Reminder dispatch failed' },
      { status: 500 },
    )
  }
})
