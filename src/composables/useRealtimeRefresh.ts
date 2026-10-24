import type { RealtimeChannel } from '@supabase/supabase-js'
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/composables/useSession'

/** Subscribe to an RLS-protected invalidation counter, never private row payloads. */
export function useRealtimeRefresh(options: {
  channel: string
  onChange: () => void | Promise<void>
  enabled?: () => boolean
}) {
  const { user } = useSession()
  let channel: RealtimeChannel | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  let interval: ReturnType<typeof setInterval> | undefined
  let disposed = false
  let inFlight = false
  let pending = false

  async function refresh() {
    if (disposed || !user.value?.id || options.enabled?.() === false) return
    if (inFlight) { pending = true; return }
    inFlight = true
    try {
      await options.onChange()
    } catch (error) {
      console.warn('Live update could not be loaded.', error)
    } finally {
      inFlight = false
      if (pending && !disposed) { pending = false; schedule() }
    }
  }

  function schedule() {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => { void refresh() }, 180)
  }
  function onVisible() { if (document.visibilityState === 'visible') schedule() }
  function unsubscribe() {
    if (channel) void supabase.removeChannel(channel)
    channel = undefined
    if (debounce) clearTimeout(debounce)
    pending = false
  }
  const stop = watch(() => user.value?.id, (id) => {
    unsubscribe()
    if (!id || typeof supabase.channel !== 'function') return
    channel = supabase.channel(`${options.channel}:${id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'portal_change_events', filter: `user_id=eq.${id}`,
      }, schedule)
      .subscribe((status) => { if (status === 'SUBSCRIBED') schedule() })
  }, { immediate: true })

  onMounted(() => {
    window.addEventListener('focus', schedule)
    window.addEventListener('online', schedule)
    document.addEventListener('visibilitychange', onVisible)
    // Time windows also change without a database write. This is a quiet
    // fallback after sleep/disconnection, not a replacement for Realtime.
    interval = setInterval(() => { if (document.visibilityState === 'visible') schedule() }, 60_000)
  })
  onBeforeUnmount(() => {
    disposed = true
    stop()
    unsubscribe()
    if (interval) clearInterval(interval)
    window.removeEventListener('focus', schedule)
    window.removeEventListener('online', schedule)
    document.removeEventListener('visibilitychange', onVisible)
  })
  return { refresh: schedule }
}
