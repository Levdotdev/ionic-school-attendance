<template>
  <ion-input v-bind="$attrs" v-model="inputValue" :type="visible ? 'text' : 'password'">
    <button slot="end" type="button" class="password-visibility" :aria-label="visible ? `Hide ${labelText}` : `Show ${labelText}`" :aria-pressed="visible" :disabled="Boolean($attrs.disabled)" @click.stop="visible = !visible">
      <ion-icon :icon="visible ? eyeOffOutline : eyeOutline" aria-hidden="true" />
      <span>{{ visible ? 'Hide' : 'Show' }}</span>
    </button>
  </ion-input>
</template>

<script setup lang="ts">
import { IonIcon, IonInput } from '@ionic/vue'
import { eyeOffOutline, eyeOutline } from 'ionicons/icons'
import { computed, ref, useAttrs, watch } from 'vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const inputValue = computed({ get: () => props.modelValue ?? '', set: (value: string) => emit('update:modelValue', value) })
const attrs = useAttrs()
const visible = ref(false)
const labelText = computed(() => String(attrs.label ?? 'password').toLowerCase())
watch(() => props.modelValue, value => { if (!value) visible.value = false })
</script>

<style scoped>
.password-visibility { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 5px; min-width: 64px; min-height: 44px; margin: 0 -4px 0 8px; padding: 8px; border: 0; border-radius: 8px; background: transparent; color: var(--campus-text); font: inherit; font-size: 12px; cursor: pointer; }
.password-visibility ion-icon { width: 18px; height: 18px; }
.password-visibility:focus-visible { outline: 2px solid var(--campus-green); outline-offset: 1px; }
.password-visibility:disabled { opacity: .5; cursor: default; }
</style>
