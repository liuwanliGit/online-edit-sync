/**
 * 协同服务地址解析（运行时配置）
 * -----------------------------------------------------------
 * 部署时无需重新构建产物，通过全局变量覆盖协同服务地址即可：
 *
 *   window.__UMO_COLLAB_URL__ = 'wss://collab.example.com'   // 完整 ws/wss
 *   window.__UMO_COLLAB_URL__ = 'https://collab.example.com' // 也可写 http(s)://，自动推导 ws
 *   window.__UMO_COLLAB_URL__ = 'collab.example.com:4000'    // 或裸 host:port，默认 ws/http
 *
 * 读取顺序：window.__UMO_COLLAB_URL__ → 兜底 ws://localhost:4000（dev）
 * 同一个地址同时推导出 WebSocket 连接地址和 /api/token 端点，
 * 保证两者一定指向同一台协同服务，避免一个连上了另一个连不上的问题。
 */

const FALLBACK = 'ws://localhost:4000'

function normalizeBase(raw) {
  if (!raw) return FALLBACK
  const s = String(raw).trim().replace(/\/+$/, '')
  return s || FALLBACK
}

function toWsUrl(base) {
  if (base.startsWith('http://')) return 'ws://' + base.slice(7)
  if (base.startsWith('https://')) return 'wss://' + base.slice(8)
  if (base.startsWith('ws://') || base.startsWith('wss://')) return base
  // 裸 host[:port]：按当前页面协议选 ws/wss，本地默认 ws
  return base
}

function toHttpUrl(base) {
  if (base.startsWith('ws://')) return 'http://' + base.slice(5)
  if (base.startsWith('wss://')) return 'https://' + base.slice(6)
  if (base.startsWith('http://') || base.startsWith('https://')) return base
  return 'http://' + base
}

// 已解析的协同服务地址（读取一次即可，运行时全局变量不会再变）
const resolvedBase = normalizeBase(
  typeof window !== 'undefined' ? window.__UMO_COLLAB_URL__ : undefined,
)

/** WebSocket 连接地址（传给 HocuspocusProvider.url） */
export function getCollabWsUrl() {
  return toWsUrl(resolvedBase)
}

/** /api/token 签发端点地址（HTTP，fetch 用），查询串由调用方拼接 */
export function getCollabTokenUrl() {
  return `${toHttpUrl(resolvedBase)}/api/token`
}

/** 原始已归一化的协同服务地址，便于日志/调试 */
export function getCollabBaseUrl() {
  return resolvedBase
}
