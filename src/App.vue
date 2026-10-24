<template>
  <ion-app>
    <ion-split-pane content-id="portal-content" when="lg" :disabled="!showPortalMenu">
      <app-menu v-if="showPortalMenu" />
      <ion-router-outlet id="portal-content" :key="user?.id ?? 'signed-out'" />
    </ion-split-pane>
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet, IonSplitPane } from '@ionic/vue'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppMenu from '@/components/AppMenu.vue'
import { useSession } from '@/composables/useSession'
import { loadStudentTaskData } from '@/services/studentTasks'
import { isNativeTaskReminders, listenForStudentTaskReminderActions, syncStudentTaskReminders } from '@/services/studentTaskReminders'
import { initializeNativeOAuthCallback } from '@/services/oauth'
import {
  listenForClassNotificationActions,
  registerForClassNotifications,
} from '@/services/notifications'

const route = useRoute()
const router = useRouter()
const { initializeSession, profile, user } = useSession()
const showPortalMenu = computed(
  () => Boolean(profile.value?.onboarding_completed_at)
    && /^\/(student|teacher|parent|admin)(\/|$)/.test(route.path)
    && !route.path.startsWith('/student/check-in/'),
)

let stopNotificationActions: (() => Promise<void>) | undefined
let stopTaskActions: (() => Promise<void>) | undefined
let notificationUserId: string | null = null
let notificationAttempt = 0

watch(
  () => [user.value?.id ?? null, profile.value?.role ?? null, profile.value?.onboarding_completed_at ?? null] as const,
  ([userId, role, completed]) => {
    if (!userId || !completed || (role !== 'teacher' && role !== 'student')) {
      notificationUserId = null
      notificationAttempt++
      return
    }
    const accountKey = `${userId}:${role}`
    if (notificationUserId === accountKey) return

    notificationUserId = accountKey
    const attempt = ++notificationAttempt
    void registerForClassNotifications().catch((error) => {
      // Notification setup must never block the portal. Leave the current
      // session intact and allow a later app launch to retry registration.
      if (attempt === notificationAttempt) notificationUserId = null
      console.warn('Class notifications could not be enabled.', error)
    })
    if (role === 'student' && isNativeTaskReminders()) {
      void loadStudentTaskData(userId).then(async ({ tasks }) => {
        if (user.value?.id !== userId || profile.value?.role !== 'student' || attempt !== notificationAttempt) return
        await syncStudentTaskReminders(userId, tasks)
      }).catch((error) => console.warn('Task reminders could not be refreshed.', error))
    }
  },
  { immediate: true },
)

onMounted(() => {
  void initializeSession()
  void initializeNativeOAuthCallback().catch(error => console.warn('Sign-in callback handling could not be enabled.', error))
  void listenForClassNotificationActions(async (destination) => {
    await router.push(destination)
  })
    .then((stop) => {
      stopNotificationActions = stop
    })
    .catch((error) => {
      console.warn('Notification tap handling could not be enabled.', error)
    })
  void listenForStudentTaskReminderActions(async (taskId, dueAt) => {
    await router.push({ path: '/student/tasks', query: { task: taskId, due: dueAt } })
  }).then(stop => { stopTaskActions = stop })
    .catch(error => console.warn('Task notification tap handling could not be enabled.', error))
})

onBeforeUnmount(() => {
  void stopNotificationActions?.()
  void stopTaskActions?.()
})
</script>
