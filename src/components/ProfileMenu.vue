<template>
  <div v-if="user" class="profile-controls">
    <ion-button fill="clear" class="theme-toggle" :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'" :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'" @click="toggleTheme"><ion-icon slot="icon-only" :icon="isDark ? sunnyOutline : moonOutline" /></ion-button>
    <ion-button fill="clear" class="user-trigger" aria-label="Open your profile menu" :aria-expanded="menuOpen" aria-haspopup="dialog" @click="openMenu">
      <span class="toolbar-avatar"><img v-if="avatarUrl" :src="avatarUrl" alt="Your profile" referrerpolicy="no-referrer" @error="avatarUrl = ''" /><span v-else>{{ initials }}</span></span>
      <ion-icon :icon="chevronDownOutline" class="profile-chevron" aria-hidden="true" />
    </ion-button>
  </div>
  <ion-popover :is-open="menuOpen" :event="menuEvent" :show-backdrop="false" side="bottom" alignment="end" class="account-popover" @did-dismiss="menuOpen = false">
    <div class="profile-menu">
      <div class="profile-block"><span class="profile-avatar"><img v-if="avatarUrl" :src="avatarUrl" alt="" referrerpolicy="no-referrer" @error="avatarUrl = ''" /><span v-else>{{ initials }}</span></span><div><p class="profile-name">{{ profile?.full_name || 'My account' }}</p><p class="profile-email">{{ user?.email }}</p><span class="profile-role">{{ roleLabel }}</span></div></div>
      <section class="linked-methods" aria-label="Linked sign-in methods"><span>Linked sign-in methods</span><div v-if="methods.length" class="method-badges"><span v-for="method in methods" :key="method">{{ method }}</span></div><p v-else>{{ identityBusy ? 'Checking linked accounts…' : 'No linked methods available.' }}</p><p v-if="identityError" class="identity-error" role="status">{{ identityError }}</p></section>
      <div class="profile-divider" />
      <button type="button" class="menu-action" @click="show('settings')"><ion-icon :icon="settingsOutline" aria-hidden="true" />Account settings<ion-icon :icon="chevronForwardOutline" class="action-arrow" /></button>
      <button type="button" class="menu-action" @click="show('email')"><ion-icon :icon="mailOutline" aria-hidden="true" />Change email<ion-icon :icon="chevronForwardOutline" class="action-arrow" /></button>
      <button type="button" class="menu-action" @click="show('password')"><ion-icon :icon="keyOutline" aria-hidden="true" />Change password<ion-icon :icon="chevronForwardOutline" class="action-arrow" /></button>
      <div class="profile-divider" />
      <button type="button" class="menu-action signout-action" @click="show('signout')"><ion-icon :icon="logOutOutline" aria-hidden="true" />Sign out<ion-icon :icon="arrowForwardOutline" class="action-arrow" /></button>
    </div>
  </ion-popover>
  <account-settings-modal :open="activeDialog === 'settings'" @close="activeDialog = null" />
  <account-change-modal :open="activeDialog === 'email' || activeDialog === 'password'" :kind="activeDialog === 'email' ? 'email' : 'password'" @close="activeDialog = null" />
  <app-modal :open="activeDialog === 'signout'" title="Sign out of your account?" :busy="signingOut" @close="activeDialog = null">
    <p class="signout-description">Your saved classes, attendance, and tasks will be here when you return.</p>
    <p v-if="signoutError" class="signout-error" role="alert">{{ signoutError }}</p>
    <template #actions><ion-button fill="outline" :disabled="signingOut" @click="activeDialog = null">Cancel</ion-button><ion-button :disabled="signingOut" @click="confirmSignOut">{{ signingOut ? 'Signing out…' : 'Sign out' }}</ion-button></template>
  </app-modal>
</template>

<script setup lang="ts">
import { IonButton, IonIcon, IonPopover } from '@ionic/vue'
import { arrowForwardOutline, chevronDownOutline, chevronForwardOutline, keyOutline, logOutOutline, mailOutline, moonOutline, settingsOutline, sunnyOutline } from 'ionicons/icons'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AccountSettingsModal from '@/components/AccountSettingsModal.vue'
import AccountChangeModal from '@/components/AccountChangeModal.vue'
import AppModal from '@/components/AppModal.vue'
import { useProfileAvatar } from '@/composables/useProfileAvatar'
import { useSession } from '@/composables/useSession'
import { useTheme } from '@/composables/useTheme'
import { authActionError, linkedAuthMethods } from '@/services/account'

const { user, profile, refreshAuthUser, signOut } = useSession()
const { avatarUrl, initials } = useProfileAvatar()
const { isDark, toggleTheme } = useTheme()
const router = useRouter()
const menuOpen = ref(false), menuEvent = ref<Event>(), identityBusy = ref(false), identityError = ref(''), signingOut = ref(false), signoutError = ref('')
const activeDialog = ref<'settings' | 'email' | 'password' | 'signout' | null>(null)
const methods = computed(() => linkedAuthMethods(user.value))
const roleLabel = computed(() => ({ admin: 'Administrator', teacher: 'Teacher', student: 'Student', parent: 'Parent' }[profile.value?.role ?? 'student']))
async function openMenu(event: Event) {
  menuEvent.value = event; menuOpen.value = true; identityBusy.value = true; identityError.value = ''
  try { await refreshAuthUser() }
  catch { identityError.value = 'Could not refresh linked accounts. Showing your current session.' }
  finally { identityBusy.value = false }
}
function show(dialog: NonNullable<typeof activeDialog.value>) { menuOpen.value = false; activeDialog.value = dialog; signoutError.value = '' }
async function confirmSignOut() {
  if (signingOut.value) return
  signingOut.value = true; signoutError.value = ''
  try { await signOut(); activeDialog.value = null; await router.replace('/login') }
  catch (error) { signoutError.value = authActionError(error) }
  finally { signingOut.value = false }
}
</script>

<style scoped>
.profile-controls { display: flex; align-items: center; gap: 4px; }
.theme-toggle { --color: var(--campus-muted); --padding-start: 10px; --padding-end: 10px; width: 44px; height: 44px; margin: 0; }
.theme-toggle ion-icon { font-size: 20px; }
.user-trigger { --padding-start: 5px; --padding-end: 5px; margin: 0; min-height: 44px; }
.toolbar-avatar, .profile-avatar { display: grid; place-items: center; flex-shrink: 0; overflow: hidden; border: 1px solid var(--campus-border); border-radius: 50%; background: var(--campus-green-soft); color: var(--campus-green); font-weight: 650; }
.toolbar-avatar { width: 36px; height: 36px; font-size: 12px; }
.toolbar-avatar img, .profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
.profile-chevron { margin-left: 7px; color: var(--campus-muted); font-size: 12px; }
.account-popover { --width: 320px; --max-width: calc(100vw - 24px); --background: var(--campus-surface); --box-shadow: 0 14px 50px #0002; }
.profile-menu { padding: 22px; background: var(--campus-surface); color: var(--campus-text); }
.profile-block { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.profile-avatar { width: 44px; height: 44px; font-size: 15px; }
.profile-block > div { min-width: 0; }
.profile-name { margin: 0; font-size: 14px; font-weight: 650; overflow-wrap: anywhere; }
.profile-email { margin: 5px 0 7px; color: var(--campus-muted); font-size: 11px; overflow-wrap: anywhere; }
.profile-role { display: inline-block; padding: 4px 8px; border-radius: 6px; color: var(--campus-green); background: var(--campus-green-soft); font-size: 10px; font-weight: 650; }
.linked-methods > span { color: var(--campus-muted); font-size: 11px; }
.linked-methods p { font-size: 11px; color: var(--campus-muted); }
.method-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.method-badges span { padding: 5px 8px; border-radius: 7px; border: 1px solid var(--campus-border); color: var(--campus-text); font-size: 11px; }
.profile-divider { height: 1px; margin: 14px 0 7px; background: var(--campus-border); }
.menu-action { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 10px 6px; border: 0; border-radius: 8px; color: var(--campus-text); background: transparent; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.menu-action:hover, .menu-action:focus-visible { background: var(--campus-surface-soft); }
.menu-action ion-icon { font-size: 18px; color: var(--campus-muted); }
.menu-action .action-arrow { margin-left: auto; font-size: 14px; }
.signout-action, .signout-action ion-icon { color: var(--campus-danger); }
.signout-description { margin: 0; color: var(--campus-muted); font-size: 14px; line-height: 1.65; }
.signout-error { color: var(--campus-danger); font-size: 13px; }
@media (max-width: 600px) { .profile-chevron { display: none; } .profile-controls { gap: 0; } }
</style>
