import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ channel: vi.fn(), remove: vi.fn(), event: undefined as undefined | (() => void), status: undefined as undefined | ((status: string) => void) }))
const account = ref<{ id: string } | null>({ id: 'student-1' })
vi.mock('@/lib/supabase', () => ({ supabase: { channel: mocks.channel, removeChannel: mocks.remove } }))
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ user: account }) }))
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'

let handles: ReturnType<typeof mount>[] = []
function render(onChange: () => Promise<void> | void, enabled?: () => boolean) {
  const wrapper = mount(defineComponent({ setup() { useRealtimeRefresh({ channel: 'test', onChange, enabled }); return () => h('div') } }))
  handles.push(wrapper)
  return wrapper
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  account.value = { id: 'student-1' }
  mocks.channel.mockImplementation(() => {
    const channel = {
      on: vi.fn((_event, _filter, callback) => { mocks.event = callback; return channel }),
      subscribe: vi.fn(callback => { mocks.status = callback; return channel }),
    }
    return channel
  })
  mocks.remove.mockResolvedValue('ok')
})
afterEach(() => { handles.forEach(wrapper => wrapper.unmount()); handles = []; vi.useRealTimers() })

describe('recipient-only live updates', () => {
  it('listens only to the signed-in user invalidation row and coalesces changes', async () => {
    const change = vi.fn()
    render(change)
    const channel = mocks.channel.mock.results[0].value
    expect(channel.on).toHaveBeenCalledWith('postgres_changes', { event: '*', schema: 'public', table: 'portal_change_events', filter: 'user_id=eq.student-1' }, expect.any(Function))
    mocks.event?.(); mocks.event?.(); mocks.event?.()
    await vi.advanceTimersByTimeAsync(180)
    expect(change).toHaveBeenCalledOnce()
  })

  it('refetches on reconnect and focus without a refresh control', async () => {
    const change = vi.fn()
    render(change)
    mocks.status?.('SUBSCRIBED')
    await vi.advanceTimersByTimeAsync(180)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(180)
    expect(change).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes on account change and logout', async () => {
    const change = vi.fn()
    render(change)
    account.value = { id: 'student-2' }
    await nextTick()
    expect(mocks.remove).toHaveBeenCalledOnce()
    expect(mocks.channel).toHaveBeenLastCalledWith('test:student-2')
    account.value = null
    await nextTick()
    mocks.event?.()
    await vi.advanceTimersByTimeAsync(180)
    expect(mocks.remove).toHaveBeenCalledTimes(2)
    expect(change).not.toHaveBeenCalled()
  })

  it('respects disabled workspaces and cleans up pending events on unmount', async () => {
    const change = vi.fn()
    const wrapper = render(change, () => false)
    mocks.event?.()
    await vi.advanceTimersByTimeAsync(180)
    expect(change).not.toHaveBeenCalled()
    mocks.event?.()
    wrapper.unmount()
    handles = []
    await vi.advanceTimersByTimeAsync(80_000)
    expect(change).not.toHaveBeenCalled()
  })
})
