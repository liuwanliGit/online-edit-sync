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
import { applyUpdate, encodeStateAsUpdate } from 'yjs'

import { closeDb, loadDoc, saveDoc } from './storage.js'

// 注：本版本 @hocuspocus/server 导出的 Server 是一个单例实例（非构造函数），
// 用 server.configure({...}) 配置 + server.listen() 启动。

// ============ 配置 ============
const PORT = process.env.PORT || 4000
// JWT 密钥（HS256 对称密钥），生产环境务必通过环境变量设置
const JWT_SECRET = process.env.JWT_SECRET || 'umo-collab-secret-dev-only'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h'

// ============ Hocuspocus 服务 ============
const server = Server

server.configure({
  port: PORT,
  // Hocuspocus 自带防抖（debounce: 2000ms），onStoreDocument 会在编辑停顿后自动触发，
  // 无需自己实现防抖逻辑。这是阶段二切到数据库时的主改动点。

  // ============ 生命周期 hook ============

  // HTTP 请求处理：提供 JWT 签发端点
  // GET /api/token?name=用户名&doc=文档名 → 返回签名的 JWT
  // 同一个端口（4000）同时提供 WebSocket 协同服务和 HTTP token 签发
  async onRequest({ request, response }) {
    const url = new URL(request.url, `http://${request.headers.host}`)
    if (url.pathname === '/api/token' && request.method === 'GET') {
      const name = url.searchParams.get('name') || `用户-${Math.floor(Math.random() * 1000)}`
      const doc = url.searchParams.get('doc') || 'demo-doc'
      const token = jwt.sign({ name, doc }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // 前端 9000 端口跨域访问 4000
      })
      response.end(JSON.stringify({ token, name, doc }))
      // 抛 falsy 值阻止 Hocuspocus 走默认响应（源码 line 2001-2008：
      // catch(error) { if (error) throw error } —— falsy error 只跳过默认处理不 rethrow）
      throw null
    }
    // 其他请求走 Hocuspocus 默认处理
  },

  // 连接前鉴权（JWT 验证）
  async onAuthenticate({ token, documentName, context }) {
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
    // 把用户信息写入 context，供后续 hook（onLoadDocument 等）使用
    context.user = { name: payload.name, doc: payload.doc }
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
    console.log(`   持久化方式: SQLite（WAL 模式）\n`)
  },
})

// ============ 优雅停机 ============
const shutdown = async (signal) => {
  console.log(`\n收到 ${signal}，正在关闭...`)
  await server.destroy()
  closeDb()
  console.log(`[shutdown] SQLite 连接已关闭`)
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

server.listen()
