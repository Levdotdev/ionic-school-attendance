import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ signed: vi.fn() }))
const user = ref<{ id: string; email: string; user_metadata?: Record<string, unknown>; identities?: { provider: string; identity_data?: Record<string, unknown> }[] } | null>(null)
const profile = ref<{ full_name: string; avatar_path?: string | null } | null>(null)
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ user, profile }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({ createSignedUrl: mocks.signed }) } } }))
vi.mock('@/services/account', () => ({ AVATAR_BUCKET: 'profile-avatars', accountInitials: () => 'AB' }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); user.value = { id: 'user-1', email: 'avatar@example.com' }; profile.value = { full_name: 'Avatar User', avatar_path: 'user-1/photo.jpg' }; mocks.signed.mockResolvedValue({ data: { signedUrl: 'https://storage.example/avatar-1' }, error: null }) })

async function fixture() {
  const { useProfileAvatar } = await import('@/composables/useProfileAvatar')
  let state!: ReturnType<typeof useProfileAvatar>
  const wrapper = mount(defineComponent({ setup() { state = useProfileAvatar(); return () => h('span', state.avatarUrl.value || state.initials.value) } }))
  await flushPromises()
  return { wrapper, state }
}

describe('stable profile images', () => {
  it('does not clear or refetch a picture for unchanged background profile/auth refreshes', async () => {
    const { wrapper, state } = await fixture()
    expect(state.avatarUrl.value).toBe('https://storage.example/avatar-1')
    profile.value = { ...profile.value!, full_name: 'Updated Name' }
    user.value = { ...user.value!, user_metadata: {} }
    await nextTick()
    expect(state.avatarUrl.value).toBe('https://storage.example/avatar-1')
    await flushPromises()
    expect(mocks.signed).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  it('retains the displayed photo until a replacement signed URL is ready', async () => {
    const { wrapper, state } = await fixture()
    let finish!: (value: unknown) => void
    mocks.signed.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    profile.value = { ...profile.value!, avatar_path: 'user-1/replacement.jpg' }
    await nextTick()
    expect(state.avatarUrl.value).toBe('https://storage.example/avatar-1')
    finish({ data: { signedUrl: 'https://storage.example/avatar-2' }, error: null })
    await flushPromises()
    expect(state.avatarUrl.value).toBe('https://storage.example/avatar-2')
    wrapper.unmount()
  })
  it('uses a linked Google or Facebook picture without requesting Storage when no own image is configured', async () => {
    profile.value = { full_name: 'Provider User', avatar_path: null }
    user.value = { id: 'user-1', email: 'provider@example.com', identities: [{ provider: 'facebook', identity_data: { picture: 'https://facebook.example/avatar' } }] }
    const { wrapper, state } = await fixture()
    expect(state.avatarUrl.value).toBe('https://facebook.example/avatar')
    expect(mocks.signed).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('immediately clears another person’s photo on sign out and ignores stale requests', async () => {
    let finish!: (value: unknown) => void
    mocks.signed.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const { wrapper, state } = await fixture()
    user.value = null; profile.value = null
    await nextTick()
    finish({ data: { signedUrl: 'https://storage.example/old-user' }, error: null })
    await flushPromises()
    expect(state.avatarUrl.value).toBe('')
    wrapper.unmount()
  })
  it('rejects non-HTTPS provider photo values', async () => {
    const { providerAvatar } = await import('@/composables/useProfileAvatar')
    expect(providerAvatar({ identities: [{ provider: 'google', identity_data: { avatar_url: 'javascript:alert(1)' } }] })).toBe('')
  })
})
