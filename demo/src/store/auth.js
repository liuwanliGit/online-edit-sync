import { reactive, watch } from 'vue'

// 当前登录会话：{ name, role, mode }，持久化到 localStorage。
// role: 'editor'（可编辑）| 'viewer'（只读）
// mode: 'standalone'（单机，localStorage）| 'collab'（协同，走后端 + 协同服务）
const STORAGE_KEY = 'umo-demo:auth'

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const auth = reactive({
  user: load(),
})

// 任意变更都写回 localStorage
watch(
  () => auth.user,
  (val) => {
    if (val) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  },
  { deep: true },
)

export function login(name, role, mode = 'standalone') {
  auth.user = { name: name.trim(), role, mode }
}

export function logout() {
  auth.user = null
}

export function isViewer() {
  return auth.user?.role === 'viewer'
}

export function isCollab() {
  return auth.user?.mode === 'collab'
}

export function isLoggedIn() {
  return !!auth.user
}
