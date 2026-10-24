<template>
  <ion-header class="portal-header">
    <ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button class="mobile-menu-button" aria-label="Open navigation menu" /><ion-button class="desktop-menu-button" :aria-label="collapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'" :aria-expanded="!collapsed" @click="toggleSidebar"><ion-icon slot="icon-only" :icon="menuOutline" /></ion-button></ion-buttons>
      <ion-title>
        <span class="portal-brand">
          <img src="/minsu-logo.png" alt="" width="38" height="38" />
          <span><strong>MinSU Attendance</strong><small>{{ portal }}</small></span>
        </span>
      </ion-title>
      <ion-buttons slot="end">
        <slot />
        <profile-menu />
      </ion-buttons>
    </ion-toolbar>
  </ion-header>
</template>

<script setup lang="ts">
import { IonButton, IonButtons, IonHeader, IonIcon, IonMenuButton, IonTitle, IonToolbar } from '@ionic/vue'
import { menuOutline } from 'ionicons/icons'
import ProfileMenu from '@/components/ProfileMenu.vue'
import { useNavigation } from '@/composables/useNavigation'
const { collapsed, toggleSidebar } = useNavigation()
defineProps<{ portal: string; busy?: boolean }>()
defineEmits<{ logout: [] }>()
</script>

<style scoped>
.portal-header { box-shadow: none; }
ion-toolbar { --background: var(--campus-surface); --color: var(--campus-text); --border-color: var(--campus-border); --min-height: 70px; --padding-start: 12px; --padding-end: 16px; }
.portal-brand { display: flex; min-width: 0; align-items: center; gap: 11px; }
.portal-brand img { flex: 0 0 38px; border-radius: 50%; background: #fff; }
.portal-brand > span { display: grid; min-width: 0; gap: 3px; }
.portal-brand strong, .portal-brand small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.portal-brand strong { font-size: 14px; font-weight: 700; letter-spacing: -.025em; }
.portal-brand small { color: var(--campus-muted); font-size: 11px; font-weight: 500; }
ion-button { --color: var(--campus-muted); font-size: 12px; font-weight: 600; text-transform: none; }
.desktop-menu-button { display: none; }
@media (min-width: 992px) { .mobile-menu-button { display: none; } .desktop-menu-button { display: inline-flex; } }
@media (max-width: 600px) { ion-toolbar { --min-height: 64px; --padding-start: 4px; --padding-end: 8px; } .signout-label { display: none; } .portal-brand { gap: 8px; } .portal-brand strong { font-size: 13px; } }
</style>
