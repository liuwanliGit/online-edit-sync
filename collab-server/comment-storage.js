/**
 * 评论存储层（独立 comments.db，与 collab.db 隔离）
 * -----------------------------------------------------------
 * 职责：
 *   1. 评论 CRUD（按文档聚合）
 *   2. SSE 实时推送的客户端注册表与广播
 *
 * 评论位置由 Tiptap comment mark（data-comment-id）锚定，
 * 不再使用 {from, to} 偏移，文字增删时 mark 随 Yjs 自动同步。
 *
 * 鉴权：无（依赖同源信任——collab-server 4000 端口在 Docker 中不对外暴露，
 *       评论 API 经 nginx 同源反代访问）。
 * viewer 也可评论（后端不限角色）。
 *
 * 挂载方式：由 server.js 调用 createCommentStorage() 得到 { handle, closeCommentDb }，
 * 在 onRequest 中 `if (await commentStorage.handle(req, res, url)) return`。
 */
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function sendJson(res, status, data) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(data))
}

// 读 JSON body（限 256KB，评论/回复体量小）
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 256 * 1024) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('JSON 解析失败'))
      }
    })
    req.on('error', reject)
  })
}

export function createCommentStorage() {
  // ============ 独立 comments.db ============
  const COMMENT_DB_PATH =
    process.env.COMMENT_DB_PATH || join(__dirname, 'data', 'comments.db')

  mkdirSync(dirname(COMMENT_DB_PATH), { recursive: true })

  const db = new Database(COMMENT_DB_PATH)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id            TEXT PRIMARY KEY,
      doc_id        TEXT NOT NULL,
      selected_text TEXT,
      author_json   TEXT,
      content       TEXT,
      created_at    INTEGER NOT NULL,
      resolved      INTEGER NOT NULL DEFAULT 0,
      replies_json  TEXT NOT NULL DEFAULT '[]'
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_doc ON comments(doc_id)`)

  // 预编译语句（better-sqlite3 是同步 API）
  const listStmt = db.prepare(
    'SELECT * FROM comments WHERE doc_id = ? ORDER BY created_at ASC',
  )
  const getStmt = db.prepare('SELECT * FROM comments WHERE id = ?')
  const insertStmt = db.prepare(`
    INSERT INTO comments (id, doc_id, selected_text, author_json, content, created_at, resolved, replies_json)
    VALUES (@id, @docId, @selectedText, @authorJson, @content, @createdAt, 0, '[]')
  `)
  const patchStmt = db.prepare(`
    UPDATE comments
    SET content = @content, resolved = @resolved
    WHERE id = @id
  `)
  const replyStmt = db.prepare(
    'UPDATE comments SET replies_json = @repliesJson WHERE id = @id',
  )
  const deleteStmt = db.prepare('DELETE FROM comments WHERE id = ?')
  const deleteByDocStmt = db.prepare('DELETE FROM comments WHERE doc_id = ?')

  // ============ SSE 客户端注册表：docId -> Set<res> ============
  const sseClients = new Map()
  function sseBroadcast(docId, event) {
    const set = sseClients.get(docId)
    if (!set || set.size === 0) return
    const data = `data: ${JSON.stringify(event)}\n\n`
    for (const res of set) {
      try {
        res.write(data)
      } catch {
        set.delete(res)
      }
    }
  }
  // 30s 心跳，防止中间代理因空闲超时关闭 SSE 长连接
  const heartbeatTimer = setInterval(() => {
    for (const [, set] of sseClients) {
      for (const res of set) {
        try {
          res.write(': ping\n\n')
        } catch {
          set.delete(res)
        }
      }
    }
  }, 30000).unref()

  function rowToComment(row) {
    if (!row) return null
    return {
      id: row.id,
      docId: row.doc_id,
      selectedText: row.selected_text || '',
      author: JSON.parse(row.author_json || '{}'),
      content: row.content,
      createdAt: row.created_at,
      resolved: !!row.resolved,
      replies: JSON.parse(row.replies_json || '[]'),
    }
  }

  function normAuthor(a) {
    return a && typeof a === 'object'
      ? {
          id: a.id || a.name || 'anon',
          name: a.name || '匿名',
          color: a.color || '',
        }
      : { id: 'anon', name: '匿名', color: '' }
  }

  // ============ 路由处理：返回 true 表示已处理 ============
  async function handle(req, res, url) {
    const { pathname } = url

    // SSE 订阅：GET /api/documents/:docId/comments/stream
    const streamMatch = pathname.match(
      /^\/api\/documents\/([^/]+)\/comments\/stream$/,
    )
    if (streamMatch && req.method === 'GET') {
      const docId = decodeURIComponent(streamMatch[1])
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        // 提示 nginx 等反代不要缓冲（配合 nginx 配置 proxy_buffering off）
        'X-Accel-Buffering': 'no',
      })
      res.write(': connected\n\n')
      if (!sseClients.has(docId)) sseClients.set(docId, new Set())
      sseClients.get(docId).add(res)
      req.on('close', () => {
        sseClients.get(docId)?.delete(res)
      })
      return true
    }

    // 列表 / 新建 / 批量删除：/api/documents/:docId/comments
    const listMatch = pathname.match(/^\/api\/documents\/([^/]+)\/comments$/)
    if (listMatch) {
      const docId = decodeURIComponent(listMatch[1])
      if (req.method === 'OPTIONS') {
        sendJson(res, 204, {})
        return true
      }
      if (req.method === 'GET') {
        const rows = listStmt.all(docId)
        sendJson(res, 200, { comments: rows.map(rowToComment) })
        return true
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req)
        const content = (body.content || '').toString().trim()
        if (!content) {
          sendJson(res, 400, { error: '评论内容不能为空' })
          return true
        }
        // id 由客户端生成（与 comment mark 的 commentId 一致），兜底用 uuid
        const id = (body.id || '').toString().trim() || randomUUID()
        const now = Date.now()
        const author = normAuthor(body.author)
        insertStmt.run({
          id,
          docId,
          selectedText: (body.selectedText || '').toString().slice(0, 2000),
          authorJson: JSON.stringify(author),
          content: content.slice(0, 8000),
          createdAt: now,
        })
        const comment = rowToComment(getStmt.get(id))
        sseBroadcast(docId, { type: 'comment:added', payload: comment })
        sendJson(res, 201, comment)
        return true
      }
      // 批量删除（文档删除时级联清理）
      if (req.method === 'DELETE') {
        deleteByDocStmt.run(docId)
        sseBroadcast(docId, { type: 'comment:deleted', payload: { docId, all: true } })
        sendJson(res, 200, { ok: true })
        return true
      }
    }

    // 回复：POST /api/comments/:id/replies
    const replyMatch = pathname.match(/^\/api\/comments\/([^/]+)\/replies$/)
    if (replyMatch && req.method === 'POST') {
      const id = decodeURIComponent(replyMatch[1])
      const row = getStmt.get(id)
      if (!row) {
        sendJson(res, 404, { error: '评论不存在' })
        return true
      }
      const body = await readJsonBody(req)
      const content = (body.content || '').toString().trim()
      if (!content) {
        sendJson(res, 400, { error: '回复内容不能为空' })
        return true
      }
      const replies = JSON.parse(row.replies_json || '[]')
      replies.push({
        id: randomUUID(),
        author: normAuthor(body.author),
        content: content.slice(0, 8000),
        createdAt: Date.now(),
      })
      replyStmt.run({ id: row.id, repliesJson: JSON.stringify(replies) })
      const comment = rowToComment(getStmt.get(row.id))
      sseBroadcast(row.doc_id, { type: 'comment:replied', payload: comment })
      sendJson(res, 201, comment)
      return true
    }

    // 单条：PATCH/DELETE /api/comments/:id
    const itemMatch = pathname.match(/^\/api\/comments\/([^/]+)$/)
    if (itemMatch) {
      const id = decodeURIComponent(itemMatch[1])
      const row = getStmt.get(id)
      if (!row) {
        sendJson(res, 404, { error: '评论不存在' })
        return true
      }
      if (req.method === 'PATCH') {
        const body = await readJsonBody(req)
        patchStmt.run({
          id,
          content:
            body.content !== undefined
              ? String(body.content).slice(0, 8000)
              : row.content,
          resolved:
            body.resolved !== undefined ? (body.resolved ? 1 : 0) : row.resolved,
        })
        const comment = rowToComment(getStmt.get(id))
        sseBroadcast(row.doc_id, { type: 'comment:updated', payload: comment })
        sendJson(res, 200, comment)
        return true
      }
      if (req.method === 'DELETE') {
        deleteStmt.run(id)
        sseBroadcast(row.doc_id, { type: 'comment:deleted', payload: { id } })
        sendJson(res, 200, { ok: true })
        return true
      }
    }

    return false
  }

  function closeCommentDb() {
    clearInterval(heartbeatTimer)
    // 关闭所有 SSE 连接
    for (const [, set] of sseClients) {
      for (const res of set) {
        try {
          res.end()
        } catch {
          // 忽略
        }
      }
    }
    sseClients.clear()
    db.close()
  }

  return { handle, closeCommentDb }
}
