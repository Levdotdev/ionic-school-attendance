import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useSession } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'
import { AVATAR_BUCKET, accountInitials } from '@/services/account'

export function useProfileAvatar() {
  const { user, profile } = useSession()
  const avatarUrl = ref('')
  const initials = computed(() => accountInitials(profile.value?.full_name || user.value?.email || 'My account'))
  let request = 0
  let expires: ReturnType<typeof setTimeout> | undefined
  async function loadAvatar() {
    const attempt = ++request
    clearTimeout(expires)
    const path = profile.value?.avatar_path
    const providerPicture = user.value?.user_metadata?.avatar_url ?? user.value?.user_metadata?.picture
    const fallback = typeof providerPicture === 'string' && /^https:\/\//.test(providerPicture) ? providerPicture : ''
    avatarUrl.value = path ? '' : fallback
    if (!path || !user.value) return
    const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 3600)
    if (attempt !== request) return
    avatarUrl.value = !error && data?.signedUrl ? data.signedUrl : ''
    if (!error) expires = setTimeout(() => { void loadAvatar() }, 55 * 60 * 1000)
  }
  watch(() => [profile.value?.avatar_path, user.value?.id, user.value?.user_metadata?.avatar_url, user.value?.user_metadata?.picture], () => { void loadAvatar().catch(() => { avatarUrl.value = '' }) }, { immediate: true })
  onBeforeUnmount(() => { request++; clearTimeout(expires) })
  return { avatarUrl, initials }
}
