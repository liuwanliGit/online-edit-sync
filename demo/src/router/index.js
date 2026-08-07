import { createRouter, createWebHistory } from 'vue-router'

import { isLoggedIn } from '@/store/auth'

const routes = [
  {
    path: '/',
    redirect: () => (isLoggedIn() ? '/documents' : '/login'),
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    // 已登录用户访问登录页 → 直接进工作台
    beforeEnter: () => (isLoggedIn() ? { name: 'documents' } : true),
  },
  {
    path: '/documents',
    name: 'documents',
    component: () => import('@/views/DocumentsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/documents/:id',
    name: 'editor',
    component: () => import('@/views/EditorView.vue'),
    meta: { requiresAuth: true },
    props: true,
  },
  {
    path: '/docs',
    name: 'docs',
    component: () => import('@/views/DocsView.vue'),
    // 公开访问，不设 requiresAuth（与 /login 一致）
  },
  // 兜底
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

// 全局守卫：未登录访问受保护页 → 跳登录
router.beforeEach((to) => {
  if (to.meta.requiresAuth && !isLoggedIn()) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
