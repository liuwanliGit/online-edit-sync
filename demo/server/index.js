/**
 * Umo Editor 瘦客户端示例后端
 * -----------------------------------------------------------
 * 职责（演示业务系统如何与引擎对接）：
 *   1. 文档元数据管理：列表 / 创建 / 删除（SQLite）
 *   2. 代理签 JWT：POST /api/doc-token → 持 UMO_API_KEY 调引擎 /api/token
 *   3. 接收导出文件回传（方案 B3）：POST /api/receive-doc → 存盘 + 返回 URL
 *
 * 协同编辑（Yjs 实时同步、内容持久化）由引擎 collab-server 负责，本服务不碰 Yjs 二进制。
 *
 * 启动：npm install && npm start
 * 端口：默认 4001
 *
 * 配置方式（二选一，环境变量优先级更高）：
 *   1. 编辑同目录 config.json（推荐，直观）—— 字段见 config.example.json
 *   2. 环境变量（适合容器/CI）—— PORT / UMO_ENGINE_URL / UMO_API_KEY / BIZ_RECEIVE_KEY
 */
import Database from 'better-sqlite3'
import busboy from 'busboy'
import { createWriteStream, createReadStream, mkdirSync, existsSync, statSync } from 'fs'
import { dirname, join, extname } from 'path'
import { fileURLToPath } from 'url'
import http from 'http'
import { v4 as uuidv4 } from 'uuid'
import { createCommentStore } from './comments.js'

// 加载同目录 config.json（不存在则用空对象，全部走环境变量/默认值）
import configFile from './config.json' with { type: 'json' }

const __dirname = dirname(fileURLToPath(import.meta.url))

// ============ 配置（优先级：环境变量 > config.json > 默认值） ============
const PORT = process.env.PORT || configFile.port || 4001
const DB_PATH = process.env.DB_PATH || join(__dirname, 'data', 'docs.db')
const FILES_DIR = join(__dirname, 'data', 'files')
// 引擎地址（本服务代理调引擎 /api/token 时用）
const UMO_ENGINE_URL = (process.env.UMO_ENGINE_URL || configFile.engineUrl || 'http://localhost:9999').replace(/\/+$/, '')
// 协同服务地址（本服务拉取文档摘要时调 /api/documents/:name/excerpt）。
// 多数部署中与引擎地址同源（引擎 nginx 把 /oes/collab /oes/api/documents 反代到 collab-server:4000），
// 也可独立部署。默认与引擎同源。
const UMO_COLLAB_URL = (process.env.UMO_COLLAB_URL || configFile.collabUrl || UMO_ENGINE_URL).replace(/\/+$/, '')
// 引擎 API Key（与引擎启动时的 UMO_API_KEY 一致；引擎 dev 模式可留空）
const UMO_API_KEY = process.env.UMO_API_KEY || configFile.apiKey || ''
// 接收回传文件的鉴权 key（防止伪造；前端在 export 请求里通过 apiKey 透传）
const RECEIVE_KEY = process.env.BIZ_RECEIVE_KEY || configFile.receiveKey || ''
// 拉取摘要超时（毫秒）。协同服务不可用时也不应拖慢列表响应。
const EXCERPT_TIMEOUT_MS = Number(process.env.EXCERPT_TIMEOUT_MS || configFile.excerptTimeoutMs || 1500)
// 格式转换服务地址（导入/导出文档）。导入时把文件转发到 <convertUrl>/api/convert/html
const UMO_CONVERT_URL = (process.env.UMO_CONVERT_URL || configFile.convertUrl || 'http://localhost:4002').replace(/\/+$/, '')
// 导入文件体积上限（与 convert-server 的 MAX_IMPORT_SIZE 保持一致）
const MAX_IMPORT_SIZE = 2 * 1024 * 1024

// ============ 数据库 ============
mkdirSync(dirname(DB_PATH), { recursive: true })
mkdirSync(FILES_DIR, { recursive: true })
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
const touchStmt = db.prepare('UPDATE documents SET updated_at = @updatedAt WHERE id = @id')

// 评论 store（REST + SSE + comments 表），路由在下方交由 commentStore.handle 处理
const commentStore = createCommentStore(db)

// ============ HTTP 工具 ============
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

// 拉取单个文档的纯文本摘要（来自协同服务 /api/documents/:id/excerpt）
// 失败/超时返回空字符串——列表展示允许空摘要，不应阻塞整体响应
async function fetchExcerpt(docId) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), EXCERPT_TIMEOUT_MS)
    const res = await fetch(
      `${UMO_COLLAB_URL}/api/documents/${encodeURIComponent(docId)}/excerpt`,
      { signal: controller.signal },
    )
    clearTimeout(timer)
    if (!res.ok) return ''
    const data = await res.json().catch(() => ({}))
    return typeof data.excerpt === 'string' ? data.excerpt : ''
  } catch {
    return ''
  }
}

// 读 JSON request body（限 64KB，元数据/鉴权接口用不到那么大）
function readJsonBody(req) {
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
    // 评论相关路由（REST + SSE）优先交由 commentStore 处理
    if (await commentStore.handle(req, res, url)) return

    // GET /api/documents —— 文档列表（含摘要：并发调协同端 /excerpt 拉首段纯文本）
    if (pathname === '/api/documents' && req.method === 'GET') {
      const rows = listStmt.all()
      const docs = await Promise.all(
        rows.map(async (row) => ({
          ...row,
          excerpt: await fetchExcerpt(row.id),
        })),
      )
      sendJson(res, 200, { documents: docs })
      return
    }

    // POST /api/documents { title, createdBy } —— 新建文档
    if (pathname === '/api/documents' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const title = (body.title || '').toString().trim() || '无标题文档'
      const createdBy = (body.createdBy || '匿名').toString().trim()
      const now = Date.now()
      const id = uuidv4()
      insertStmt.run({ id, title, createdBy, createdAt: now, updatedAt: now })
      const doc = { id, title, created_by: createdBy, created_at: now, updated_at: now }
      console.log(`[create] 文档 "${title}" (${id}) by ${createdBy}`)
      sendJson(res, 201, doc)
      return
    }

    // DELETE /api/documents/:id —— 删除文档（仅删元数据；Yjs blob 由引擎 collab-server 管）
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

    // GET /api/documents/:id —— 单个文档元数据
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

    // POST /api/doc-token { doc, name, role } —— 代理签 JWT（持 UMO_API_KEY 调引擎）
    // 演示业务后端如何代理签发：API Key 不暴露给前端，前端只拿到短时 JWT
    if (pathname === '/api/doc-token' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const doc = (body.doc || '').toString().trim()
      const name = (body.name || '匿名').toString().trim()
      const role = ['editor', 'commenter', 'viewer'].includes(body.role) ? body.role : 'editor'
      if (!doc) {
        sendJson(res, 400, { error: '缺少 doc 参数' })
        return
      }
      const tokenUrl = `${UMO_ENGINE_URL}/api/token?name=${encodeURIComponent(name)}&doc=${encodeURIComponent(doc)}&role=${role}`
      const engineRes = await fetch(tokenUrl, {
        headers: UMO_API_KEY ? { 'x-api-key': UMO_API_KEY } : {},
      })
      const data = await engineRes.json().catch(() => ({}))
      if (!engineRes.ok) {
        sendJson(res, engineRes.status, { error: data.error || '引擎签发 token 失败' })
        return
      }
      console.log(`[doc-token] 代理签发 JWT: doc="${doc}" name="${name}" role="${role}"`)
      sendJson(res, 200, { token: data.token, doc, role, name })
      return
    }

    // POST /api/import (multipart/form-data, field: file) —— 上传文档导入
    // 收到 .txt/.docx → 转发到 convert-server /api/convert/html → 拿到 HTML → 创建文档元数据
    // HTML 不落库（架构边界：经编辑器 setContent 灌入后由协同层持久化）
    if (pathname === '/api/import' && req.method === 'POST') {
      const file = await readMultipartFileToBuffer(req)
      if (!file) {
        sendJson(res, 400, { error: '未收到文件' })
        return
      }
      // 扩展名 + MIME 双重校验
      const ext = extname(file.filename).toLowerCase()
      const mime = (file.mimeType || '').toLowerCase()
      const isTxt = ext === '.txt' || mime === 'text/plain'
      const isDocx =
        ext === '.docx' ||
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      if (!isTxt && !isDocx) {
        sendJson(res, 400, {
          error: `不支持的文件类型: ${ext || mime || '未知'}，仅支持 .txt 和 .docx`,
        })
        return
      }

      // 转发到 convert-server（重新打包 multipart）
      const boundary = `----DemoImport${Date.now()}`
      const parts = Buffer.concat([
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from(
          `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n`,
        ),
        Buffer.from(`Content-Type: ${file.mimeType || 'application/octet-stream'}\r\n\r\n`),
        file.buffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ])
      const convertRes = await fetch(`${UMO_CONVERT_URL}/api/convert/html`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': parts.length,
        },
        body: parts,
      })
      const convertData = await convertRes.json().catch(() => ({}))
      if (!convertRes.ok) {
        sendJson(res, convertRes.status, {
          error: convertData.error || '转换服务处理失败',
        })
        return
      }

      // 创建文档元数据（title 用文件名去扩展名）
      const title = (convertData.title || '导入文档').toString().trim()
      const createdBy = '导入' // 导入场景无当前用户上下文，标记来源
      const now = Date.now()
      const id = uuidv4()
      insertStmt.run({ id, title, createdBy, createdAt: now, updatedAt: now })
      console.log(`[import] 文档 "${title}" (${id}), HTML ${convertData.html?.length || 0} chars`)

      sendJson(res, 201, {
        id,
        title,
        html: convertData.html || '',
      })
      return
    }

    // POST /api/receive-doc —— 接收方案 B3 回传的导出文件（multipart/form-data，字段名 file）
    // 演示业务后端如何收文件：存盘 + 返回可访问 URL
    if (pathname === '/api/receive-doc' && req.method === 'POST') {
      // 可选鉴权：前端在 export 请求里通过 apiKey 透传 BIZ_RECEIVE_KEY
      if (RECEIVE_KEY && req.headers['x-api-key'] !== RECEIVE_KEY) {
        sendJson(res, 401, { error: '回传鉴权失败' })
        return
      }
      const saved = await saveMultipartFile(req, req.headers['content-type'] || '')
      if (!saved) {
        sendJson(res, 400, { error: '未收到文件' })
        return
      }
      // 返回相对路径（带 demo 应用前缀 /oes/demo）：浏览器基于当前页面地址自动解析，
      // 域名/端口永远正确；若拼绝对 URL，经多层 nginx 透传后 host/前缀容易丢。
      const fileUrl = `/oes/demo/api/files/${encodeURIComponent(saved.filename)}`
      console.log(`[receive-doc] 收到文件 ${saved.filename} (${saved.size} bytes)`)
      sendJson(res, 200, { url: fileUrl, filename: saved.filename, size: saved.size })
      return
    }

    // GET /api/files/:name —— 提供已回传文件的下载（供前端展示下载链接）
    const fileMatch = pathname.match(/^\/api\/files\/([^/]+)$/)
    if (fileMatch && req.method === 'GET') {
      const filename = decodeURIComponent(fileMatch[1])
      // 防路径穿越：只取 basename
      const safe = filename.replace(/[\\/]/g, '_')
      const filePath = join(FILES_DIR, safe)
      if (!filePath.startsWith(FILES_DIR) || !existsSync(filePath)) {
        sendJson(res, 404, { error: '文件不存在' })
        return
      }
      const stat = statSync(filePath)
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(safe)}"`,
        'Access-Control-Allow-Origin': '*',
      })
      createReadStream(filePath).pipe(res)
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

// ============ multipart 文件解析（busboy） ============
function saveMultipartFile(req, contentType) {
  return new Promise((resolve, reject) => {
    if (!contentType.includes('multipart/form-data')) {
      resolve(null)
      return
    }
    const bb = busboy({ headers: req.headers })
    // 收集每个文件的写盘 Promise，确保 busboy finish 后等所有文件写完再 resolve
    const writePromises = []
    let gotFile = false
    bb.on('file', (fieldname, fileStream, info) => {
      gotFile = true
      const original = (info.filename || `export-${Date.now()}`).toString()
      const ext = extname(original) || '.docx'
      const filename = `${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`
      const filePath = join(FILES_DIR, filename)
      const writeStream = createWriteStream(filePath)
      let size = 0
      fileStream.on('data', (c) => { size += c.length })
      fileStream.pipe(writeStream)
      writePromises.push(
        new Promise((res, rej) => {
          writeStream.on('finish', () =>
            res({ filename, originalName: original, size, path: filePath }),
          )
          writeStream.on('error', rej)
        }),
      )
    })
    bb.on('finish', async () => {
      if (!gotFile) {
        resolve(null)
        return
      }
      try {
        const results = await Promise.all(writePromises)
        // 方案 B3 只回传单个文件，取第一个
        resolve(results[0] || null)
      } catch (e) {
        reject(e)
      }
    })
    bb.on('error', reject)
    req.pipe(bb)
  })
}

// ============ multipart 文件解析（读入内存 buffer，用于导入转发） ============
// 与 saveMultipartFile 不同：不写盘，直接收集到内存 buffer（转发给 convert-server 后即弃）
function readMultipartFileToBuffer(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || ''
    if (!contentType.includes('multipart/form-data')) {
      resolve(null)
      return
    }
    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: MAX_IMPORT_SIZE },
      defParamCharset: 'utf8',
    })
    let result = null
    bb.on('file', (fieldname, stream, info) => {
      const chunks = []
      let size = 0
      let tooLarge = false
      stream.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_IMPORT_SIZE) {
          tooLarge = true
          reject(new Error('文件超过 2MB 限制'))
          stream.destroy()
          return
        }
        chunks.push(chunk)
      })
      stream.on('end', () => {
        if (!tooLarge) {
          result = {
            buffer: Buffer.concat(chunks),
            filename: info.filename || '',
            mimeType: info.mimeType || '',
          }
        }
      })
      stream.on('error', reject)
    })
    bb.on('finish', () => {
      if (!result) {
        reject(new Error('未收到文件'))
        return
      }
      resolve(result)
    })
    bb.on('error', reject)
    req.pipe(bb)
  })
}

server.listen(PORT, () => {
  console.log(`\n✅ 瘦客户端示例后端已启动: http://localhost:${PORT}`)
  console.log(`   文档元数据: GET/POST /api/documents, DELETE /api/documents/:id`)
  console.log(`   代理签 JWT: POST /api/doc-token（→ 引擎 ${UMO_ENGINE_URL}/api/token）`)
  console.log(`   文档导入: POST /api/import（→ 转换服务 ${UMO_CONVERT_URL}/api/convert/html）`)
  console.log(`   接收回传: POST /api/receive-doc（方案 B3）`)
  console.log(`   存储: ${DB_PATH} (SQLite) + ${FILES_DIR} (回传文件)\n`)
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
