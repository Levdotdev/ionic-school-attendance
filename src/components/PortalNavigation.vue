<template>
  <div class="navigation-shell" :class="{ 'is-collapsed': collapsed }">
    <router-link :to="`/${profile?.role ?? 'student'}`" class="menu-brand" @click="closeMobile">
      <img src="/minsu-logo.png" alt="Mindoro State University" />
      <span><strong>MinSU Attendance</strong><small>{{ roleName }} portal</small></span>
    </router-link>
    <nav aria-label="Portal navigation">
      <p class="menu-label">Workspace</p>
      <router-link v-for="item in navigation" :key="item.label" :to="item.to" class="nav-link" :class="{ active: isActive(item) }" :aria-current="isActive(item) ? 'page' : undefined" :title="collapsed ? item.label : undefined" @click="closeMobile">
        <ion-icon :icon="item.icon" aria-hidden="true" /><span>{{ item.label }}</span>
      </router-link>
    </nav>
    <footer><span>Mindoro State University</span><small>Attendance & student work</small></footer>
  </div>
</template>

<script setup lang="ts">
import { IonIcon, menuController } from '@ionic/vue'
import { calendarOutline, checkboxOutline, checkmarkDoneOutline, homeOutline, peopleOutline, schoolOutline, shieldCheckmarkOutline } from 'ionicons/icons'
import { computed } from 'vue'
import { useRoute, type RouteLocationRaw } from 'vue-router'
import { useSession } from '@/composables/useSession'
defineProps<{ collapsed?: boolean }>()
interface NavigationItem { label: string; icon: string; to: RouteLocationRaw; section?: string }
const route = useRoute()
const { profile } = useSession()
const roleName = computed(() => ({ admin: 'Administrator', teacher: 'Teacher', parent: 'Parent', student: 'Student' })[profile.value?.role ?? 'student'])
function entry(role: string, section: string, label: string, icon: string): NavigationItem { return { label, icon, to: { path: `/${role}`, query: { section } }, section } }
const navigation = computed<NavigationItem[]>(() => {
  const role = profile.value?.role ?? 'student'
  const common = [entry(role, 'overview', 'Overview', homeOutline)]
  if (role === 'teacher') return [...common, entry(role, 'classes', 'Classes', schoolOutline), entry(role, 'attendance', 'Attendance', checkmarkDoneOutline), entry(role, 'schedules', 'Class calendar', calendarOutline)]
  if (role === 'parent') return [...common, entry(role, 'history', 'Attendance history', checkmarkDoneOutline), entry(role, 'schedule', 'Weekly schedule', calendarOutline)]
  if (role === 'admin') return [...common, entry(role, 'teachers', 'Teacher approvals', peopleOutline), entry(role, 'verification', 'Face verification', shieldCheckmarkOutline), entry(role, 'parents', 'Parent connections', peopleOutline)]
  return [...common, entry(role, 'courses', 'My courses', schoolOutline), { label: 'Tasks', icon: checkboxOutline, to: '/student/tasks' }, entry(role, 'schedule', 'My calendar', calendarOutline), entry(role, 'history', 'Attendance history', checkmarkDoneOutline)]
})
function isActive(item: NavigationItem) {
  const path = typeof item.to === 'string' ? item.to : item.to.path
  return route.path === path && (!item.section || (route.query.section ?? 'overview') === item.section)
}
function closeMobile() { void menuController.close('portal-menu') }
</script>

<style scoped>
.navigation-shell { display: flex; flex: 1; flex-direction: column; min-height: 100%; padding: max(24px, env(safe-area-inset-top)) 12px 16px; }
.menu-brand { display: flex; align-items: center; gap: 11px; min-height: 48px; margin: 0 4px 32px; color: var(--campus-text); text-decoration: none; }
.menu-brand img { flex: 0 0 44px; width: 44px; height: 44px; background: white; border-radius: 50%; }
.menu-brand span { min-width: 0; }
.menu-brand strong, .menu-brand small { display: block; white-space: nowrap; }
.menu-brand strong { font-size: 13px; }
.menu-brand small { margin-top: 4px; font-size: 11px; color: var(--campus-muted); }
.menu-label { margin: 0 13px 12px; color: var(--campus-muted); font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
.nav-link { display: flex; align-items: center; gap: 13px; min-height: 46px; margin: 5px 0; padding: 10px 13px; border: 1px solid transparent; border-radius: 10px; color: var(--campus-muted); text-decoration: none; font-size: 13px; font-weight: 600; }
.nav-link:hover { background: var(--campus-surface-soft); color: var(--campus-text); }
.nav-link.active { background: var(--campus-accent-soft); color: var(--campus-accent); border-color: color-mix(in srgb, var(--campus-accent) 18%, transparent); }
.nav-link ion-icon { flex: 0 0 20px; font-size: 20px; }
footer { margin: auto 12px 0; padding-top: 32px; color: var(--campus-muted); font-size: 10px; line-height: 1.8; }
footer span, footer small { display: block; }
.is-collapsed .menu-brand { justify-content: center; margin-left: 0; margin-right: 0; }
.is-collapsed .menu-brand span, .is-collapsed .menu-label, .is-collapsed footer { display: none; }
.is-collapsed .nav-link { justify-content: center; padding: 12px; }
.is-collapsed .nav-link span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
