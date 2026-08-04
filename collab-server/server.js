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
import { encodeStateAsUpdate } from 'yjs'

// 注：本版本 @hocuspocus/server 导出的 Server 是一个单例实例（非构造函数），
// 用 server.configure({...}) 配置 + server.listen() 启动。

// ============ 配置 ============
const PORT = process.env.PORT || 4000
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'demo-token' // 阶段一写死，阶段二换 JWT

// ============ 内存持久化 ============
// key = 文档名，value = Y.Doc 二进制状态（Buffer）
const store = new Map()

// ============ Hocuspocus 服务 ============
const server = Server

server.configure({
  port: PORT,
  // Hocuspocus 自带防抖（debounce: 2000ms），onStoreDocument 会在编辑停顿后自动触发，
  // 无需自己实现防抖逻辑。这是阶段二切到数据库时的主改动点。

  // ============ 生命周期 hook ============

  // 连接前鉴权（阶段一：简单 token 比对）
  async onAuthenticate({ token }) {
    if (token !== AUTH_TOKEN) {
      throw new Error('鉴权失败：token 不正确')
    }
    return true
  },

  // 文档加载：从内存取回二进制状态，喂给 Hocuspocus 提供的 document
  async onLoadDocument({ documentName, document }) {
    const saved = store.get(documentName)
    if (saved) {
      const { applyUpdate } = await import('yjs')
      applyUpdate(document, new Uint8Array(saved))
      console.log(`[load] 文档 "${documentName}" 从内存恢复 (${saved.length} bytes)`)
    } else {
      console.log(`[load] 文档 "${documentName}" 新建`)
    }
  },

  // 文档变更后持久化（Hocuspocus 已做防抖，停顿后触发）
  async onStoreDocument({ documentName, document }) {
    const state = Buffer.from(encodeStateAsUpdate(document))
    store.set(documentName, state)
    console.log(`[store] 文档 "${documentName}" 已持久化 (${state.length} bytes)`)
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
    console.log(`   鉴权 token: ${AUTH_TOKEN}`)
    console.log(`   持久化方式: 内存 Map（重启丢失）\n`)
  },
})

// ============ 优雅停机 ============
const shutdown = async (signal) => {
  console.log(`\n收到 ${signal}，正在关闭...`)
  console.log(`[shutdown] 当前持久化文档数: ${store.size}`)
  await server.destroy()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

server.listen()
