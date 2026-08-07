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
 *   2. window.__UMO_API_URL__         —— 旧的全局变量覆盖（兼容）
 *   3. 兜底 http://localhost:4001      —— 本地开发默认值
 */

const FALLBACK = 'http://localhost:4001'

export function getApiBase() {
  const w = typeof window !== 'undefined' ? window : undefined
  // 优先读 config.js
  const fromConfig = w?.__UMO_CONFIG__?.apiBase
  if (fromConfig) {
    return String(fromConfig).trim().replace(/\/+$/, '')
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
