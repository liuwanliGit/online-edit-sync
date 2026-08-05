import { v4 as uuidv4 } from 'uuid'
import { ref } from 'vue'

import { fetchDocuments, createDocument, deleteDocument } from '@/utils/api'

// 文档存储（双模式）：
// - standalone：localStorage，文档含 content（HTML）
// - collab：走 demo 后端 REST，只存元数据（内容由编辑器通过 Yjs 协同拉取，不在此处缓存）
//
// 文档对象统一形状（前端用）：
// { id, title, content(仅 standalone), createdAt, updatedAt, createdBy }

const STORAGE_KEY = 'umo-demo:documents'
const STARTER_CONTENT =
  '<h1>欢迎使用 Umo Editor</h1><p>这是一个基于 <strong>@umoteam/editor</strong> 的文档编辑 demo。从左侧工具栏开始你的创作吧。</p>'

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

// 单机模式：内部数组作为单一数据源
const localDocs = ref(loadLocal())

function persistLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(localDocs.value))
}

// ============ 通用：按 mode 分流 ============

/**
 * 列表
 * @param {'standalone'|'collab'} mode
 * @returns standalone: 同步数组；collab: Promise<数组>
 */
export function list(mode = 'standalone') {
  if (mode === 'collab') {
    return fetchDocuments().then((docs) =>
      // 协同列表按更新时间倒序（后端已排，这里再保险一次）
      [...docs].sort((a, b) => b.updatedAt - a.updatedAt),
    )
  }
  return [...localDocs.value].sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 获取单个文档
 * @param {'standalone'|'collab'} mode
 * @param {string} id
 * @returns standalone: 同步对象|null；collab: Promise<对象|null>（仅元数据，无 content）
 */
export function get(mode, id) {
  if (mode === 'collab') {
    return fetchDocuments().then((docs) => docs.find((d) => d.id === id) || null)
  }
  return localDocs.value.find((d) => d.id === id) || null
}

/**
 * 新建文档
 * @returns standalone: 同步 id；collab: Promise<id>
 */
export function create(mode, title, createdBy) {
  if (mode === 'collab') {
    return createDocument({ title, createdBy }).then((d) => d.id)
  }
  const now = Date.now()
  const doc = {
    id: uuidv4(),
    title: title?.trim() || '无标题文档',
    content: STARTER_CONTENT,
    createdAt: now,
    updatedAt: now,
    createdBy,
  }
  localDocs.value.unshift(doc)
  persistLocal()
  return doc.id
}

/**
 * 删除文档
 * @returns standalone: 同步 boolean；collab: Promise<boolean>
 */
export function remove(mode, id) {
  if (mode === 'collab') {
    return deleteDocument(id)
  }
  const idx = localDocs.value.findIndex((d) => d.id === id)
  if (idx === -1) return false
  localDocs.value.splice(idx, 1)
  persistLocal()
  return true
}

/**
 * 更新文档（仅 standalone 用得到；协同模式内容由 Yjs 驱动、标题创建时定死）
 */
export function update(id, patch) {
  const doc = localDocs.value.find((d) => d.id === id)
  if (!doc) return false
  Object.assign(doc, patch, { updatedAt: Date.now() })
  persistLocal()
  return true
}

// ============ 工具函数（两种模式共用） ============

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
