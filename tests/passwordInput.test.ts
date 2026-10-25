import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@ionic/vue', () => ({
  IonIcon:defineComponent({render:()=>null}),
  IonInput:defineComponent({props:['modelValue','label','type','disabled'],emits:['update:modelValue'],setup:(props,{emit,slots})=>()=>h('label',[props.label,h('input',{value:props.modelValue,type:props.type,disabled:props.disabled,onInput:(event:Event)=>emit('update:modelValue',(event.target as HTMLInputElement).value)}),slots.default?.()])}),
}))
import PasswordInput from '@/components/PasswordInput.vue'
describe('persistent password visibility control',()=>{
  it('keeps a labelled Show/Hide button present and preserves the value across visibility changes',async()=>{
    const wrapper=mount(PasswordInput,{props:{modelValue:'Secret-password!'},attrs:{label:'Current password'}})
    expect(wrapper.get('input').attributes('type')).toBe('password')
    expect(wrapper.get('button').attributes('aria-label')).toBe('Show current password')
    await wrapper.get('button').trigger('click')
    expect(wrapper.get('input').attributes('type')).toBe('text')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Secret-password!')
    expect(wrapper.get('button').attributes('aria-label')).toBe('Hide current password')
    expect(wrapper.get('button').attributes('type')).toBe('button')
    await wrapper.get('input').setValue('Changed-password!')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['Changed-password!'])
    await wrapper.setProps({modelValue:''})
    expect(wrapper.get('input').attributes('type')).toBe('password')
    expect(wrapper.get('button').text()).toBe('Show')
    wrapper.unmount()
  })
})
