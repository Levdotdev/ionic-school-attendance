import { mount } from '@vue/test-utils'
import { defineComponent,h } from 'vue'
import { describe,expect,it,vi } from 'vitest'
const mocks=vi.hoisted(()=>({verify:vi.fn(),exchange:vi.fn()}))
vi.mock('/minsu-logo.png',()=>({default:'/minsu-logo.png'}))
vi.mock('@/lib/supabase',()=>({supabase:{auth:{verifyOtp:mocks.verify,exchangeCodeForSession:mocks.exchange}}}))
vi.mock('@ionic/vue',()=>({
  IonPage:defineComponent({setup:(_, {slots})=>()=>h('div',slots.default?.())}),
  IonContent:defineComponent({setup:(_, {slots})=>()=>h('div',slots.default?.())}),
  IonButton:defineComponent({setup:(_, {slots,attrs})=>()=>h('a',attrs,slots.default?.())}),
}))
import MobileEmailActionPage from '@/views/MobileEmailActionPage.vue'
describe('HTTPS native email handoff',()=>{
  it.each(['email','email_change','recovery','invite'])('does not consume %s grants until the recipient chooses a destination',type=>{
    window.history.replaceState({},'',`/auth/mobile?token_hash=sample-hash&type=${type}`)
    const wrapper=mount(MobileEmailActionPage)
    const links=wrapper.findAll('a')
    expect(links.map(link=>link.text())).toEqual(['Open app','Continue in browser'])
    expect(links[0].attributes('href')).toBe(`edu.minsu.attendance://auth/callback?token_hash=sample-hash&type=${type}`)
    expect(links[1].attributes('href')).toBe(`${window.location.origin}/auth/callback?token_hash=sample-hash&type=${type}`)
    expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.exchange).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/auth/mobile')
    wrapper.unmount()
  })
  it('offers recovery without exposing a malformed token or following untrusted return URLs',()=>{
    window.history.replaceState({},'','/auth/mobile?token_hash=sample&type=admin&next=https://attacker.invalid')
    const wrapper=mount(MobileEmailActionPage)
    expect(wrapper.text()).toContain('incomplete')
    expect(wrapper.get('a').attributes('href')).toBe('/login')
    expect(mocks.verify).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
