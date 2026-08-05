/**
 * 协同服务地址解析（指向 collab-server，不在本 demo 内）
 * -----------------------------------------------------------
 * 部署时无需重新构建，通过全局变量覆盖协同服务地址即可：
 *   window.__UMO_COLLAB_URL__ = 'wss://collab.your-domain.com'
 *
 * 读取顺序：window.__UMO_COLLAB_URL__ → 兜底 ws://localhost:4000（dev）
 * 同一个地址同时推导出 WebSocket 连接地址和 /api/token 端点。
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
  return base
}

function toHttpUrl(base) {
  if (base.startsWith('ws://')) return 'http://' + base.slice(5)
  if (base.startsWith('wss://')) return 'https://' + base.slice(6)
  if (base.startsWith('http://') || base.startsWith('https://')) return base
  return 'http://' + base
}

const resolvedBase = normalizeBase(
  typeof window !== 'undefined' ? window.__UMO_COLLAB_URL__ : undefined,
)

/** WebSocket 连接地址（传给 HocuspocusProvider.url） */
export function getCollabWsUrl() {
  return toWsUrl(resolvedBase)
}

/** /api/token 签发端点（HTTP，fetch 用），查询串由调用方拼接 */
export function getCollabTokenUrl() {
  return `${toHttpUrl(resolvedBase)}/api/token`
}
