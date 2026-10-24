<template>
  <span ref="element" class="attendance-photo" :aria-label="!url ? (path ? 'Attendance photo loading' : 'No attendance photo') : undefined">
    <img v-if="url" :src="url" :alt="alt" loading="lazy" @error="retry" />
    <span v-else class="photo-state"><ion-icon :icon="path ? cameraOutline : imageOutline" aria-hidden="true" /><small v-if="failed">Photo unavailable</small></span>
  </span>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { IonIcon } from '@ionic/vue'
import { cameraOutline, imageOutline } from 'ionicons/icons'
import { useSession } from '@/composables/useSession'
import { attendancePhotoUrl, setAttendancePhotoOwner } from '@/services/attendancePhotos'
const props = withDefaults(defineProps<{ path?: string | null; alt?: string }>(), { path: null, alt: 'Attendance check-in photo' })
const { user } = useSession()
const element = ref<HTMLElement | null>(null)
const url = ref<string | null>(null), failed = ref(false)
let observer: IntersectionObserver | null = null
let visible = false, generation = 0, retried = false
async function load(force = false) {
  const request = ++generation, owner = user.value?.id, path = props.path
  if (!visible || !owner || !path) return
  const signed = await attendancePhotoUrl(owner, path, force)
  if (request !== generation || user.value?.id !== owner || props.path !== path) return
  url.value = signed; failed.value = !signed
}
function retry() { if (!retried) { retried = true; void load(true) } else { url.value = null; failed.value = true } }
watch(() => props.path, () => { generation++; url.value = null; failed.value = false; retried = false; void load() })
watch(() => user.value?.id, () => { generation++; url.value = null; failed.value = false; setAttendancePhotoOwner(user.value?.id || ''); void load() })
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') { visible = true; void load(); return }
  observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { visible = true; observer?.disconnect(); void load() } }, { rootMargin: '160px' })
  if (element.value) observer.observe(element.value)
})
onBeforeUnmount(() => { generation++; observer?.disconnect() })
</script>
<style scoped>
.attendance-photo { display:block; overflow:hidden; width:100%; height:100%; min-width:0; border-radius:inherit; background:var(--campus-surface-soft); }.attendance-photo img { display:block; width:100%; height:100%; object-fit:cover; }.photo-state { display:grid; place-content:center; justify-items:center; gap:4px; width:100%; height:100%; color:var(--campus-muted); }.photo-state ion-icon { font-size:24px; }.photo-state small { font-size:9px; }
</style>
