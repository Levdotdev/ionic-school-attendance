import { createRouter, createWebHistory } from '@ionic/vue-router'
import type { RouteLocationRaw } from 'vue-router'
import type { AppRole } from '@/types/database'
import { supabase } from '@/lib/supabase'
import { readAccountProfile, useSession } from '@/composables/useSession'

const routes = [
  {
    path: '/',
    redirect: '/login',
  },
  {
    path: '/login',
    component: () => import('@/views/LoginPage.vue'),
    meta: { public: true },
  },
  {
    path: '/privacy-policy',
    component: () => import('@/views/PublicPolicyPage.vue'),
    props: { kind: 'privacy' },
    meta: { public: true },
  },
  {
    path: '/data-deletion',
    component: () => import('@/views/PublicPolicyPage.vue'),
    props: { kind: 'deletion' },
    meta: { public: true },
  },
  {
    path: '/auth/callback',
    component: () => import('@/views/AuthCallbackPage.vue'),
    meta: { public: true },
  },
  {
    path: '/account/setup',
    component: () => import('@/views/AccountSetupPage.vue'),
  },
  {
    path: '/account/recover',
    component: () => import('@/views/PasswordRecoveryPage.vue'),
  },
  {
    path: '/student',
    component: () => import('@/views/StudentPage.vue'),
    meta: { roles: ['student'] satisfies AppRole[] },
  },
  {
    path: '/student/check-in/:meetingId',
    component: () => import('@/views/SelfCheckPage.vue'),
    meta: { roles: ['student'] satisfies AppRole[] },
  },
  {
    path: '/student/tasks',
    component: () => import('@/views/StudentTasksPage.vue'),
    meta: { roles: ['student'] satisfies AppRole[] },
  },
  {
    path: '/teacher',
    component: () => import('@/views/TeacherPage.vue'),
    meta: { roles: ['teacher'] satisfies AppRole[] },
  },
  {
    path: '/admin',
    component: () => import('@/views/AdminPage.vue'),
    meta: { roles: ['admin'] satisfies AppRole[] },
  },
  {
    path: '/parent',
    component: () => import('@/views/ParentPage.vue'),
    meta: { roles: ['parent'] satisfies AppRole[] },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

const roleDestination = (role?: AppRole | null): RouteLocationRaw => {
  if (role === 'admin') return '/admin'
  if (role === 'teacher') return '/teacher'
  if (role === 'parent') return '/parent'
  return '/student'
}

router.beforeEach(async (to) => {
  // Let the callback finish exchanging its grant before checking the profile.
  if (to.path === '/auth/callback' || to.path === '/privacy-policy' || to.path === '/data-deletion') return true

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    return to.meta.public ? true : '/login'
  }

  if (to.path === '/account/recover') return true
  const { initializeSession, passwordRecovery } = useSession()
  await initializeSession()
  if (passwordRecovery.value) return '/account/recover'

  const { data: profile, error } = await readAccountProfile(session.user.id)

  if (error || !profile) {
    // Keep a recoverable sign-in screen rather than redirecting to an arbitrary
    // student portal when account loading fails.
    return to.path === '/login' || to.path === '/account/setup' ? true : '/account/setup'
  }

  const role = profile.role as AppRole | undefined
  const destination = roleDestination(role)

  if (!profile.onboarding_completed_at) return to.path === '/account/setup' ? true : '/account/setup'
  if (to.path === '/account/setup') return destination

  if (to.path === '/' || to.path === '/login') return destination

  const allowedRoles = to.meta.roles as AppRole[] | undefined
  if (allowedRoles && (!role || !allowedRoles.includes(role))) return destination

  return true
})

export default router
