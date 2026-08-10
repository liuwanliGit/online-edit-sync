/**
 * 评论功能后端（方案 B：REST + SSE + SQLite）
 * -----------------------------------------------------------
 * 职责：
 *   1. 评论 CRUD（按文档聚合）
 *   2. SSE 实时推送：GET /api/documents/:docId/comments/stream
 *      任何评论变更后广播给该文档的所有订阅连接
 *
 * 鉴权：demo 无 session，author 由前端在 body 里传（演示用，生产应由后端鉴权确定）。
 * viewer 也可评论（后端不限角色）。
 *
 * 挂载方式：由 index.js 调用 createCommentStore(db) 得到 { handle }，
 * 在路由里 `if (await commentStore.handle(req, res, url)) return`。
 */
import { v4 as uuidv4 } from 'uuid'

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
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

export function createCommentStore(db) {
  // ============ 表 ============
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id            TEXT PRIMARY KEY,
      doc_id        TEXT NOT NULL,
      from_pos      INTEGER NOT NULL,
      to_pos        INTEGER NOT NULL,
      selected_text TEXT,
      author_json   TEXT,
      content       TEXT,
      created_at    INTEGER NOT NULL,
      resolved      INTEGER NOT NULL DEFAULT 0,
      replies_json  TEXT NOT NULL DEFAULT '[]',
      status        TEXT NOT NULL DEFAULT 'active'
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_doc ON comments(doc_id)`)

  const listStmt = db.prepare('SELECT * FROM comments WHERE doc_id = ? ORDER BY created_at ASC')
  const getStmt = db.prepare('SELECT * FROM comments WHERE id = ?')
  const insertStmt = db.prepare(`
    INSERT INTO comments (id, doc_id, from_pos, to_pos, selected_text, author_json, content, created_at, resolved, replies_json, status)
    VALUES (@id, @docId, @from, @to, @selectedText, @authorJson, @content, @createdAt, 0, '[]', 'active')
  `)
  const patchStmt = db.prepare(`
    UPDATE comments
    SET content = @content, resolved = @resolved, from_pos = @from, to_pos = @to, status = @status
    WHERE id = @id
  `)
  const replyStmt = db.prepare('UPDATE comments SET replies_json = @repliesJson WHERE id = @id')
  const deleteStmt = db.prepare('DELETE FROM comments WHERE id = ?')

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
  setInterval(() => {
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
      from: row.from_pos,
      to: row.to_pos,
      selectedText: row.selected_text || '',
      author: JSON.parse(row.author_json || '{}'),
      content: row.content,
      createdAt: row.created_at,
      resolved: !!row.resolved,
      replies: JSON.parse(row.replies_json || '[]'),
      status: row.status || 'active',
    }
  }

  function normAuthor(a) {
    return a && typeof a === 'object' ? { id: a.id || a.name || 'anon', name: a.name || '匿名', color: a.color || '' } : { id: 'anon', name: '匿名', color: '' }
  }

  // ============ 路由处理：返回 true 表示已处理 ============
  async function handle(req, res, url) {
    const { pathname } = url

    // SSE 订阅：GET /api/documents/:docId/comments/stream
    const streamMatch = pathname.match(/^\/api\/documents\/([^/]+)\/comments\/stream$/)
    if (streamMatch && req.method === 'GET') {
      const docId = streamMatch[1]
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

    // 列表 / 新建：/api/documents/:docId/comments
    const listMatch = pathname.match(/^\/api\/documents\/([^/]+)\/comments$/)
    if (listMatch) {
      const docId = listMatch[1]
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
        const from = Number.isFinite(body.from) ? Number(body.from) : 0
        const to = Number.isFinite(body.to) ? Number(body.to) : from
        const id = uuidv4()
        const now = Date.now()
        const author = normAuthor(body.author)
        insertStmt.run({
          id,
          docId,
          from,
          to,
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
    }

    // 回复：POST /api/comments/:id/replies
    const replyMatch = pathname.match(/^\/api\/comments\/([^/]+)\/replies$/)
    if (replyMatch && req.method === 'POST') {
      const row = getStmt.get(replyMatch[1])
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
      replies.push({ id: uuidv4(), author: normAuthor(body.author), content: content.slice(0, 8000), createdAt: Date.now() })
      replyStmt.run({ id: row.id, repliesJson: JSON.stringify(replies) })
      const comment = rowToComment(getStmt.get(row.id))
      sseBroadcast(row.doc_id, { type: 'comment:replied', payload: comment })
      sendJson(res, 201, comment)
      return true
    }

    // 单条：PATCH/DELETE /api/comments/:id
    const itemMatch = pathname.match(/^\/api\/comments\/([^/]+)$/)
    if (itemMatch) {
      const id = itemMatch[1]
      const row = getStmt.get(id)
      if (!row) {
        sendJson(res, 404, { error: '评论不存在' })
        return true
      }
      if (req.method === 'PATCH') {
        const body = await readJsonBody(req)
        patchStmt.run({
          id,
          content: body.content !== undefined ? String(body.content).slice(0, 8000) : row.content,
          resolved: body.resolved !== undefined ? (body.resolved ? 1 : 0) : row.resolved,
          from: Number.isFinite(body.from) ? Number(body.from) : row.from_pos,
          to: Number.isFinite(body.to) ? Number(body.to) : row.to_pos,
          status: body.status !== undefined ? String(body.status) : row.status,
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

  return { handle }
}
