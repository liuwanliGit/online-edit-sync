/**
 * 评论 API 地址推导（引擎内置）
 * -----------------------------------------------------------
 * 引擎内置评论时，API 地址通过以下优先级推导：
 *   1. options.comments.apiBase（用户显式配置，如 'https://api.example.com'）
 *   2. 从当前页面 URL 自动推导部署前缀（embed 场景 /oes，子路径反代 /editor/oes 等）
 *   3. 同源根路径（空字符串 ''，即相对当前 origin）
 *
 * embed 页面由引擎 nginx 提供服务（URL 形如 /oes/embed），评论 API 也由引擎 nginx
 * 反代到 collab-server（路径 /oes/api/documents/:docId/comments），所以前端请求
 * 必须带上 /oes 前缀才能命中 nginx 反代规则。
 */

/**
 * 从当前页面 URL 推导部署前缀。
 * embed 页面固定为 /embed 结尾（如 /oes/embed、/editor/oes/embed），
 * 剥掉 /embed 后剩下的就是部署前缀（如 /oes、/editor/oes）。
 * 根部署（/embed）返回 ''。
 *
 * 对于非 embed 场景（独立使用引擎），页面 URL 不以 /embed 结尾时返回 ''。
 */
function detectDeployPrefix() {
  if (typeof window === 'undefined') return ''
  const path = window.location.pathname.replace(/\/+$/, '')
  // 匹配 /embed 结尾，剥掉它得到前缀
  const m = path.match(/^(.*)\/embed$/)
  return m ? m[1] : ''
}

/**
 * 获取评论 API 基地址（不含 /api 后缀）
 * @param {string} apiBase 用户配置的 apiBase（options.comments.apiBase）
 * @returns {string} 去掉尾斜杠的基地址（如 ''、'/oes'、'https://api.example.com'）
 */
export function getCommentApiBase(apiBase) {
  // 1. 用户显式配置
  if (apiBase && typeof apiBase === 'string') {
    return apiBase.replace(/\/+$/, '')
  }
  // 2. 自动推导部署前缀（embed 场景需要 /oes 前缀命中 nginx 反代）
  return detectDeployPrefix()
}
