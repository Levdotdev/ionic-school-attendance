<template>
  <ion-modal :is-open="open" :can-dismiss="canDismiss" class="app-dialog" :class="{ 'app-dialog-wide': wide }" @did-dismiss="$emit('close')">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ title }}</ion-title>
        <ion-buttons slot="end"><ion-button :disabled="busy" aria-label="Close dialog" @click="$emit('close')"><ion-icon :icon="closeOutline" /></ion-button></ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content><div class="dialog-body"><slot /></div></ion-content>
    <ion-footer v-if="$slots.actions"><div class="dialog-actions"><slot name="actions" /></div></ion-footer>
  </ion-modal>
</template>

<script setup lang="ts">
import { IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonIcon, IonModal, IonTitle, IonToolbar } from '@ionic/vue'
import { closeOutline } from 'ionicons/icons'
import { onBeforeUnmount } from 'vue'
const props = defineProps<{ open: boolean; title: string; busy?: boolean; wide?: boolean }>()
defineEmits<{ close: [] }>()
let unmounting = false
function canDismiss() { return unmounting || !props.open || !props.busy }
onBeforeUnmount(() => { unmounting = true })
</script>

<style scoped>
.app-dialog { --width: min(580px, calc(100% - 32px)); --height: min(720px, calc(100% - 48px)); --border-radius: var(--campus-radius, 18px); --box-shadow: 0 24px 90px #0003; --page-blue: var(--campus-accent); --page-blue-soft: var(--campus-accent-soft); --page-bg: var(--campus-bg); --page-surface: var(--campus-surface); --page-surface-soft: var(--campus-surface-soft); --page-text: var(--campus-text); --page-muted: var(--campus-muted); --page-border: var(--campus-border); --page-danger: var(--campus-danger); --page-danger-soft: var(--campus-danger-soft); }
.app-dialog-wide { --width: min(800px, calc(100% - 32px)); }
ion-toolbar { --background: var(--campus-surface); --color: var(--campus-text); --border-color: var(--campus-border); --min-height: 62px; }
ion-title { font-size: 16px; font-weight: 700; }
ion-content { --background: var(--campus-surface); --color: var(--campus-text); }
.dialog-body { padding: 24px; }
ion-footer { background: var(--campus-surface); border-top: 1px solid var(--campus-border); box-shadow: none; }
.dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; padding: 16px 24px; }
@media (max-width: 600px) { .app-dialog, .app-dialog-wide { --width: calc(100% - 20px); --height: calc(100% - 48px); --border-radius: 18px; } .dialog-body { padding: 18px; } .dialog-actions { padding: 12px 18px; } }
</style>
