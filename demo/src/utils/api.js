/**
 * demo 后端 REST 客户端
 * -----------------------------------------------------------
 * 指向 demo 自建的文档管理后端（demo/server，默认 http://localhost:4001）。
 * 只管文档元数据：列表 / 创建 / 删除。
 *
 * 地址可通过运行时全局变量覆盖（无需重新构建）：
 *   window.__UMO_API_URL__ = 'https://api.your-domain.com'
 *
 * 协同编辑（Yjs 实时同步）由独立的 collab-server 负责，见 collab-config.js。
 */

const FALLBACK = 'http://localhost:4001'

export function getApiBase() {
  if (typeof window !== 'undefined' && window.__UMO_API_URL__) {
    return String(window.__UMO_API_URL__).trim().replace(/\/+$/, '')
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
  // 后端字段是 snake_case，前端统一转成 camelCase 供组件使用
  return (data.documents || []).map((d) => ({
    id: d.id,
    title: d.title,
    createdBy: d.created_by,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }))
}

/** 新建文档，返回 { id, title, ... } */
export async function createDocument({ title, createdBy }) {
  const d = await request('/api/documents', {
    method: 'POST',
    body: JSON.stringify({ title, createdBy }),
  })
  return {
    id: d.id,
    title: d.title,
    createdBy: d.created_by,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }
}

/** 删除文档 */
export async function deleteDocument(id) {
  await request(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return true
}

/**
 * 导出 Word：把编辑器 HTML 发给 convert-server 转 .docx，返回 Blob。
 * 走 nginx 的 /api/convert/ 反代（同站），与文档管理接口共用 baseURL。
 * 注意：不能用上面的 request()（它按 JSON 解析），这里直接 fetch 取 blob。
 */
export async function exportDocx(html, title) {
  const url = `${getApiBase()}/api/convert/docx`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, title }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `转换失败 (${res.status})`)
  }
  return await res.blob()
}
