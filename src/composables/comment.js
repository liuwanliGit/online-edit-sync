/**
 * 评论状态管理（引擎内置版：REST + SSE + Tiptap Mark 锚定）
 * -----------------------------------------------------------
 * - comments/activeCommentId 状态
 * - CRUD 走引擎同源 REST（apiBase 默认空串 = 同源根路径）
 * - 实时同步走 SSE（EventSource）
 * - 评论位置由 Tiptap comment mark 锚定（data-comment-id = 评论 id），
 *   不再使用 {from, to} 位置 + 范围迁移。文字增删时 mark 自动跟随，
 *   协同编辑通过 Yjs 自动同步 mark，刷新后随 Yjs 文档恢复。
 *
 * author 从 options.user 取（引擎内置配置）。
 * docId 从 options.document.docId 取。
 * 无鉴权（同源信任——collab-server 不对外暴露，评论 API 经 nginx 同源反代）。
 */
import { ref } from 'vue'

import { getCommentApiBase } from '@/utils/base-path'

export function useComments({ options }) {
  const comments = ref([])
  const activeCommentId = ref(null)
  let sse = null

  // 评论功能是否启用
  const enabled = ref(
    options.value.comments?.enabled !== false &&
      !options.value.disableExtensions?.includes('comment'),
  )

  function apiUrl(p) {
    const base = getCommentApiBase(options.value.comments?.apiBase)
    return `${base}/api${p}`
  }

  function getDocId() {
    return options.value.document?.docId || ''
  }

  function getAuthor() {
    const user = options.value.user || {}
    return {
      id: user.id || user.name || 'anon',
      name: user.name || '匿名',
      color: user.color || '',
    }
  }

  // ============ 加载 + SSE ============
  async function loadComments() {
    const docId = getDocId()
    if (!docId) return
    try {
      const res = await fetch(
        apiUrl(`/documents/${encodeURIComponent(docId)}/comments`),
      )
      const data = await res.json().catch(() => ({}))
      comments.value = data.comments || []
    } catch (e) {
      console.warn('[comments] 加载失败', e?.message || e)
    }
  }

  function connectSSE() {
    const docId = getDocId()
    if (!docId) return
    if (sse) sse.close()
    const url = apiUrl(
      `/documents/${encodeURIComponent(docId)}/comments/stream`,
    )
    sse = new EventSource(url)
    sse.onmessage = (ev) => {
      let event
      try {
        event = JSON.parse(ev.data)
      } catch {
        return
      }
      applySSEEvent(event)
    }
    sse.onerror = () => {
      // EventSource 会自动重连，这里只记日志
      console.warn('[comments] SSE 连接错误，浏览器将自动重连')
    }
  }

  function applySSEEvent({ type, payload }) {
    if (!payload) return
    const list = comments.value
    // 批量删除（payload.all === true 表示清空整个文档的评论）
    if (type === 'comment:deleted' && payload.all) {
      comments.value = []
      activeCommentId.value = null
      return
    }
    if (type === 'comment:added') {
      if (!list.find((c) => c.id === payload.id))
        comments.value = [...list, payload]
    } else if (type === 'comment:updated' || type === 'comment:replied') {
      comments.value = list.map((c) => (c.id === payload.id ? payload : c))
    } else if (type === 'comment:deleted') {
      comments.value = list.filter((c) => c.id !== payload.id)
      if (activeCommentId.value === payload.id) activeCommentId.value = null
    }
  }

  // ============ CRUD ============
  // anchor（commenter 用）：{ fromRel: number[], toRel: number[] } Yjs RelativePosition 编码
  //   传入则服务端代写 comment mark（commenter 协同连接为 readOnly，无法自己写 mark）
  async function addComment({ id, selectedText, content, anchor }) {
    const docId = getDocId()
    const author = getAuthor()
    const body = { id, selectedText, content, author }
    if (anchor) body.anchor = anchor
    const res = await fetch(
      apiUrl(`/documents/${encodeURIComponent(docId)}/comments`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // id 由客户端生成（用于 mark commentId），后端直接用作主键
        body: JSON.stringify(body),
      },
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '添加评论失败')
    // 本地立即插入（SSE 也会推；按 id 去重）
    if (!comments.value.find((c) => c.id === data.id))
      comments.value = [...comments.value, data]
    return data
  }

  // serverWrite（commenter 用）：true 时服务端代写 mark 的属性变更
  async function updateComment(id, patch, serverWrite = false) {
    const body = { ...patch }
    if (serverWrite) body.serverWrite = true
    const res = await fetch(apiUrl(`/comments/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '更新评论失败')
    comments.value = comments.value.map((c) => (c.id === id ? data : c))
    return data
  }

  async function replyComment(id, content) {
    const author = getAuthor()
    const res = await fetch(
      apiUrl(`/comments/${encodeURIComponent(id)}/replies`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, author }),
      },
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '回复失败')
    comments.value = comments.value.map((c) => (c.id === id ? data : c))
    return data
  }

  // serverWrite（commenter 用）：true 时服务端代删 mark
  async function deleteComment(id, serverWrite = false) {
    const res = await fetch(apiUrl(`/comments/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: serverWrite ? { 'Content-Type': 'application/json' } : undefined,
      body: serverWrite ? JSON.stringify({ serverWrite: true }) : undefined,
    })
    if (!res.ok) throw new Error('删除失败')
    comments.value = comments.value.filter((c) => c.id !== id)
    if (activeCommentId.value === id) activeCommentId.value = null
  }

  function resolveComment(id, resolved, serverWrite = false) {
    return updateComment(id, { resolved }, serverWrite)
  }

  function setActive(id) {
    activeCommentId.value = id
  }
  function clearActive() {
    activeCommentId.value = null
  }

  function dispose() {
    if (sse) {
      sse.close()
      sse = null
    }
  }

  return {
    enabled,
    comments,
    activeCommentId,
    loadComments,
    connectSSE,
    addComment,
    updateComment,
    replyComment,
    deleteComment,
    resolveComment,
    setActive,
    clearActive,
    dispose,
  }
}
