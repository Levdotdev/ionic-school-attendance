import type { Session, User } from '@supabase/supabase-js'
import { computed, readonly, ref, shallowRef } from 'vue'

import { supabase } from '@/lib/supabase'
import { unregisterFromClassNotifications } from '@/services/notifications'
import { cancelStudentTaskReminders } from '@/services/studentTaskReminders'
import type { AppRole, TeacherApprovalStatus } from '@/types/database'

export type { AppRole } from '@/types/database'

export interface AppProfile {
  id: string
  role: AppRole
  full_name: string
  first_name?: string
  last_name?: string
  name_review_required?: boolean
  email: string
  teacher_approval_status: TeacherApprovalStatus | null
  teacher_approval_note: string | null
  teacher_approved_at: string | null
  onboarding_completed_at: string | null
  avatar_path?: string | null
}

const session = shallowRef<Session | null>(null)
const user = shallowRef<User | null>(null)
const profile = shallowRef<AppProfile | null>(null)
const loading = ref(true)
const initialized = ref(false)
const errorMessage = ref('')
const passwordRecovery = ref(false)
const signOutNotice = ref('')
const PASSWORD_RECOVERY_USER_KEY = 'minsu-password-recovery-user'

let initializePromise: Promise<void> | null = null
let listenerInstalled = false
let authEpoch = 0
let authRequest = 0
let profileRequest = 0
let authRefreshTimer: ReturnType<typeof setTimeout> | undefined
let signingOut = false
let signOutPromise: Promise<void> | null = null

async function finishNotificationCleanup(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.allSettled([unregisterFromClassNotifications(), cancelStudentTaskReminders()]).then(results => results.every(result => result.status === 'fulfilled')),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 2000) }),
    ])
  } finally { clearTimeout(timer) }
}

function clearAccountState() {
  authEpoch++; authRequest++; profileRequest++
  clearTimeout(authRefreshTimer)
  session.value = null; user.value = null; profile.value = null
  errorMessage.value = ''
  initializePromise = null
  setPasswordRecovery(false)
}

function setPasswordRecovery(next: boolean, userId?: string) {
  passwordRecovery.value = next
  try {
    if (next && userId) window.sessionStorage.setItem(PASSWORD_RECOVERY_USER_KEY, userId)
    else window.sessionStorage.removeItem(PASSWORD_RECOVERY_USER_KEY)
  } catch {
    // Recovery still works when the browser disables session storage.
  }
}

function restorePasswordRecovery(userId: string) {
  try {
    passwordRecovery.value = window.sessionStorage.getItem(PASSWORD_RECOVERY_USER_KEY) === userId
  } catch {
    // Preserve an in-memory PASSWORD_RECOVERY event when storage is disabled.
  }
}

function isAppRole(value: unknown): value is AppRole {
  return value === 'admin' || value === 'student' || value === 'teacher' || value === 'parent'
}

function isTeacherApprovalStatus(value: unknown): value is TeacherApprovalStatus {
  return value === 'pending' || value === 'approved' || value === 'rejected'
}

export async function readAccountProfile(userId: string) {
  const columns = 'id,role,full_name,email,teacher_approval_status,teacher_approval_note,teacher_approved_at,created_at'
  const named = await supabase.from('profiles').select(`${columns},first_name,last_name,name_review_required,onboarding_completed_at,avatar_path`).eq('id', userId).maybeSingle()
  if (!named.error || !['42703', 'PGRST204'].includes(named.error.code) || !/first_name|last_name/.test(named.error.message)) {
    if (!named.error || !['42703', 'PGRST204'].includes(named.error.code) || !/avatar_path|onboarding_completed_at/.test(named.error.message)) return named
  }
  let result = /first_name|last_name/.test(named.error?.message ?? '')
    ? await supabase.from('profiles').select(`${columns},onboarding_completed_at,avatar_path`).eq('id', userId).maybeSingle()
    : named
  if (result.error && ['42703', 'PGRST204'].includes(result.error.code) && result.error.message.includes('avatar_path')) {
    result = await supabase.from('profiles').select(`${columns},onboarding_completed_at`).eq('id', userId).maybeSingle()
  }
  const missingSetupColumn = result.error
    && ['42703', 'PGRST204'].includes(result.error.code)
    && result.error.message.includes('onboarding_completed_at')
  if (!missingSetupColumn) return result

  // Keep existing accounts usable while the reviewed database migration is
  // awaiting deployment. Only a missing setup column permits this fallback;
  // network, permission, or other schema failures must remain visible.
  const legacy = await supabase.from('profiles').select(columns).eq('id', userId).maybeSingle()
  return {
    ...legacy,
    data: legacy.data ? { ...legacy.data, onboarding_completed_at: legacy.data.created_at ?? 'legacy', avatar_path: null } : null,
  }
}

export async function refreshProfile(): Promise<AppProfile | null> {
  const currentUser = user.value
  const request = ++profileRequest
  const epoch = authEpoch

  if (!currentUser) {
    profile.value = null
    return null
  }

  const { data, error } = await readAccountProfile(currentUser.id)
  if (request !== profileRequest || epoch !== authEpoch || user.value?.id !== currentUser.id) return null

  if (error) {
    errorMessage.value = error.message
    throw error
  }

  if (!data || !isAppRole(data.role)) {
    profile.value = null
    return null
  }

  // A slow previous request must never restore the previous user's profile.
  if (user.value?.id !== currentUser.id) return null

  profile.value = {
    id: data.id,
    role: data.role,
    full_name: data.full_name,
    first_name: 'first_name' in data ? String(data.first_name ?? '') : '',
    last_name: 'last_name' in data ? String(data.last_name ?? '') : '',
    name_review_required: 'name_review_required' in data && data.name_review_required === true,
    email: user.value?.email || data.email || '',
    teacher_approval_status: isTeacherApprovalStatus(data.teacher_approval_status)
      ? data.teacher_approval_status
      : null,
    teacher_approval_note: data.teacher_approval_note ?? null,
    teacher_approved_at: data.teacher_approved_at ?? null,
    onboarding_completed_at: data.onboarding_completed_at ?? null,
    avatar_path: data.avatar_path ?? null,
  }
  errorMessage.value = ''
  return profile.value
}

export async function refreshAuthUser(): Promise<User | null> {
  const previousId = user.value?.id
  if (!previousId || signingOut) return null
  const request = ++authRequest
  const epoch = authEpoch
  const { data, error } = await supabase.auth.getUser()
  if (request !== authRequest || epoch !== authEpoch || user.value?.id !== previousId || signingOut) return null
  if (error) throw error
  if (!data.user) { clearAccountState(); return null }
  if (data.user.id !== previousId) return null
  user.value = data.user
  if (session.value?.user.id === previousId) session.value = { ...session.value, user: data.user }
  if (profile.value?.id === previousId) profile.value = { ...profile.value, email: data.user.email ?? profile.value.email }
  return data.user
}

function scheduleAuthoritativeRefresh() {
  clearTimeout(authRefreshTimer)
  authRefreshTimer = setTimeout(() => {
    if (!signingOut) void refreshAuthUser().then(() => refreshProfile()).catch(() => undefined)
  }, 0)
}

function installAuthListener() {
  if (listenerInstalled) return
  listenerInstalled = true

  supabase.auth.onAuthStateChange((event, nextSession) => {
    if (signingOut && nextSession) return
    if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true, nextSession?.user.id)
    else if (nextSession && user.value?.id !== nextSession.user.id) restorePasswordRecovery(nextSession.user.id)
    if (!nextSession) {
      clearAccountState()
      return
    }

    if (user.value?.id !== nextSession.user.id) {
      authEpoch++; authRequest++; profileRequest++
      profile.value = null
      user.value = nextSession.user
    }
    // Token refresh and cross-tab events can contain an older user snapshot.
    // Keep verified identities/email until a new server getUser response arrives.
    session.value = { ...nextSession, user: user.value ?? nextSession.user }

    // Defer the database request until the auth callback has returned. This
    // avoids making another Supabase request from inside the auth lock.
    scheduleAuthoritativeRefresh()
  })
}

// Subscribe during module initialization, before Supabase finishes processing
// a PKCE callback, so its PASSWORD_RECOVERY event cannot be missed.
installAuthListener()

export function initializeSession(): Promise<void> {
  if (initializePromise) return initializePromise

  initializePromise = (async () => {
    loading.value = true
    errorMessage.value = ''

    try {
      const epoch = authEpoch
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      if (epoch !== authEpoch || signingOut) {
        // SDK INITIAL_SESSION/SIGNED_IN can arrive while getSession waits for
        // its auth lock. Finish loading that current account before callers
        // render their dashboard; never restore the superseded snapshot.
        if (!signingOut && user.value) { await refreshAuthUser(); await refreshProfile() }
        return
      }
      session.value = data.session
      // A cached session supplies tokens, not an authoritative identities list.
      if (user.value?.id !== data.session?.user.id) user.value = data.session?.user ?? null
      if (user.value) restorePasswordRecovery(user.value.id)

      if (user.value) {
        await refreshAuthUser()
        await refreshProfile()
      }

      installAuthListener()
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : 'Unable to restore the session.'
    } finally {
      loading.value = false
      initialized.value = true
    }
  })()

  return initializePromise
}

export function signOut(): Promise<void> {
  if (signOutPromise) return signOutPromise
  signOutPromise = performSignOut().finally(() => { signOutPromise = null })
  return signOutPromise
}

async function performSignOut(): Promise<void> {
  signingOut = true
  authEpoch++; authRequest++; profileRequest++
  signOutNotice.value = ''
  clearTimeout(authRefreshTimer)
  try {
    const notices: string[] = []
    // Remove device mappings while the JWT still exists, but never block
    // leaving an incomplete account on a never-resolving native/network job.
    if (!await finishNotificationCleanup()) notices.push('Some device reminders could not be cleared. Check this device’s notification settings.')
    let error: unknown
    try { error = (await supabase.auth.signOut()).error } catch (failure) { error = failure }
    if (error) {
      let localError: unknown
      try { localError = (await supabase.auth.signOut({ scope: 'local' })).error } catch (failure) { localError = failure }
      if (localError && !(typeof localError === 'object' && 'code' in localError && localError.code === 'session_not_found')) {
        // Current Supabase clears local credentials even when remote
        // revocation fails. Verify that before allowing the router to leave.
        const cached = await supabase.auth.getSession()
        if (cached.error || cached.data.session) throw localError
      }
      if (!(typeof error === 'object' && 'code' in error && error.code === 'session_not_found')) notices.unshift('Signed out on this device. Other devices could not be signed out because the server was unavailable.')
    }
    clearAccountState()
    signOutNotice.value = notices.join(' ')
  } finally { signingOut = false }
}

export function homePathForRole(role: AppRole): string {
  return `/${role}`
}

export function accountPathForProfile(value: Pick<AppProfile, 'role' | 'onboarding_completed_at'>): string {
  return value.onboarding_completed_at ? homePathForRole(value.role) : '/account/setup'
}

export function useSession() {
  return {
    session: readonly(session),
    user: readonly(user),
    profile: readonly(profile),
    loading: readonly(loading),
    initialized: readonly(initialized),
    errorMessage: readonly(errorMessage),
    passwordRecovery: readonly(passwordRecovery),
    signOutNotice: readonly(signOutNotice),
    finishPasswordRecovery: () => { setPasswordRecovery(false) },
    isAuthenticated: computed(() => Boolean(session.value)),
    initializeSession,
    refreshProfile,
    refreshAuthUser,
    signOut,
  }
}
