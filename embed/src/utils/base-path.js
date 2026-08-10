/**
 * 子路径前缀推导（embed 引擎页专用）
 * -----------------------------------------------------------
 * embed 是同源服务（由引擎 nginx 提供静态资源 + 反代 /collab /api/convert 等）。
 * 当引擎被外层 nginx 反代到子路径（如 https://公司域名/editor/embed?...）时，
 * WS 与 convert 等同源请求需要带上该子路径前缀。
 *
 * 这里不依赖 vite base（相对 base 下 import.meta.env.BASE_URL 不可用于拼前缀），
 * 而是从当前页面 URL 自动推导：
 *   · 根部署：URL 形如 /embed?...        → 前缀 ''
 *   · 子路径：URL 形如 /editor/embed?... → 前缀 '/editor'
 *
 * iframe 着陆页固定为 /embed（见 engine-config.js 的 getEmbedUrl），可据此稳定剥离前缀。
 */

/**
 * 返回当前部署的子路径前缀（无尾斜杠；根部署返回 ''）。
 */
export function getBasePath() {
  if (typeof window === 'undefined') return ''
  // 去掉尾部斜杠，便于正则匹配
  const path = window.location.pathname.replace(/\/+$/, '')
  // 匹配到 /embed 结尾，剥掉它，剩下的就是子路径前缀
  const m = path.match(/^(.*)\/embed$/)
  return m ? m[1] : ''
}

/**
 * 把一个站点根相对路径（如 '/collab'、'/api/convert/docx'）拼上当前子路径前缀。
 * @param {string} p 必须以 '/' 开头的根相对路径
 * @returns {string} 带前缀的路径，如 '/editor/collab'
 */
export function withBasePath(p) {
  const prefix = getBasePath()
  return `${prefix}${p}`
}
