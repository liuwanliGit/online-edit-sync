/**
 * 评论存储层（独立 comments.db，与 collab.db 隔离）
 * -----------------------------------------------------------
 * 职责：
 *   1. 评论 CRUD（按文档聚合）
 *   2. SSE 实时推送的客户端注册表与广播
 *   3. commenter 角色的评论：服务端代写 comment mark 到 Yjs 文档
 *
 * 评论位置由 Tiptap comment mark（data-comment-id）锚定，
 * 不再使用 {from, to} 偏移，文字增删时 mark 随 Yjs 自动同步。
 *
 * 角色与 mark 写入通道：
 *   - editor：前端本地 setMark，经自己的协同连接同步（HTTP 只存评论内容）
 *   - commenter：协同连接为 readOnly，无法自己写 mark。前端提交 Yjs RelativePosition，
 *     由本层用 server.openDirectConnection 代写到 Yjs 文档并广播给所有端。
 *     代写前用 selectedText 校验区间文字，不一致则拒绝（文档已变化）。
 *   - viewer：纯只读，前端不显示评论按钮
 *
 * 鉴权：无（依赖同源信任——collab-server 4000 端口在 Docker 中不对外暴露，
 *       评论 API 经 nginx 同源反代访问）。
 *
 * 挂载方式：由 server.js 调用 createCommentStorage({ server }) 得到 { handle, closeCommentDb }，
 * 在 onRequest 中 `if (await commentStorage.handle(req, res, url)) return`。
 */
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import * as Y from 'yjs'
import {
  resolveRelativePosition,
  readTextRange,
  findCommentRanges,
  setCommentMark,
  removeCommentMark,
} from './yjs-position.js'

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

export function createCommentStorage({ server } = {}) {
  // ============ 限频：单 docId 每分钟最多 N 次代写（防恶意刷 mark）============
  const WRITE_RATE_LIMIT = Number(process.env.COMMENT_WRITE_RATE_LIMIT) || 60
  const writeTimestamps = new Map() // docId -> number[]
  function checkRateLimit(docId) {
    const now = Date.now()
    const arr = (writeTimestamps.get(docId) || []).filter((t) => now - t < 60000)
    if (arr.length >= WRITE_RATE_LIMIT) return false
    arr.push(now)
    writeTimestamps.set(docId, arr)
    return true
  }

  // ============ 服务端代写 comment mark（commenter 评论用）============
  // 在 docId 对应的 Yjs 文档上操作：加/改/删 comment mark，自动广播给所有协同连接
  // fn 签名：(doc, frag) => result | throws；抛错会回滚事务并返回 { ok:false }
  const SERVER_WRITE_ORIGIN = 'server-comment-write'
  async function withDoc(docId, fn) {
    if (!server?.openDirectConnection) return { ok: false, reason: 'no-server' }
    const conn = await server.openDirectConnection(docId, {})
    try {
      let result
      await conn.transact((doc) => {
        const frag = doc.getXmlFragment('default')
        result = fn(doc, frag)
      }, SERVER_WRITE_ORIGIN)
      return result || { ok: true }
    } catch (e) {
      return { ok: false, reason: e?.message || String(e) }
    } finally {
      await conn.disconnect().catch(() => {})
    }
  }

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
        const selectedText = (body.selectedText || '').toString().slice(0, 2000)
        const author = normAuthor(body.author)

        // commenter 提交时带 anchor（Yjs RelativePosition 编码），需服务端代写 comment mark
        // editor 不带 anchor（自己本地 setMark 经协同连接同步），跳过代写
        const anchor = body.anchor // { fromRel: Uint8Array, toRel: Uint8Array }
        if (anchor && anchor.fromRel && anchor.toRel) {
          if (!checkRateLimit(docId)) {
            sendJson(res, 429, { error: '操作过于频繁，请稍后再试' })
            return true
          }
          // 先存评论内容（即使代写失败，评论记录仍保留，前端可提示"位置失效"）
          insertStmt.run({
            id, docId, selectedText, authorJson: JSON.stringify(author),
            content: content.slice(0, 8000), createdAt: Date.now(),
          })
          // 服务端代写：解析相对位置 + selectedText 校验 + format
          const writeResult = await withDoc(docId, (doc, frag) => {
            const fromAbs = resolveRelativePosition(doc, new Uint8Array(anchor.fromRel))
            const toAbs = resolveRelativePosition(doc, new Uint8Array(anchor.toRel))
            if (!fromAbs || !toAbs || fromAbs.xmlText !== toAbs.xmlText) {
              throw new Error('评论位置已失效（跨节点或位置不存在）')
            }
            const length = toAbs.index - fromAbs.index
            if (length <= 0) throw new Error('评论区间无效')
            // selectedText 校验：读当前区间文字，与提交的快照比对
            const currentText = readTextRange(fromAbs.xmlText, fromAbs.index, toAbs.index)
            if (currentText !== selectedText) {
              throw new Error('文档已变化，请重新选中评论')
            }
            setCommentMark(fromAbs.xmlText, fromAbs.index, length, {
              commentId: id, resolved: false,
            })
            return { ok: true }
          })
          if (!writeResult.ok) {
            // 代写失败：删除刚存的评论记录，返回 409 让前端重新选中
            deleteStmt.run(id)
            console.warn(`[comment] 代写 mark 失败 doc=${docId} id=${id}: ${writeResult.reason}`)
            sendJson(res, 409, { error: writeResult.reason || '评论位置代写失败' })
            return true
          }
          const comment = rowToComment(getStmt.get(id))
          sseBroadcast(docId, { type: 'comment:added', payload: comment })
          sendJson(res, 201, comment)
          return true
        }
        // 无 anchor（editor 路径）：仅存评论内容，mark 由 editor 自己同步
        insertStmt.run({
          id, docId, selectedText, authorJson: JSON.stringify(author),
          content: content.slice(0, 8000), createdAt: Date.now(),
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
        const newResolved =
          body.resolved !== undefined ? (body.resolved ? 1 : 0) : row.resolved
        patchStmt.run({
          id,
          content:
            body.content !== undefined
              ? String(body.content).slice(0, 8000)
              : row.content,
          resolved: newResolved,
        })
        // commenter 触发（body.serverWrite=true）：服务端代写 mark 的 resolved 属性
        // editor 触发时由前端自己改 mark，无需代写
        if (body.serverWrite && body.resolved !== undefined) {
          const resolvedBool = !!newResolved
          await withDoc(row.doc_id, (doc, frag) => {
            const ranges = findCommentRanges(frag, id)
            if (!ranges.length) return { ok: true, noMark: true } // mark 已不存在（文字被删等），静默
            for (const r of ranges) {
              setCommentMark(r.xmlText, r.relOffset, r.length, { commentId: id, resolved: resolvedBool })
            }
            return { ok: true }
          })
        }
        const comment = rowToComment(getStmt.get(id))
        sseBroadcast(row.doc_id, { type: 'comment:updated', payload: comment })
        sendJson(res, 200, comment)
        return true
      }
      if (req.method === 'DELETE') {
        const body = await readJsonBody(req).catch(() => ({}))
        deleteStmt.run(id)
        // commenter 触发（body.serverWrite=true）：服务端代删 mark
        if (body.serverWrite) {
          await withDoc(row.doc_id, (doc, frag) => {
            const ranges = findCommentRanges(frag, id)
            for (const r of ranges) {
              removeCommentMark(r.xmlText, r.relOffset, r.length)
            }
            return { ok: true }
          })
        }
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
