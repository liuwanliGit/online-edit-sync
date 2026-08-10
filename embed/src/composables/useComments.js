/**
 * 评论状态管理（方案 B：REST + SSE + Tiptap Mark 锚定）
 * -----------------------------------------------------------
 * - comments/activeCommentId 状态
 * - CRUD 走业务后端 REST（commentApiBase 由父页面 postMessage 下发）
 * - 实时同步走 SSE（EventSource）
 * - 评论位置由 Tiptap comment mark 锚定（data-comment-id = 评论 id），
 *   不再使用 {from, to} 位置 + 范围迁移。文字增删时 mark 自动跟随，
 *   协同编辑通过 Yjs 自动同步 mark，刷新后随 Yjs 文档恢复。
 *
 * author 由 getAuthor() 提供（embed 取 collabUser：name/color/role）。
 * viewer 也可评论（后端不限角色）。
 *
 * 挂载方式：由 index.js 调用 createCommentStore(db) 得到 { handle }，
 * 在路由里 `if (await commentStore.handle(req, res, url)) return`。
 */
import { ref } from 'vue'

export function useComments({ docId, getAuthor, getCommentApiBase }) {
  const comments = ref([])
  const activeCommentId = ref(null)
  let sse = null

  function apiUrl(p) {
    const base = (getCommentApiBase() || '').replace(/\/+$/, '')
    return `${base}/api${p}`
  }

  // ============ 加载 + SSE ============
  async function loadComments() {
    try {
      const res = await fetch(apiUrl(`/documents/${encodeURIComponent(docId)}/comments`))
      const data = await res.json().catch(() => ({}))
      comments.value = data.comments || []
    } catch (e) {
      console.warn('[comments] 加载失败', e?.message || e)
    }
  }

  function connectSSE() {
    if (sse) sse.close()
    const url = apiUrl(`/documents/${encodeURIComponent(docId)}/comments/stream`)
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
    const list = comments.value
    if (!payload) return
    if (type === 'comment:added') {
      if (!list.find((c) => c.id === payload.id)) comments.value = [...list, payload]
    } else if (type === 'comment:updated' || type === 'comment:replied') {
      comments.value = list.map((c) => (c.id === payload.id ? payload : c))
    } else if (type === 'comment:deleted') {
      comments.value = list.filter((c) => c.id !== payload.id)
      if (activeCommentId.value === payload.id) activeCommentId.value = null
    }
  }

  // ============ CRUD ============
  async function addComment({ id, selectedText, content }) {
    const author = getAuthor()
    const res = await fetch(apiUrl(`/documents/${encodeURIComponent(docId)}/comments`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // id 由客户端生成（用于 mark commentId），后端直接用作主键
      body: JSON.stringify({ id, selectedText, content, author }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '添加评论失败')
    // 本地立即插入（SSE 也会推；按 id 去重）
    if (!comments.value.find((c) => c.id === data.id)) comments.value = [...comments.value, data]
    return data
  }

  async function updateComment(id, patch) {
    const res = await fetch(apiUrl(`/comments/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '更新评论失败')
    comments.value = comments.value.map((c) => (c.id === id ? data : c))
    return data
  }

  async function replyComment(id, content) {
    const author = getAuthor()
    const res = await fetch(apiUrl(`/comments/${encodeURIComponent(id)}/replies`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, author }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '回复失败')
    comments.value = comments.value.map((c) => (c.id === id ? data : c))
    return data
  }

  async function deleteComment(id) {
    const res = await fetch(apiUrl(`/comments/${encodeURIComponent(id)}`), { method: 'DELETE' })
    if (!res.ok) throw new Error('删除失败')
    comments.value = comments.value.filter((c) => c.id !== id)
    if (activeCommentId.value === id) activeCommentId.value = null
  }

  function resolveComment(id, resolved) {
    return updateComment(id, { resolved })
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
