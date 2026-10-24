import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useSession } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'
import { AVATAR_BUCKET, accountInitials } from '@/services/account'

const signedAvatars = new Map<string, { url: string; expiresAt: number }>()
const pendingAvatars = new Map<string, Promise<string>>()

/** Provider images are display-only. They never determine role or permissions. */
export function providerAvatar(account: { user_metadata?: Record<string, unknown>; identities?: readonly { provider: string; identity_data?: Record<string, unknown> }[] } | null | undefined): string {
  const social = account?.identities?.filter(identity => identity.provider === 'google' || identity.provider === 'facebook') ?? []
  const candidates = [
    ...social.flatMap(identity => [identity.identity_data?.avatar_url, identity.identity_data?.picture]),
    account?.user_metadata?.avatar_url, account?.user_metadata?.picture,
  ]
  return candidates.find((value): value is string => typeof value === 'string' && /^https:\/\//i.test(value)) ?? ''
}

async function signedAvatar(key: string, path: string): Promise<string> {
  const cached = signedAvatars.get(key)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url
  if (pendingAvatars.has(key)) return pendingAvatars.get(key)!
  const pending = (async () => {
    const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) throw error ?? new Error('Profile picture could not be loaded.')
    signedAvatars.set(key, { url: data.signedUrl, expiresAt: Date.now() + 3_600_000 })
    return data.signedUrl
  })()
  pendingAvatars.set(key, pending)
  try { return await pending }
  finally { if (pendingAvatars.get(key) === pending) pendingAvatars.delete(key) }
}

export function useProfileAvatar() {
  const { user, profile } = useSession()
  const avatarUrl = ref('')
  const initials = computed(() => accountInitials(profile.value?.full_name || user.value?.email || 'My account'))
  let request = 0
  let owner = ''
  let expires: ReturnType<typeof setTimeout> | undefined
  async function loadAvatar() {
    const attempt = ++request
    clearTimeout(expires)
    const userId = user.value?.id ?? ''
    const path = profile.value?.avatar_path
    const fallback = providerAvatar(user.value)
    // Never flash initials for unchanged auth/profile refreshes. A different
    // signed-in person, however, must not inherit the previous person's image.
    if (owner !== userId) { owner = userId; avatarUrl.value = '' }
    if (!userId) { avatarUrl.value = ''; return }
    if (!path) { avatarUrl.value = fallback; return }
    const key = `${userId}:${path}`
    if (!avatarUrl.value) avatarUrl.value = signedAvatars.get(key)?.url ?? fallback
    try {
      const url = await signedAvatar(key, path)
      if (attempt !== request || user.value?.id !== userId) return
      avatarUrl.value = url
      expires = setTimeout(() => { signedAvatars.delete(key); void loadAvatar() }, 55 * 60 * 1000)
    } catch {
      if (attempt !== request) return
      const cached = signedAvatars.get(key)
      if (!cached || cached.expiresAt <= Date.now()) avatarUrl.value = fallback
      expires = setTimeout(() => { void loadAvatar() }, 60_000)
    }
  }
  watch(() => `${user.value?.id ?? ''}|${profile.value?.avatar_path ?? ''}|${providerAvatar(user.value)}`, () => { void loadAvatar() }, { immediate: true })
  function onAvatarError() { avatarUrl.value = avatarUrl.value === providerAvatar(user.value) ? '' : providerAvatar(user.value) }
  onBeforeUnmount(() => { request++; clearTimeout(expires) })
  return { avatarUrl, initials, onAvatarError }
}
