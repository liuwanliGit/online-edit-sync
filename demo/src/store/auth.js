import { reactive, watch } from 'vue'

// 当前登录会话：{ name, role }，持久化到 localStorage。
// role: 'editor'（可编辑）| 'commenter'（可评论，不可编辑）| 'viewer'（纯只读）
//
// 瘦客户端说明：编辑器通过 iframe 嵌入引擎 /embed，协同由引擎负责。
// role 决定向业务后端请求 token 时传的角色（editor/commenter/viewer），
// 引擎服务端对 commenter/viewer 强制 readOnly，commenter 的评论 mark 由服务端代写。
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

export function login(name, role) {
  auth.user = { name: name.trim(), role }
}

export function logout() {
  auth.user = null
}

export function isViewer() {
  return auth.user?.role === 'viewer'
}

export function isCommenter() {
  return auth.user?.role === 'commenter'
}

// 当前角色（editor / commenter / viewer），默认 editor
export function currentRole() {
  return auth.user?.role || 'editor'
}

export function isLoggedIn() {
  return !!auth.user
}
