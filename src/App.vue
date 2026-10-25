<template>
  <ion-app>
    <div class="portal-layout" :class="{ 'has-navigation': showPortalMenu, 'navigation-collapsed': collapsed }">
      <app-menu v-if="showPortalMenu" />
      <div v-if="changingAccount || leavingAccount" class="account-switch-status" role="status">
        <div>
          <p>Opening your account…</p>
          <button type="button" :disabled="leavingAccount" @click="leaveChangingAccount">{{ leavingAccount ? 'Signing out…' : 'Sign out' }}</button>
          <p v-if="accountSwitchError" class="account-switch-error" role="alert">{{ accountSwitchError }}</p>
        </div>
      </div>
      <section v-show="!changingAccount && !leavingAccount" id="portal-content" class="portal-outlet"><ion-router-outlet :key="outletGeneration" /></section>
    </div>
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppMenu from '@/components/AppMenu.vue'
import { accountPathForProfile, useSession } from '@/composables/useSession'
import { useNavigation } from '@/composables/useNavigation'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'
import { loadStudentTaskData } from '@/services/studentTasks'
import { isNativeTaskReminders, listenForStudentTaskReminderActions, syncStudentTaskReminders } from '@/services/studentTaskReminders'
import { initializeNativeOAuthCallback } from '@/services/oauth'
import { toUserFacingErrorMessage } from '@/utils/errors'
import {
  listenForClassNotificationActions,
  registerForClassNotifications,
} from '@/services/notifications'

const route = useRoute()
const router = useRouter()
const { initializeSession, profile, user, refreshProfile, refreshAuthUser, signOut } = useSession()
const { collapsed } = useNavigation()
const outletGeneration = ref(0)
const leavingAccount = ref(false)
const accountSwitchError = ref('')
async function leaveChangingAccount() {
  if (leavingAccount.value) return
  leavingAccount.value = true
  accountSwitchError.value = ''
  try {
    await signOut()
    await router.replace('/login')
  } catch (error) {
    accountSwitchError.value = toUserFacingErrorMessage(error, 'Unable to sign out. Please try again.')
  } finally {
    leavingAccount.value = false
  }
}
const cachedAccountId = ref<string | null>(user.value?.id ?? null)
const privatePortal = (path: string) => /^\/(student|teacher|parent|admin)(\/|$)/.test(path)
const changingAccount = computed(() => Boolean(user.value?.id && cachedAccountId.value && user.value.id !== cachedAccountId.value && privatePortal(route.path)))
watch(() => [user.value?.id ?? null, route.path, profile.value?.id, profile.value?.role, profile.value?.onboarding_completed_at] as const, ([userId, path]) => {
  // Keep Ionic's active outlet alive while sign-in/sign-out is navigating.
  // Clear its cached private pages only after the sign-out route commits.
  if (!userId) {
    if (path === '/login' && cachedAccountId.value) { cachedAccountId.value = null; outletGeneration.value++ }
    return
  }
  if (!cachedAccountId.value) { cachedAccountId.value = userId; return }
  if (cachedAccountId.value === userId || profile.value?.id !== userId) return

  const destination = accountPathForProfile(profile.value)
  const reachedDestination = path === destination || (destination === '/student' && path.startsWith('/student/'))
  if (reachedDestination) {
    cachedAccountId.value = userId
    outletGeneration.value++
  } else if (privatePortal(path)) {
    // A different account can arrive through another tab without SIGNED_OUT.
    // Move to its own role before discarding the previous account's cache;
    // callback/login pages finish their own navigation without interruption.
    void router.replace(destination).catch(error => console.warn('Account navigation could not be completed.', error))
  }
})
useRealtimeRefresh({ channel: 'account-profile', onChange: async () => { await refreshAuthUser(); await refreshProfile() } })
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
    if (!userId || !completed || (role !== 'teacher' && role !== 'student' && role !== 'parent')) {
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

<style scoped>
.portal-layout { display: grid; grid-template-columns: minmax(0, 1fr); height: 100%; width: 100%; min-height: 0; }
.portal-outlet { position: relative; min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
.account-switch-status { display: grid; place-items: center; margin: 0; padding: 24px; color: var(--campus-muted); text-align: center; }
.account-switch-status button { min-height: 44px; padding: 10px 18px; border: 1px solid var(--campus-border); border-radius: 10px; background: var(--campus-surface); color: var(--campus-text); font: inherit; cursor: pointer; }
.account-switch-status button:disabled { opacity: .6; cursor: wait; }
.account-switch-error { max-width: 420px; color: var(--campus-danger); }
@media (min-width: 992px) {
  .portal-layout.has-navigation { grid-template-columns: 256px minmax(0, 1fr); }
  .portal-layout.has-navigation.navigation-collapsed { grid-template-columns: 76px minmax(0, 1fr); }
}
</style>
