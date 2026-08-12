/**
 * 瘦客户端后端 REST 客户端
 * -----------------------------------------------------------
 * 指向 demo 自建的文档管理后端（demo/server，默认 http://localhost:4001）。
 * 职责：
 *   1. 文档元数据：列表 / 创建 / 删除 / 单个
 *   2. 代理签 JWT：POST /api/doc-token（业务后端持 UMO_API_KEY 调引擎）
 *
 * 协同编辑（Yjs 实时同步）由引擎 collab-server 负责，前端不直接接触。
 * 导出 Word 走 iframe postMessage 协议（方案 B3），不经此文件。
 *
 * 地址优先级（高 → 低）：
 *   1. window.__UMO_CONFIG__.apiBase  —— 来自 /config.js（部署后可编辑，推荐）
 *      · 显式 URL（如 http://localhost:4001）→ 走该地址
 *      · 空字符串 ''                          → 同源应用前缀 /oes/demo（nginx /oes/demo/api/ 反代场景）
 *   2. window.__UMO_API_URL__         —— 旧的全局变量覆盖（兼容）
 *   3. 兜底 http://localhost:4001      —— 本地开发默认值
 *
 * 说明：demo 应用挂在 /oes/demo 前缀下（与引擎的 /oes/embed 错开）。
 * apiBase 为空时返回 '/oes/demo'，请求拼成 /oes/demo/api/documents，
 * 命中 demo 容器 nginx 的 location /oes/demo/api/。
 */

const FALLBACK = 'http://localhost:4001'
// demo 应用固定前缀（与 vite base、nginx location、routerBase 保持一致）
const APP_PREFIX = '/oes/demo'

export function getApiBase() {
  const w = typeof window !== 'undefined' ? window : undefined
  // 优先读 config.js：__UMO_CONFIG__ 存在表示 config.js 已加载
  if (w?.__UMO_CONFIG__) {
    const apiBase = w.__UMO_CONFIG__.apiBase
    // 显式配置了值 → 用该值（strip 末尾斜杠）
    if (apiBase) return String(apiBase).trim().replace(/\/+$/, '')
    // __UMO_CONFIG__ 存在但 apiBase 为空 → 同源应用前缀（nginx /oes/api/ 反代场景）
    return APP_PREFIX
  }
  // 兼容旧的全局变量
  if (w?.__UMO_API_URL__) {
    return String(w.__UMO_API_URL__).trim().replace(/\/+$/, '')
  }
  return FALLBACK
}

async function request(path, options = {}) {
  const url = `${getApiBase()}${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`)
  }
  return data
}

/** 文档列表（按 updated_at 倒序） */
export async function fetchDocuments() {
  const data = await request('/api/documents')
  return (data.documents || []).map(toCamel)
}

/** 单个文档元数据 */
export async function fetchDocument(id) {
  const d = await request(`/api/documents/${encodeURIComponent(id)}`)
  return toCamel(d)
}

/** 新建文档，返回 { id, title, ... } */
export async function createDocument({ title, createdBy }) {
  const d = await request('/api/documents', {
    method: 'POST',
    body: JSON.stringify({ title, createdBy }),
  })
  return toCamel(d)
}

/** 删除文档 */
export async function deleteDocument(id) {
  await request(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return true
}

/**
 * 代理签 JWT：调 demo 后端 /api/doc-token
 * 业务后端持 UMO_API_KEY 调引擎 /api/token，前端只拿到短时 JWT。
 * @returns {Promise<{token, doc, role, name}>}
 */
export async function fetchDocToken({ doc, name, role }) {
  return request('/api/doc-token', {
    method: 'POST',
    body: JSON.stringify({ doc, name, role }),
  })
}

// snake_case → camelCase
function toCamel(d) {
  return {
    id: d.id,
    title: d.title,
    createdBy: d.created_by,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }
}
