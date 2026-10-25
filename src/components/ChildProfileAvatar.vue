<template>
  <span class="child-profile-avatar">
    <img v-if="url" :src="url" :alt="`${name}'s profile picture`" referrerpolicy="no-referrer" @error="imageFailed" />
    <span v-else aria-hidden="true">{{ accountInitials(name) }}</span>
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useSession } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'
import { AVATAR_BUCKET, accountInitials } from '@/services/account'

const props = defineProps<{ studentId: string; name: string; avatarPath?: string | null; providerAvatarUrl?: string | null }>()
const { profile } = useSession()
const url = ref('')
let request = 0
let owner = ''
let timer: ReturnType<typeof setTimeout> | undefined
let signedPath = ''
const providerUrl = () => /^https:\/\/[^\s]+$/i.test(props.providerAvatarUrl ?? '') ? props.providerAvatarUrl! : ''

async function load() {
  const attempt = ++request
  const parentId = profile.value?.role === 'parent' ? profile.value.id : ''
  const key = `${parentId}:${props.studentId}`
  if (owner !== key) { clearTimeout(timer); owner = key; url.value = ''; signedPath = '' }
  if (!parentId) { clearTimeout(timer); url.value = ''; return }
  if (!props.avatarPath) { clearTimeout(timer); signedPath = ''; url.value = providerUrl(); return }
  const path = props.avatarPath
  if (signedPath === path && url.value) return
  clearTimeout(timer)
  if (!url.value) url.value = providerUrl()
  try {
    // The Storage policy checks both the current approved parent link and that
    // this is the child's current uploaded picture, not an arbitrary old file.
    const result = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 300)
    if (attempt !== request || profile.value?.id !== parentId) return
    if (result.error || !result.data?.signedUrl) throw result.error ?? new Error('Picture unavailable')
    url.value = result.data.signedUrl
    signedPath = path
    timer = setTimeout(() => { signedPath = ''; void load() }, 240_000)
  } catch {
    if (attempt === request) { url.value = providerUrl(); signedPath = ''; timer = setTimeout(() => { void load() }, 60_000) }
  }
}
function imageFailed() { url.value = url.value === providerUrl() ? '' : providerUrl(); signedPath = '' }
watch(() => [profile.value?.id, profile.value?.role, props.studentId, props.avatarPath, props.providerAvatarUrl], () => { void load() }, { immediate: true })
onBeforeUnmount(() => { request++; clearTimeout(timer); url.value = '' })
</script>

<style scoped>
.child-profile-avatar { display:grid; place-items:center; flex-shrink:0; width:48px; height:48px; overflow:hidden; border-radius:14px; background:var(--campus-green-soft); color:var(--campus-green); font-size:14px; font-weight:700; }
.child-profile-avatar img { display:block; width:100%; height:100%; object-fit:cover; }
</style>
