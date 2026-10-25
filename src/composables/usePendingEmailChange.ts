import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { pendingEmailChange, type PendingEmailAccount } from '@/utils/pendingEmailChange'

/** Recompute visible requests at expiry and after returning from a sleeping tab. */
export function usePendingEmailChange(account: () => PendingEmailAccount | null | undefined, enabled: () => boolean) {
  const now = ref(Date.now())
  const pending = computed(() => pendingEmailChange(account(), now.value))
  let timer: ReturnType<typeof setInterval> | undefined
  function updateClock() {
    now.value = Date.now()
    if (pending.value.status !== 'pending') { clearInterval(timer); timer = undefined }
  }
  function visible() { if (document.visibilityState === 'visible') updateClock() }
  watch(() => `${enabled()}:${account()?.email ?? ''}:${account()?.new_email ?? ''}:${account()?.email_change_sent_at ?? ''}`, () => {
    clearInterval(timer); updateClock()
    if (enabled() && pending.value.status === 'pending') timer = setInterval(updateClock, 1000)
  }, { immediate: true })
  onMounted(() => { window.addEventListener('focus', updateClock); window.addEventListener('online', updateClock); document.addEventListener('visibilitychange', visible) })
  onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener('focus', updateClock); window.removeEventListener('online', updateClock); document.removeEventListener('visibilitychange', visible) })
  return pending
}
