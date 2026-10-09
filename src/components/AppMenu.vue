<template>
  <ion-menu menu-id="portal-menu" content-id="portal-content" type="overlay" class="portal-menu">
    <ion-content>
      <div class="menu-shell">
        <header class="menu-brand">
          <img src="/minsu-logo.png" alt="Mindoro State University seal" />
          <span>
            <strong>MinSU Attendance</strong>
            <small>Academic portal</small>
          </span>
        </header>

        <section v-if="profile" class="menu-profile" aria-label="Signed-in account">
          <span class="profile-avatar" aria-hidden="true">{{ initials(profile.full_name) }}</span>
          <span>
            <strong>{{ profile.full_name }}</strong>
            <small>{{ roleLabel(profile.role) }}</small>
          </span>
        </section>

        <nav aria-label="Portal navigation">
          <p class="menu-label">Menu</p>
          <ion-list lines="none">
            <ion-menu-toggle v-for="item in navigation" :key="item.label" :auto-hide="false">
              <ion-item
                button
                :detail="false"
                :router-link="item.to"
                router-direction="root"
                :class="{ 'is-active': isActive(item) }"
                :aria-current="isActive(item) ? 'page' : undefined"
              >
                <ion-icon slot="start" :icon="item.icon" aria-hidden="true" />
                <ion-label>{{ item.label }}</ion-label>
              </ion-item>
            </ion-menu-toggle>
          </ion-list>
        </nav>

        <footer class="menu-footer">
          <ion-list lines="none">
            <ion-item button :detail="false" @click="toggleTheme">
              <ion-icon slot="start" :icon="isDark ? sunnyOutline : moonOutline" aria-hidden="true" />
              <ion-label>{{ isDark ? 'Light mode' : 'Dark mode' }}</ion-label>
            </ion-item>
            <ion-item button :detail="false" :disabled="signingOut" @click="logout">
              <ion-icon slot="start" :icon="logOutOutline" aria-hidden="true" />
              <ion-label>{{ signingOut ? 'Signing out…' : 'Sign out' }}</ion-label>
            </ion-item>
          </ion-list>
          <p>Mindoro State University · Attendance and student work</p>
        </footer>
      </div>
    </ion-content>
  </ion-menu>
</template>

<script setup lang="ts">
import {
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenu,
  IonMenuToggle,
} from '@ionic/vue'
import {
  calendarOutline,
  checkboxOutline,
  checkmarkDoneOutline,
  homeOutline,
  logOutOutline,
  moonOutline,
  peopleOutline,
  schoolOutline,
  shieldCheckmarkOutline,
  sunnyOutline,
} from 'ionicons/icons'
import { computed, ref } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'

import { useSession, type AppRole } from '@/composables/useSession'
import { useTheme } from '@/composables/useTheme'

interface NavigationItem {
  label: string
  icon: string
  to: RouteLocationRaw
  section?: string
}

const route = useRoute()
const router = useRouter()
const { profile, signOut } = useSession()
const { isDark, toggleTheme } = useTheme()
const signingOut = ref(false)

const navigation = computed<NavigationItem[]>(() => {
  if (profile.value?.role === 'teacher') {
    return [
      { label: 'Overview', icon: homeOutline, to: { path: '/teacher', query: { section: 'overview' } }, section: 'overview' },
      { label: 'Classes', icon: schoolOutline, to: { path: '/teacher', query: { section: 'classes' } }, section: 'classes' },
      { label: 'Attendance', icon: checkmarkDoneOutline, to: { path: '/teacher', query: { section: 'attendance' } }, section: 'attendance' },
      { label: 'Weekly schedules', icon: calendarOutline, to: { path: '/teacher', query: { section: 'schedules' } }, section: 'schedules' },
      { label: 'Evidence', icon: shieldCheckmarkOutline, to: { path: '/teacher', query: { section: 'evidence' } }, section: 'evidence' },
    ]
  }

  if (profile.value?.role === 'parent') {
    return [
      { label: 'Overview', icon: homeOutline, to: { path: '/parent', query: { section: 'overview' } }, section: 'overview' },
      { label: 'Attendance history', icon: calendarOutline, to: { path: '/parent', query: { section: 'history' } }, section: 'history' },
    ]
  }

  if (profile.value?.role === 'admin') {
    return [
      { label: 'Overview', icon: homeOutline, to: { path: '/admin', query: { section: 'overview' } }, section: 'overview' },
      { label: 'Teacher approvals', icon: peopleOutline, to: { path: '/admin', query: { section: 'teachers' } }, section: 'teachers' },
    ]
  }

  return [
    { label: 'Overview', icon: homeOutline, to: { path: '/student', query: { section: 'overview' } }, section: 'overview' },
    { label: 'My courses', icon: schoolOutline, to: { path: '/student', query: { section: 'courses' } }, section: 'courses' },
    { label: 'Tasks', icon: checkboxOutline, to: '/student/tasks' },
    { label: 'Schedule', icon: calendarOutline, to: { path: '/student', query: { section: 'schedule' } }, section: 'schedule' },
  ]
})

function isActive(item: NavigationItem) {
  const path = typeof item.to === 'string' ? item.to : item.to.path
  if (route.path !== path) return false
  if (!item.section) return true
  return (route.query.section ?? 'overview') === item.section
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'MU'
}

function roleLabel(role: AppRole) {
  return {
    admin: 'Administrator',
    teacher: 'Teacher',
    student: 'Student',
    parent: 'Parent / guardian',
  }[role]
}

async function logout() {
  signingOut.value = true
  try {
    await signOut()
    await router.replace('/login')
  } finally {
    signingOut.value = false
  }
}
</script>

<style scoped>
.portal-menu {
  --background: var(--campus-surface);
  --max-width: 286px;
  --min-width: 272px;
  --width: 286px;
}

.portal-menu::part(container) {
  border-right: 1px solid var(--campus-border);
  box-shadow: 12px 0 34px rgba(6, 63, 42, 0.09);
}

.menu-shell {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  padding: max(20px, env(safe-area-inset-top)) 15px max(16px, env(safe-area-inset-bottom));
}

.menu-brand,
.menu-profile {
  display: flex;
  align-items: center;
  gap: 11px;
}

.menu-brand {
  padding: 0 8px 20px;
}

.menu-brand img {
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  border-radius: 50%;
  object-fit: contain;
}

.menu-brand strong,
.menu-brand small,
.menu-profile strong,
.menu-profile small {
  display: block;
}

.menu-brand strong {
  color: var(--campus-text);
  font-size: 0.92rem;
  letter-spacing: -0.015em;
}

.menu-brand small,
.menu-profile small {
  margin-top: 2px;
  color: var(--campus-muted);
  font-size: 0.68rem;
}

.menu-profile {
  margin-bottom: 22px;
  padding: 12px;
  border: 1px solid var(--campus-border);
  border-radius: 15px;
  background: var(--campus-surface-soft);
}

.profile-avatar {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 12px;
  background: var(--campus-green-soft);
  color: var(--campus-green);
  font-size: 0.72rem;
  font-weight: 800;
}

.menu-profile strong {
  overflow: hidden;
  max-width: 175px;
  color: var(--campus-text);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-label {
  margin: 0 12px 8px;
  color: var(--campus-muted);
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

ion-list {
  padding: 0;
  background: transparent;
}

ion-item {
  --background: transparent;
  --border-radius: 12px;
  --color: var(--campus-muted);
  --min-height: 46px;
  --padding-start: 12px;
  --padding-end: 9px;
  margin: 3px 0;
  font-size: 0.8rem;
  font-weight: 650;
}

ion-item ion-icon {
  margin-right: 12px;
  color: currentColor;
  font-size: 1.05rem;
}

ion-item.is-active {
  --background: var(--campus-green-soft);
  --color: var(--campus-green);
}

.menu-footer {
  margin-top: auto;
  padding-top: 18px;
  border-top: 1px solid var(--campus-border);
}

.menu-footer p {
  margin: 15px 10px 0;
  color: var(--campus-muted);
  font-size: 0.62rem;
  line-height: 1.5;
}
</style>
