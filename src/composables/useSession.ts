import type { Session, User } from '@supabase/supabase-js'
import { computed, readonly, ref, shallowRef } from 'vue'

import { supabase } from '@/lib/supabase'

export type AppRole = 'student' | 'teacher' | 'parent'

export interface AppProfile {
  id: string
  role: AppRole
  full_name: string
  email: string
}

const session = shallowRef<Session | null>(null)
const user = shallowRef<User | null>(null)
const profile = shallowRef<AppProfile | null>(null)
const loading = ref(true)
const initialized = ref(false)
const errorMessage = ref('')

let initializePromise: Promise<void> | null = null
let listenerInstalled = false

function isAppRole(value: unknown): value is AppRole {
  return value === 'student' || value === 'teacher' || value === 'parent'
}

export async function refreshProfile(): Promise<AppProfile | null> {
  const currentUser = user.value

  if (!currentUser) {
    profile.value = null
    return null
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, email')
    .eq('id', currentUser.id)
    .maybeSingle()

  if (error) {
    errorMessage.value = error.message
    throw error
  }

  if (!data || !isAppRole(data.role)) {
    profile.value = null
    return null
  }

  profile.value = {
    id: data.id,
    role: data.role,
    full_name: data.full_name,
    email: data.email || currentUser.email || '',
  }
  errorMessage.value = ''
  return profile.value
}

function installAuthListener() {
  if (listenerInstalled) return
  listenerInstalled = true

  supabase.auth.onAuthStateChange((_event, nextSession) => {
    session.value = nextSession
    user.value = nextSession?.user ?? null

    if (!nextSession) {
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
  const { error } = await supabase.auth.signOut()
  if (error) throw error

  session.value = null
  user.value = null
  profile.value = null
}

export function homePathForRole(role: AppRole): string {
  return `/${role}`
}

export function useSession() {
  return {
    session: readonly(session),
    user: readonly(user),
    profile: readonly(profile),
    loading: readonly(loading),
    initialized: readonly(initialized),
    errorMessage: readonly(errorMessage),
    isAuthenticated: computed(() => Boolean(session.value)),
    initializeSession,
    refreshProfile,
    signOut,
  }
}
