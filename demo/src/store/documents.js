import { fetchDocuments, fetchDocument, createDocument, deleteDocument } from '@/utils/api'

// 文档存储（瘦客户端：全部走业务后端 REST）
// 文档对象统一形状：{ id, title, createdAt, updatedAt, createdBy }
// 内容（HTML）不在元数据里——由引擎 collab-server 通过 Yjs 协同管理，
// 业务前端只在用户打开编辑器时通过 iframe 嵌入 /embed 编辑。

/**
 * 列表（按 updated_at 倒序）
 * @returns {Promise<Array>}
 */
export function list() {
  return fetchDocuments().then((docs) =>
    [...docs].sort((a, b) => b.updatedAt - a.updatedAt),
  )
}

/**
 * 获取单个文档元数据
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export function get(id) {
  return fetchDocument(id).catch(() => null)
}

/**
 * 新建文档
 * @returns {Promise<string>} id
 */
export function create(title, createdBy) {
  return createDocument({ title, createdBy }).then((d) => d.id)
}

/**
 * 删除文档
 * @returns {Promise<boolean>}
 */
export function remove(id) {
  return deleteDocument(id)
}

// ============ 工具函数 ============

/** 纯文本摘要：剥离 HTML 标签后取前 n 字 */
export function summary(html, n = 60) {
  if (!html) return ''
  const text = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > n ? text.slice(0, n) + '…' : text
}

/** 相对时间：把时间戳渲染成 "刚刚 / 3 分钟前 / 2 小时前 / 昨天 / yyyy-mm-dd" */
export function relativeTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const min = 60 * 1000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 2 * day) return '昨天'
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  const d = new Date(ts)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
