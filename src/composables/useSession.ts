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
  email: string
  teacher_approval_status: TeacherApprovalStatus | null
  teacher_approval_note: string | null
  teacher_approved_at: string | null
  onboarding_completed_at: string | null
}

const session = shallowRef<Session | null>(null)
const user = shallowRef<User | null>(null)
const profile = shallowRef<AppProfile | null>(null)
const loading = ref(true)
const initialized = ref(false)
const errorMessage = ref('')
const passwordRecovery = ref(false)
const PASSWORD_RECOVERY_USER_KEY = 'minsu-password-recovery-user'

let initializePromise: Promise<void> | null = null
let listenerInstalled = false

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
  const result = await supabase.from('profiles').select(`${columns},onboarding_completed_at`).eq('id', userId).maybeSingle()
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
    data: legacy.data ? { ...legacy.data, onboarding_completed_at: legacy.data.created_at ?? 'legacy' } : null,
  }
}

export async function refreshProfile(): Promise<AppProfile | null> {
  const currentUser = user.value

  if (!currentUser) {
    profile.value = null
    return null
  }

  const { data, error } = await readAccountProfile(currentUser.id)

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
    email: data.email || currentUser.email || '',
    teacher_approval_status: isTeacherApprovalStatus(data.teacher_approval_status)
      ? data.teacher_approval_status
      : null,
    teacher_approval_note: data.teacher_approval_note ?? null,
    teacher_approved_at: data.teacher_approved_at ?? null,
    onboarding_completed_at: data.onboarding_completed_at ?? null,
  }
  errorMessage.value = ''
  return profile.value
}

function installAuthListener() {
  if (listenerInstalled) return
  listenerInstalled = true

  supabase.auth.onAuthStateChange((event, nextSession) => {
    if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true, nextSession?.user.id)
    else if (nextSession && user.value?.id !== nextSession.user.id) restorePasswordRecovery(nextSession.user.id)
    if (user.value?.id !== nextSession?.user.id) profile.value = null
    session.value = nextSession
    user.value = nextSession?.user ?? null

    if (!nextSession) {
      setPasswordRecovery(false)
      profile.value = null
      errorMessage.value = ''
      return
    }

    // Defer the database request until the auth callback has returned. This
    // avoids making another Supabase request from inside the auth lock.
    queueMicrotask(() => {
      void refreshProfile().catch(() => undefined)
    })
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
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error

      session.value = data.session
      user.value = data.session?.user ?? null
      if (user.value) restorePasswordRecovery(user.value.id)

      if (user.value) {
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

export async function signOut(): Promise<void> {
  // Remove the signed-in user's device mapping before Supabase clears the JWT.
  // A notification failure must not trap someone inside their account.
  await unregisterFromClassNotifications().catch(() => undefined)
  await cancelStudentTaskReminders().catch(() => undefined)

  const { error } = await supabase.auth.signOut()
  if (error) throw error

  session.value = null
  user.value = null
  profile.value = null
  setPasswordRecovery(false)
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
    finishPasswordRecovery: () => { setPasswordRecovery(false) },
    isAuthenticated: computed(() => Boolean(session.value)),
    initializeSession,
    refreshProfile,
    signOut,
  }
}
