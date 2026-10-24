<template>
  <ion-modal :is-open="isOpen" :can-dismiss="canDismiss" :backdrop-dismiss="!busy"
    :class="['app-dialog', { 'app-dialog-wide': wide }]" @didDismiss="onDidDismiss">
    <section class="dialog-shell" :aria-labelledby="titleId">
      <header class="dialog-header">
        <div v-if="icon" :class="['dialog-icon', { 'dialog-icon-danger': danger }]"><ion-icon :icon="icon" aria-hidden="true" /></div>
        <div class="dialog-heading"><h2 :id="titleId">{{ title }}</h2><p v-if="description">{{ description }}</p></div>
        <button class="dialog-close" type="button" aria-label="Close dialog" :disabled="busy" @click="$emit('dismiss')"><ion-icon :icon="closeOutline" aria-hidden="true" /></button>
      </header>
      <div v-if="$slots.default" class="dialog-body"><slot /></div>
      <footer v-if="!hideFooter" class="dialog-footer">
        <slot name="footer">
          <button class="dialog-primary" :class="{ danger }" type="button" :disabled="busy || disabled" @click="$emit('confirm')">
            <ion-spinner v-if="busy" name="crescent" aria-hidden="true" />{{ busy ? busyLabel : confirmLabel }}
          </button>
          <button class="dialog-cancel" type="button" :disabled="busy" @click="$emit('dismiss')">Cancel</button>
        </slot>
      </footer>
    </section>
  </ion-modal>
</template>

<script setup lang="ts">
import { useId, onBeforeUnmount } from 'vue';
import { IonModal, IonIcon, IonSpinner } from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
const props = withDefaults(defineProps<{
  isOpen: boolean; title: string; description?: string; icon?: string;
  confirmLabel?: string; busyLabel?: string; busy?: boolean; disabled?: boolean;
  danger?: boolean; wide?: boolean; hideFooter?: boolean;
}>(), { confirmLabel: 'Confirm', busyLabel: 'Saving…' });
const emit = defineEmits<{ (e: 'dismiss'): void; (e: 'confirm'): void; (e: 'closed'): void }>();
let unmounting = false;
// Block user cancellation during a save, but allow the owner to close or
// unmount the overlay after authentication changes.
function canDismiss() { return unmounting || !props.busy || !props.isOpen; }
onBeforeUnmount(() => { unmounting = true; });
function onDidDismiss() { emit('dismiss'); emit('closed'); }
const titleId = `dialog-${useId()}`;
</script>

<style scoped>
.app-dialog { --width: calc(100% - 32px); --max-width: 420px; --height: auto; --border-radius: 24px; --background: var(--campus-surface); --box-shadow: 0 24px 100px rgb(15 35 22 / 20%); }
.app-dialog-wide { --max-width: 560px; }
.dialog-shell { display: flex; flex-direction: column; max-height: calc(100dvh - 48px - var(--ion-safe-area-top, 0px) - var(--ion-safe-area-bottom, 0px)); overflow: auto; padding: 28px; color: var(--campus-text); background: var(--campus-surface); }
.dialog-header { position: relative; flex-shrink: 0; padding-right: 32px; }
.dialog-icon { display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: 18px; color: var(--ion-color-primary); background: var(--campus-green-soft); border-radius: 14px; font-size: 24px; }
.dialog-icon-danger { color: var(--campus-danger); background: var(--campus-danger-soft); }
.dialog-heading h2 { margin: 0; font-size: 23px; font-weight: 650; letter-spacing: -.6px; }
.dialog-heading p { margin: 10px 0 0; color: var(--campus-muted); font-size: 14px; line-height: 1.7; }
.dialog-close { position: absolute; top: -8px; right: -8px; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 12px; color: var(--campus-muted); background: transparent; font-size: 23px; }
.dialog-close:hover { background: var(--campus-surface-soft); }
.dialog-body { margin-top: 24px; }
.dialog-footer { display: flex; flex-direction: column; gap: 6px; margin-top: 26px; }
.dialog-footer ion-spinner { width: 18px; height: 18px; }
@media (max-width: 480px) { .dialog-shell { padding: 24px 20px; } .dialog-heading h2 { font-size: 21px; } }
.dialog-primary, .dialog-cancel { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 46px; padding: 12px 20px; border: 0; border-radius: 12px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.dialog-primary { background: var(--ion-color-primary); color: var(--ion-color-primary-contrast); }
.dialog-primary.danger { background: var(--ion-color-danger); color: var(--ion-color-danger-contrast); }
.dialog-cancel { color: var(--campus-muted); background: transparent; }
button:disabled { opacity: .55; cursor: wait; }
</style>
