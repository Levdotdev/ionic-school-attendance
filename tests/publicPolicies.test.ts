import { mount } from '@vue/test-utils'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { getPublicPolicy, publicPolicyKinds } from '@/content/publicPolicies.mjs'

vi.mock('/minsu-logo.png', () => ({ default: '/minsu-logo.png' }))
vi.mock('@ionic/vue', async () => {
  const { defineComponent, h } = await import('vue')
  const shell = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
  return { IonPage: shell, IonContent: shell }
})
import PublicPolicyPage from '@/views/PublicPolicyPage.vue'

describe('public privacy and deletion information', () => {
  it('describes actual sensitive data and parent-only online coordinates without claiming university operation', () => {
    const wrapper = mount(PublicPolicyPage, { props: { kind: 'privacy' } })
    expect(wrapper.get('h1').text()).toBe('Privacy policy')
    expect(wrapper.text()).toContain('not an official university service')
    expect(wrapper.text()).toContain('project-owned Gmail address')
    expect(wrapper.text()).toContain('face template')
    expect(wrapper.text()).toContain('stored as a hash')
    expect(wrapper.text()).toContain('only to the verified, approved linked parent')
    expect(wrapper.text()).toContain('does not provide a general automatic deletion schedule')
    expect(wrapper.find('a[href="/data-deletion.html"]').exists()).toBe(true)
    expect(wrapper.findAll('form')).toHaveLength(0)
    wrapper.unmount()
  })

  it('offers a manual email request without claiming automatic deletion or posting student information', () => {
    const wrapper = mount(PublicPolicyPage, { props: { kind: 'deletion' } })
    expect(wrapper.get('h1').text()).toBe('Data deletion instructions')
    const request = wrapper.get('.request-button')
    expect(request.attributes('href')).toBe('mailto:support.attendanceminsu@gmail.com?subject=MinSU%20Attendance%20data%20deletion%20request')
    expect(wrapper.text()).toContain('does not send a message or delete anything automatically')
    expect(wrapper.text()).toContain('Unlinking Facebook or Google is different')
    expect(wrapper.text()).toContain('not an automated Facebook data-deletion callback endpoint')
    expect(wrapper.text()).toContain('Do not include passwords, login or recovery codes')
    expect(wrapper.findAll('input,textarea,form')).toHaveLength(0)
    wrapper.unmount()
  })

  it.each(publicPolicyKinds)('serves the full %s document without JavaScript and keeps static content in sync', async kind => {
    const policy = getPublicPolicy(kind)
    const html = await readFile(resolve(process.cwd(), 'public', policy.fileName), 'utf8')
    expect(html).toContain('<!doctype html>')
    expect(html).toContain(policy.html)
    expect(html).toContain(`<title>${policy.title} | MinSU Attendance student project</title>`)
    expect(html).toContain("localStorage.getItem('minsu-attendance-theme')")
    expect(html).not.toContain('v-if=')
    expect(html).not.toContain('{{')
    expect(html).not.toContain(':href=')
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    expect(parsed.querySelectorAll('script')).toHaveLength(1)
    expect(parsed.querySelector('script')?.hasAttribute('src')).toBe(false)
    expect(parsed.querySelector('style')?.textContent).toContain(':root:not([data-theme])')
    expect(parsed.querySelector('main h1')?.textContent).toBe(policy.title)
    expect(parsed.querySelectorAll('main section').length).toBeGreaterThan(3)
    expect(parsed.querySelector('a[href="mailto:support.attendanceminsu@gmail.com"]')).not.toBeNull()
  })

  it.each(['light', 'dark'])('retains the saved %s appearance in a static policy document', async theme => {
    const html = await readFile(resolve(process.cwd(), 'public/privacy-policy.html'), 'utf8')
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    localStorage.setItem('minsu-attendance-theme', theme)
    const execute = new Function('localStorage', 'document', parsed.querySelector('script')!.textContent!)
    execute(localStorage, parsed)
    expect(parsed.documentElement.dataset.theme).toBe(theme)
    expect(parsed.documentElement.style.colorScheme).toBe(theme)
    localStorage.removeItem('minsu-attendance-theme')
  })
})
