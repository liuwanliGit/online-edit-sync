/**
 * 引擎地址解析（瘦客户端指向 Umo Editor 引擎镜像）
 * -----------------------------------------------------------
 * 地址优先级（高 → 低）：
 *   1. window.__UMO_CONFIG__.engineUrl  —— 来自 /config.js（部署后可编辑，推荐）
 *   2. window.__UMO_ENGINE_URL__        —— 旧的全局变量覆盖（兼容）
 *   3. 兜底 http://localhost:9999/oes     —— 本地开发默认值
 *
 * 应用统一挂在 /oes 前缀下，engineUrl 应填带 /oes 前缀的地址：
 *   本地开发：http://localhost:9999/oes
 *   Docker：由 entrypoint 注入（UMO_ENGINE_PUBLIC_URL，默认 http://localhost:9999/oes）
 *   外层 nginx：http://<nginx host>:<port>/oes
 */

const FALLBACK = 'http://localhost:9999/oes'

function normalize(raw) {
  if (!raw) return FALLBACK
  const s = String(raw).trim().replace(/\/+$/, '')
  return s || FALLBACK
}

const w = typeof window !== 'undefined' ? window : undefined
const resolved = normalize(
  w?.__UMO_CONFIG__?.engineUrl || w?.__UMO_ENGINE_URL__,
)

/** 引擎根地址（拼 iframe src、convert 接口等用） */
export function getEngineUrl() {
  return resolved
}

/**
 * 构造 /embed iframe URL
 * @param {string} doc    文档 id（业务系统文档主键）
 * @param {string} token  业务后端签发的 JWT
 * @param {string} mode   'edit' | 'view'
 * @param {string} lang   'zh-CN' | 'en-US'
 * @param {string} title  文档标题（显示在编辑器内标题位，可选）
 */
export function getEmbedUrl(doc, token, mode = 'edit', lang = 'zh-CN', title = '') {
  const params = new URLSearchParams({ doc, token, mode, lang })
  if (title) params.set('title', title)
  return `${resolved}/embed?${params.toString()}`
}
