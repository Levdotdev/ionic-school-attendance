<template>
  <aside class="desktop-sidebar" :class="{ 'is-collapsed': collapsed }" aria-label="Main navigation">
    <portal-navigation :collapsed="collapsed" />
    <button class="collapse-control" :aria-expanded="!collapsed" @click="toggleSidebar">
      <ion-icon :icon="collapsed ? chevronForwardOutline : chevronBackOutline" />
      <span>{{ collapsed ? 'Expand sidebar' : 'Collapse sidebar' }}</span>
    </button>
  </aside>
  <ion-menu menu-id="portal-menu" content-id="portal-content" type="overlay" class="mobile-sidebar">
    <ion-content><portal-navigation /></ion-content>
  </ion-menu>
</template>

<script setup lang="ts">
import { IonContent, IonIcon, IonMenu } from '@ionic/vue'
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons'
import PortalNavigation from '@/components/PortalNavigation.vue'
import { useNavigation } from '@/composables/useNavigation'
const { collapsed, toggleSidebar } = useNavigation()
</script>

<style scoped>
.desktop-sidebar { display: none; }
.mobile-sidebar { --width: 280px; --background: var(--campus-surface); }
.collapse-control { display: flex; align-items: center; gap: 12px; width: calc(100% - 24px); margin: 10px 12px 18px; padding: 12px; border: 1px solid var(--campus-border); border-radius: 10px; color: var(--campus-muted); background: var(--campus-surface-soft); font-size: 12px; text-align: left; cursor: pointer; }
.collapse-control ion-icon { flex: 0 0 18px; font-size: 18px; }
.is-collapsed .collapse-control { width: 48px; justify-content: center; padding: 12px; }
.is-collapsed .collapse-control span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (min-width: 992px) {
  .desktop-sidebar { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: auto; border-right: 1px solid var(--campus-border); background: var(--campus-surface); }
  .desktop-sidebar :deep(.navigation-shell) { min-height: 0; }
  .mobile-sidebar { display: none; }
}
</style>
