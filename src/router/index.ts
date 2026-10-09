import { createRouter, createWebHistory } from '@ionic/vue-router'
import type { RouteLocationRaw } from 'vue-router'
import type { AppRole } from '@/types/database'
import { supabase } from '@/lib/supabase'

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
    path: '/auth/callback',
    component: () => import('@/views/AuthCallbackPage.vue'),
    meta: { public: true },
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
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    return to.meta.public ? true : '/login'
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .maybeSingle()

  const role = profile?.role as AppRole | undefined
  const destination = roleDestination(role)

  if (to.path === '/' || to.path === '/login') return destination

  const allowedRoles = to.meta.roles as AppRole[] | undefined
  if (allowedRoles && (!role || !allowedRoles.includes(role))) return destination

  return true
})

export default router
