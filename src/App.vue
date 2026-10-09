<template>
  <ion-app>
    <ion-split-pane content-id="portal-content" when="lg" :disabled="!showPortalMenu">
      <app-menu v-if="showPortalMenu" />
      <ion-router-outlet id="portal-content" />
    </ion-split-pane>
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet, IonSplitPane } from '@ionic/vue'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppMenu from '@/components/AppMenu.vue'
import { useSession } from '@/composables/useSession'
import {
  listenForClassNotificationActions,
  registerForClassNotifications,
} from '@/services/notifications'

const route = useRoute()
const router = useRouter()
const { initializeSession, profile, user } = useSession()
const showPortalMenu = computed(
  () => Boolean(profile.value) && route.path !== '/login' && !route.path.startsWith('/student/check-in/'),
)

let stopNotificationActions: (() => Promise<void>) | undefined
let notificationUserId: string | null = null
let notificationAttempt = 0

watch(
  () => [user.value?.id ?? null, profile.value?.role ?? null] as const,
  ([userId, role]) => {
    if (!userId || (role !== 'teacher' && role !== 'student')) {
      notificationUserId = null
      return
    }
    if (notificationUserId === userId) return

    notificationUserId = userId
    const attempt = ++notificationAttempt
    void registerForClassNotifications().catch((error) => {
      // Notification setup must never block the portal. Leave the current
      // session intact and allow a later app launch to retry registration.
      if (attempt === notificationAttempt) notificationUserId = null
      console.warn('Class notifications could not be enabled.', error)
    })
  },
  { immediate: true },
)

onMounted(() => {
  void initializeSession()
  void listenForClassNotificationActions(async (destination) => {
    await router.push(destination)
  })
    .then((stop) => {
      stopNotificationActions = stop
    })
    .catch((error) => {
      console.warn('Notification tap handling could not be enabled.', error)
    })
})

onBeforeUnmount(() => {
  void stopNotificationActions?.()
})
</script>
