/**
 * Umo Editor demo 后端
 * -----------------------------------------------------------
 * 只负责「文档元数据」管理：列表 / 创建 / 删除。
 * 协同编辑（Yjs 实时同步、内容持久化）由独立的 collab-server 负责，
 * 本服务完全不接触 Yjs 二进制内容。
 *
 * 关联点：本服务创建文档时生成的 uuid，同时作为 collab-server 的
 * Yjs documentName。前端打开协同文档时，用同一个 uuid 既调本服务取元数据、
 * 又连 collab-server 同步内容，两边通过 uuid 关联。
 *
 * 启动：npm install && npm start
 * 端口：4001（避开 collab-server 的 4000）
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import http from 'http'
import { v4 as uuidv4 } from 'uuid'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ============ 配置 ============
const PORT = process.env.PORT || 4001
const DB_PATH = process.env.DB_PATH || join(__dirname, 'data', 'docs.db')

// ============ 数据库 ============
mkdirSync(dirname(DB_PATH), { recursive: true })
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)

const listStmt = db.prepare('SELECT * FROM documents ORDER BY updated_at DESC')
const getStmt = db.prepare('SELECT * FROM documents WHERE id = ?')
const insertStmt = db.prepare(`
  INSERT INTO documents (id, title, created_by, created_at, updated_at)
  VALUES (@id, @title, @createdBy, @createdAt, @updatedAt)
`)
const deleteStmt = db.prepare('DELETE FROM documents WHERE id = ?')

// ============ HTTP 工具 ============
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function sendJson(res, status, data) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(data))
}

// 读 request body（限 64KB，元数据接口用不到那么大）
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch (e) {
        reject(new Error('JSON 解析失败'))
      }
    })
    req.on('error', reject)
  })
}

// ============ 路由 ============
const server = http.createServer(async (req, res) => {
  // 处理预检
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {})
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const { pathname } = url

  try {
    // GET /api/documents —— 文档列表
    if (pathname === '/api/documents' && req.method === 'GET') {
      const rows = listStmt.all()
      sendJson(res, 200, { documents: rows })
      return
    }

    // POST /api/documents { title, createdBy } —— 新建文档
    if (pathname === '/api/documents' && req.method === 'POST') {
      const body = await readBody(req)
      const title = (body.title || '').toString().trim() || '无标题文档'
      const createdBy = (body.createdBy || '匿名').toString().trim()
      const now = Date.now()
      const id = uuidv4()
      // better-sqlite3 命名参数用 @xxx，键名与占位符一致（驼峰）
      insertStmt.run({
        id,
        title,
        createdBy,
        createdAt: now,
        updatedAt: now,
      })
      const doc = {
        id,
        title,
        created_by: createdBy,
        created_at: now,
        updated_at: now,
      }
      console.log(`[create] 文档 "${title}" (${id}) by ${createdBy}`)
      sendJson(res, 201, doc)
      return
    }

    // DELETE /api/documents/:id —— 删除文档（仅删元数据；Yjs blob 由 collab-server 管）
    const delMatch = pathname.match(/^\/api\/documents\/([^/]+)$/)
    if (delMatch && req.method === 'DELETE') {
      const id = delMatch[1]
      const info = deleteStmt.run(id)
      if (info.changes === 0) {
        sendJson(res, 404, { error: '文档不存在' })
        return
      }
      console.log(`[delete] 文档 ${id} 已删除`)
      sendJson(res, 200, { ok: true })
      return
    }

    // GET /api/documents/:id —— 单个文档元数据（可选，前端列表里已能取到，留作扩展）
    const getMatch = pathname.match(/^\/api\/documents\/([^/]+)$/)
    if (getMatch && req.method === 'GET') {
      const row = getStmt.get(getMatch[1])
      if (!row) {
        sendJson(res, 404, { error: '文档不存在' })
        return
      }
      sendJson(res, 200, row)
      return
    }

    // 健康检查
    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, service: 'umo-editor-demo-server' })
      return
    }

    sendJson(res, 404, { error: '未找到路由' })
  } catch (e) {
    console.error('[error]', e.message)
    sendJson(res, 500, { error: e.message || '服务器错误' })
  }
})

server.listen(PORT, () => {
  console.log(`\n✅ demo 后端已启动: http://localhost:${PORT}`)
  console.log(`   接口: GET/POST /api/documents, DELETE /api/documents/:id`)
  console.log(`   存储: ${DB_PATH} (SQLite, WAL)\n`)
})

// 优雅停机
const shutdown = (signal) => {
  console.log(`\n收到 ${signal}，正在关闭...`)
  server.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
