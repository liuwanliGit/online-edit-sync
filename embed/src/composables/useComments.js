/**
 * 评论状态管理（方案 B：REST + SSE + 本地范围迁移）
 * -----------------------------------------------------------
 * - comments/activeCommentId 状态
 * - CRUD 走业务后端 REST（commentApiBase 由父页面 postMessage 下发）
 * - 实时同步走 SSE（EventSource）
 * - 范围迁移：editor.transaction(docChanged) 时用 mapping.map 迁移 {from,to}，
 *   防抖 500ms PATCH 回写后端；塌缩 → status='stale'
 *
 * author 由 getAuthor() 提供（embed 取 collabUser：name/color/role）。
 * viewer 也可评论（后端不限角色）。
 */
import { ref } from 'vue'

export function useComments({ docId, getAuthor, getCommentApiBase }) {
  const comments = ref([])
  const activeCommentId = ref(null)
  let sse = null
  const dirty = new Set()
  let flushTimer = null

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
  async function addComment({ from, to, selectedText, content }) {
    const author = getAuthor()
    const res = await fetch(apiUrl(`/documents/${encodeURIComponent(docId)}/comments`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, selectedText, content, author }),
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

  // ============ 范围迁移（最硬的骨头） ============
  // editor.transaction(docChanged) 时调用：用 ProseMirror mapping.map 迁移每条评论范围
  function migrateRanges(mapping) {
    let changed = false
    const next = comments.value.map((c) => {
      if (c.status === 'stale') return c
      let nf = mapping.map(c.from, 1)
      let nt = mapping.map(c.to, -1)
      if (nf < 0) nf = 0
      if (nt < 0) nt = 0
      if (nf >= nt) {
        // 范围塌缩（文字被删等）→ 失效
        changed = true
        dirty.add(c.id)
        return { ...c, from: nf, to: nf, status: 'stale' }
      }
      if (nf !== c.from || nt !== c.to) {
        changed = true
        dirty.add(c.id)
        return { ...c, from: nf, to: nt }
      }
      return c
    })
    if (changed) {
      comments.value = next
      scheduleFlush()
    }
  }

  // 防抖回写迁移后的范围/状态（避免每次按键都打后端）
  function scheduleFlush() {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      const ids = [...dirty]
      dirty.clear()
      for (const id of ids) {
        const c = comments.value.find((x) => x.id === id)
        if (!c) continue
        patchSilent(id, { from: c.from, to: c.to, status: c.status })
      }
    }, 500)
  }

  // 静默回写范围：不抛错、不刷整条评论（仅校正 from/to/status，避免与本地迁移打架）
  async function patchSilent(id, patch) {
    try {
      const res = await fetch(apiUrl(`/comments/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data) {
        comments.value = comments.value.map((c) =>
          c.id === id ? { ...c, from: data.from, to: data.to, status: data.status } : c,
        )
      }
    } catch {
      // 回写失败不致命，下次迁移再写
    }
  }

  function dispose() {
    if (sse) {
      sse.close()
      sse = null
    }
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    dirty.clear()
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
    migrateRanges,
    dispose,
  }
}
