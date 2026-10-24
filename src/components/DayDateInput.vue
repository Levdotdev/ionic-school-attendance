<template>
  <span class="day-date-field">
    <input v-bind="$attrs" :type="type" :value="modelValue" :aria-describedby="descriptionIds" @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
    <small :id="hintId" class="selected-day" aria-live="polite">{{ selectedDay }}</small>
  </span>
</template>

<script setup lang="ts">
import { computed, useAttrs, useId } from 'vue'
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ modelValue?: string; type?: 'date' | 'datetime-local' }>(), { modelValue: '', type: 'date' })
defineEmits<{ 'update:modelValue': [value: string] }>()
const attrs = useAttrs()
const hintId = `selected-day-${useId()}`
const descriptionIds = computed(() => [attrs['aria-describedby'], hintId].filter(Boolean).join(' '))
const selectedDay = computed(() => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(props.modelValue)
  if (!parts) return 'Choose a date to see the day of the week.'
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3])
  // Date-only parsing is local: new Date('YYYY-MM-DD') would shift the day in
  // some time zones because JavaScript treats that form as UTC.
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return 'Choose a valid date.'
  return date.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
})
</script>

<style scoped>
.day-date-field { display: grid; min-width: 0; width: 100%; gap: 7px; font-weight: 400; }
input { display: block; width: 100%; min-width: 0; min-height: 46px; padding: 12px 14px; border: 1px solid var(--campus-border); border-radius: 12px; background: var(--campus-surface); color: var(--campus-text); font: inherit; font-size: 14px; color-scheme: inherit; }
input:focus-visible { outline: 2px solid var(--campus-green); outline-offset: 2px; }
input:disabled { opacity: .6; }
.selected-day { color: var(--campus-muted); font-size: 11px; line-height: 1.5; font-weight: 400; }
@media (max-width: 600px) { input { font-size: 16px; } }
</style>
