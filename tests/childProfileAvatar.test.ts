import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ signed: vi.fn() }))
const profile = ref<{ id: string; role: string } | null>(null)
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ profile }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({ createSignedUrl: mocks.signed }) } } }))
vi.mock('@/services/account', () => ({ AVATAR_BUCKET: 'profile-avatars', accountInitials: (name: string) => name.split(' ').map(part => part[0]).join('') }))
import ChildProfileAvatar from '@/components/ChildProfileAvatar.vue'

beforeEach(() => { vi.clearAllMocks(); profile.value = { id: 'parent-1', role: 'parent' }; mocks.signed.mockResolvedValue({ data: { signedUrl: 'https://storage.test/photo' }, error: null }) })
afterEach(() => { vi.useRealTimers() })
describe('linked child profile picture', () => {
  it('shows the uploaded photo with a short-lived authorized Storage URL', async () => {
    const wrapper = mount(ChildProfileAvatar, { props: { studentId: 'student-1', name: 'Ana Cruz', avatarPath: 'student-1/photo.jpg' } })
    await flushPromises()
    expect(mocks.signed).toHaveBeenCalledWith('student-1/photo.jpg', 300)
    expect(wrapper.get('img').attributes('src')).toBe('https://storage.test/photo')
    await wrapper.setProps({ name: 'Ana Dela Cruz' })
    expect(wrapper.get('img').attributes('src')).toBe('https://storage.test/photo')
    expect(mocks.signed).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  it('uses the authorized provider image when the child has not uploaded a photo', async () => {
    const wrapper = mount(ChildProfileAvatar, { props: { studentId: 'student-1', name: 'Ana Cruz', providerAvatarUrl: 'https://google.test/avatar' } })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('https://google.test/avatar')
    expect(mocks.signed).not.toHaveBeenCalled()
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('AC')
    wrapper.unmount()
  })
  it('clears the old photo on account switch and ignores its late response', async () => {
    let finish!: (result: unknown) => void
    mocks.signed.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(ChildProfileAvatar, { props: { studentId: 'student-1', name: 'Ana Cruz', avatarPath: 'student-1/photo.jpg' } })
    profile.value = null; await nextTick()
    finish({ data: { signedUrl: 'https://storage.test/old-parent' }, error: null }); await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
    wrapper.unmount()
  })
  it('rejects unsafe provider URLs and never requests Storage for a non-parent account', async () => {
    profile.value = { id: 'other', role: 'student' }
    const wrapper = mount(ChildProfileAvatar, { props: { studentId: 'student-1', name: 'Ana Cruz', avatarPath: 'student-1/photo.jpg', providerAvatarUrl: 'javascript:alert(1)' } })
    await flushPromises()
    expect(mocks.signed).not.toHaveBeenCalled()
    expect(wrapper.find('img').exists()).toBe(false)
    wrapper.unmount()
  })
})
