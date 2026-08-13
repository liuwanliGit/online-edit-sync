/**
 * Umo Editor 阶段一最小协同服务
 * -----------------------------------------------------------
 * 技术栈：Hocuspocus (Node.js) + Yjs
 * 持久化：内存 Map（重启丢失，仅用于链路验证）
 *
 * 启动：npm install && npm start
 * 端口：4000，WebSocket 路径默认 /
 *
 * 后续阶段切换：
 *   - 阶段二：把 onStoreDocument/onLoadDocument 换成真实数据库（MySQL/Postgres）
 *   - 阶段三：加 @hocuspocus/extension-redis 做多实例广播
 */

import { Server } from '@hocuspocus/server'
import jwt from 'jsonwebtoken'
import * as Y from 'yjs'
import { applyUpdate, encodeStateAsUpdate } from 'yjs'

import { closeDb, loadDoc, saveDoc } from './storage.js'
import { createCommentStorage } from './comment-storage.js'

// 注：本版本 @hocuspocus/server 导出的 Server 是一个单例实例（非构造函数），
// 用 server.configure({...}) 配置 + server.listen() 启动。

// ============ 配置 ============
const PORT = process.env.PORT || 4000
// JWT 密钥（HS256 对称密钥），生产环境务必通过环境变量设置
const JWT_SECRET = process.env.JWT_SECRET || 'umo-collab-secret-dev-only'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h'
// API Key：业务后端调 /api/token 签 JWT 时必须带 header `x-api-key` 校验。
// 私有化部署务必通过 UMO_API_KEY 环境变量设为强随机值，不对外公开。
// 未设置时仅打印警告并放行（仅用于本地 dev，生产镜像必须配置）。
const UMO_API_KEY = process.env.UMO_API_KEY || ''
const CORS_ORIGIN = '*'
// 文档 Yjs binary 体积上限（字节）。超过后拒绝新的编辑 update，防止文档膨胀到无法打开。
// 基于打开体验倒推：3MB → 每次打开 WS 同步约 2.5 秒 + DOM 渲染约 1.5 秒，是可接受的体验边界。
// 设为 0 则不限制。
const MAX_DOC_SIZE = Number(process.env.MAX_DOC_SIZE_BYTES) || 3 * 1024 * 1024

// ============ 评论存储（独立 comments.db） ============
// 传入 server 单例，供评论 API 在 commenter 提交时代写 comment mark 到 Yjs 文档
// （commenter 的协同连接为 readOnly，无法自己写 mark；由服务端用 openDirectConnection 代写并广播）
const commentStorage = createCommentStorage({ server: Server })

// ============ 文档摘要提取（列表卡片用）============
// 从 SQLite 加载 Yjs 二进制 → 临时 Y.Doc → 遍历 XmlFragment 拼接前 N 字纯文本。
// 不走 openDirectConnection，避免把文档载入 Hocuspocus 内存（仅读摘要不应触发协同生命周期）。
// SQLite 内容由 onStoreDocument 防抖写入（Hocuspocus 2s），最多滞后 2s，列表展示可接受。
const EXCERPT_MAX_CHARS = 80
function readExcerpt(docName, max = EXCERPT_MAX_CHARS) {
  const buf = loadDoc(docName)
  if (!buf) return ''
  const tmpDoc = new Y.Doc()
  try {
    applyUpdate(tmpDoc, new Uint8Array(buf))
    const frag = tmpDoc.getXmlFragment('default')
    let text = ''
    walkFragmentText(frag, (s) => {
      const remaining = max * 2 - text.length // 多收一倍防 trim 后不足
      if (remaining > 0) text += s.slice(0, Math.max(0, remaining))
    })
    text = text.replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return text.length > max ? text.slice(0, max) + '…' : text
  } catch {
    return ''
  } finally {
    tmpDoc.destroy()
  }
}

// 遍历 XmlFragment/XmlElement 下的所有 XmlText，把纯文本按顺序喂给 cb
function walkFragmentText(node, cb) {
  if (node instanceof Y.XmlText) {
    for (const op of node.toDelta()) {
      if (op.insert) cb(op.insert)
    }
    return
  }
  const children = node.toArray ? node.toArray() : []
  for (const child of children) walkFragmentText(child, cb)
}

// ============ Hocuspocus 服务 ============
const server = Server

server.configure({
  port: PORT,
  // Hocuspocus 自带防抖（debounce: 2000ms），onStoreDocument 会在编辑停顿后自动触发，
  // 无需自己实现防抖逻辑。这是阶段二切到数据库时的主改动点。

  // ============ 生命周期 hook ============

  // HTTP 请求处理：提供 JWT 签发端点（API Key 收口）
  // GET /api/token?name=用户名&doc=文档名&role=editor|viewer
  //   header: x-api-key: <UMO_API_KEY>  → 校验通过才签发 JWT
  //   role=editor（默认）：可编辑；role=viewer：只读（服务端拒绝其 update）
  // 同一个端口（4000）同时提供 WebSocket 协同服务和 HTTP token 签发
  async onRequest({ request, response }) {
    const url = new URL(request.url, `http://${request.headers.host}`)
    const { pathname } = url

    // ============ 评论 REST + SSE 路由（无鉴权，同源信任） ============
    // 路径前缀 /api/documents/ 和 /api/comments/ 由评论存储层处理
    if (
      pathname.startsWith('/api/documents/') ||
      pathname.startsWith('/api/comments/')
    ) {
      if (await commentStorage.handle(request, response, url)) {
        throw null
      }
    }

    // ============ 文档摘要（用于业务后端列表卡片展示）============
    // GET /api/documents/:docName/excerpt → { excerpt: "前N字..." }
    // 无鉴权（同源信任，与评论 API 一致；返回内容仅为文档首段纯文本，不含敏感数据）
    const excerptMatch = pathname.match(/^\/api\/documents\/([^/]+)\/excerpt$/)
    if (excerptMatch && request.method === 'GET') {
      const docName = decodeURIComponent(excerptMatch[1])
      const excerpt = readExcerpt(docName)
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': CORS_ORIGIN,
      })
      response.end(JSON.stringify({ excerpt }))
      throw null
    }

    // CORS 预检：业务后端可能跨域调 /api/token
    if (request.method === 'OPTIONS' && pathname === '/api/token') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
        'Access-Control-Max-Age': '86400',
      })
      response.end()
      throw null
    }

    // 健康检查
    if (pathname === '/api/health' && request.method === 'GET') {
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': CORS_ORIGIN,
      })
      response.end(JSON.stringify({ ok: true, service: 'umo-collab-server' }))
      throw null
    }

    if (pathname === '/api/token' && request.method === 'GET') {
      // API Key 收口：生产环境必须配置 UMO_API_KEY，业务后端持此 Key 代理调本端点
      if (UMO_API_KEY) {
        const apiKey = request.headers['x-api-key']
        if (!apiKey || apiKey !== UMO_API_KEY) {
          response.writeHead(401, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': CORS_ORIGIN,
          })
          response.end(JSON.stringify({ error: 'API Key 无效或缺失' }))
          throw null
        }
      } else {
        // dev 兜底：未配 UMO_API_KEY 时仅警告（生产镜像必须配置）
        console.warn('[warn] UMO_API_KEY 未设置，/api/token 处于无鉴权模式（仅 dev 可用）')
      }

      const name = url.searchParams.get('name') || `用户-${Math.floor(Math.random() * 1000)}`
      const doc = url.searchParams.get('doc') || 'demo-doc'
      // role 校验：接受 editor / commenter / viewer，默认 editor
      // - editor：可编辑文档内容 + 评论
      // - commenter：不可编辑文档内容，但可评论（评论的 comment mark 由服务端代写到 Yjs 文档）
      // - viewer：纯只读，不可评论
      const roleParam = url.searchParams.get('role')
      const role = ['editor', 'commenter', 'viewer'].includes(roleParam) ? roleParam : 'editor'
      const token = jwt.sign({ name, doc, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': CORS_ORIGIN,
      })
      response.end(JSON.stringify({ token, name, doc, role }))
      // 抛 falsy 值阻止 Hocuspocus 走默认响应（源码 line 2001-2008：
      // catch(error) { if (error) throw error } —— falsy error 只跳过默认处理不 rethrow）
      throw null
    }
    // 其他请求走 Hocuspocus 默认处理
  },

  // 连接前鉴权（JWT 验证 + 权限控制）
  async onAuthenticate({ token, documentName, context, connection }) {
    let payload
    try {
      payload = jwt.verify(token, JWT_SECRET)
    } catch (e) {
      // 抛带 reason 的对象（不是 Error），前端 authenticationFailed 事件才能收到中文原因
      throw { reason: `JWT 验证失败：${e.message}` }
    }
    // 文档级权限校验：token 里的 doc 必须匹配请求的文档名
    if (payload.doc && payload.doc !== documentName) {
      throw { reason: `无权访问文档 "${documentName}"` }
    }
    // 权限控制：viewer 和 commenter 都设为只读（Hocuspocus 会拒绝该连接的所有 update），
    // 即两者都不能通过协同连接修改文档内容。差异在于：
    // - viewer：不可评论（前端不显示评论按钮）
    // - commenter：可评论，评论的 comment mark 由服务端通过评论 API 代写到 Yjs 文档
    //   （见 comment-storage.js 的 POST/PATCH/DELETE 分支，用 openDirectConnection）
    // editor 默认可编辑。这是服务端强制，前端 setEditable(false) 只是体验优化。
    if (payload.role === 'viewer' || payload.role === 'commenter') {
      connection.readOnly = true
    }
    // 把用户信息写入 context，供后续 hook（onLoadDocument 等）使用
    context.user = { name: payload.name, doc: payload.doc, role: payload.role || 'editor' }
  },

  // 文档大小限制：在每条 update 应用前检查当前文档体积。
  // 超过 MAX_DOC_SIZE 时：
  //   1. 用 stateless 消息通知前端「文档超限，转只读」（前端 onStateless 接收）
  //   2. throw 拒绝该 update（Hocuspocus 会关闭连接）
  // 注意：这是"防止继续膨胀"的硬限制，不能缩小已有文档——已有内容保留，只是不能再编辑。
  async beforeHandleMessage({ document, documentName, connection }) {
    if (MAX_DOC_SIZE <= 0) return
    const size = encodeStateAsUpdate(document).length
    if (size > MAX_DOC_SIZE) {
      console.log(
        `[size-limit] 文档 "${documentName}" 超限: ${size} > ${MAX_DOC_SIZE} bytes，拒绝 update`,
      )
      // 先通过 stateless 消息通知前端（带外通道，不依赖 WS close code 传递）
      connection?.sendStateless?.(
        JSON.stringify({
          type: 'doc-size-limit',
          size,
          limit: MAX_DOC_SIZE,
        }),
      )
      // 再 throw 拒绝 update + 关闭连接
      throw {
        code: 4030,
        reason: `文档已达大小上限(${Math.round(MAX_DOC_SIZE / 1024 / 1024)}MB)，已转为只读模式`,
      }
    }
  },

  // 文档加载：从 SQLite 取回二进制状态，喂给 Hocuspocus 提供的 document
  async onLoadDocument({ documentName, document }) {
    const saved = loadDoc(documentName)
    if (saved) {
      applyUpdate(document, new Uint8Array(saved))
      console.log(`[load] 文档 "${documentName}" 从 SQLite 恢复 (${saved.length} bytes)`)
    } else {
      console.log(`[load] 文档 "${documentName}" 新建`)
    }
  },

  // 文档变更后持久化（Hocuspocus 已做防抖，停顿 2s 或最多 10s 触发）
  async onStoreDocument({ documentName, document }) {
    const state = Buffer.from(encodeStateAsUpdate(document))
    saveDoc(documentName, state)
    console.log(`[store] 文档 "${documentName}" 已写入 SQLite (${state.length} bytes)`)
  },

  // 连接建立
  async onConnect({ documentName, socketId }) {
    console.log(`[connect] socket=${socketId} -> 文档 "${documentName}"`)
  },

  // 连接断开
  async onDisconnect({ documentName, socketId }) {
    console.log(`[disconnect] socket=${socketId} 离开文档 "${documentName}"`)
  },

  // 启动完成
  async onListen() {
    console.log(`\n✅ 协同服务已启动: ws://localhost:${PORT}`)
    console.log(`   鉴权方式: JWT (HS256)，签发端点 GET /api/token`)
    console.log(`   API Key 收口: ${UMO_API_KEY ? '已启用（业务后端须带 x-api-key）' : '未启用（dev 模式，/api/token 无鉴权）'}`)
    console.log(`   持久化方式: SQLite（WAL 模式）`)
    console.log(`   文档大小限制: ${MAX_DOC_SIZE > 0 ? Math.round(MAX_DOC_SIZE / 1024 / 1024) + 'MB（超限转只读）' : '未限制'}`)
    console.log(`   评论 API: /api/documents/:docId/comments/*（无鉴权，同源信任）`)
    console.log(`   评论 SSE: /api/documents/:docId/comments/stream\n`)
  },
})

// ============ 优雅停机 ============
const shutdown = async (signal) => {
  console.log(`\n收到 ${signal}，正在关闭...`)
  await server.destroy()
  closeDb()
  console.log(`[shutdown] collab.db 连接已关闭`)
  commentStorage.closeCommentDb()
  console.log(`[shutdown] comments.db 连接已关闭`)
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

server.listen()
