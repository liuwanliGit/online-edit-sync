import { createRouter, createWebHistory } from 'vue-router'

import { isLoggedIn } from '@/store/auth'

const routes = [
  {
    path: '/',
    // 用命名路由而非字符串路径：字符串路径（如 '/documents'）会被当作站点绝对路径，
    // 不会自动拼接 createWebHistory 的 base，导致子路径部署（base='/oes'）时丢前缀。
    redirect: () => (isLoggedIn() ? { name: 'documents' } : { name: 'login' }),
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
  // 读取运行时注入的子路径前缀（来自 config.js），默认根路径 '/'。
  // 应用统一挂在 /oes 前缀下，config.js 的 routerBase 固定为 '/oes'，
  // 与 vite base、容器 nginx location 保持一致。
  history: createWebHistory(
    (typeof window !== 'undefined' && window.__UMO_CONFIG__?.routerBase) || '/',
  ),
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
