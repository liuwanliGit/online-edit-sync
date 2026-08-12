/**
 * Umo Editor 瘦客户端 — 运行时配置（本地开发用）
 * -----------------------------------------------------------
 * 本文件由 index.html 在应用主程序加载前同步引入，
 * 生效后通过全局变量 window.__UMO_CONFIG__ 被前端读取。
 *
 * demo 应用挂在 /oes/demo 前缀下（与 vite base、容器 nginx location 一致）。
 * 引擎侧（embed/协同/评论 API）仍挂在 /oes 前缀下，两者错开。
 *
 * 字段说明：
 *   apiBase    demo 后端（业务系统后端）地址。
 *              · 本地开发（npm run dev）：填 http://localhost:4001（直连后端，绕过 /oes/demo 前缀）
 *              · Docker 部署：留空 ''（走同源，前端自动补 /oes/demo 前缀，demo nginx 反代 /oes/demo/api/）
 *              文档元数据管理 / 代理签 JWT / 接收导出文件回传 都指向这里。
 *   engineUrl  Umo Editor 引擎地址（必须带 /oes 前缀）。
 *              · 本地开发：填 http://localhost:9999/oes
 *              · Docker 部署：由容器 entrypoint 根据环境变量自动生成
 *              iframe 嵌入的 /oes/embed 页、协同 WebSocket 都指向这里。
 *   routerBase Vue Router history 模式的基础路径。
 *              · 固定 '/oes/demo'（与 vite base 一致）
 *
 * 打包后部署：编辑 dist/config.js 即可，无需重新打包。
 */
window.__UMO_CONFIG__ = {
  // demo 后端地址（本地开发用 http://localhost:4001 直连；Docker 同源部署留空 ''）
  apiBase: 'http://localhost:4001',

  // Umo Editor 引擎地址（带 /oes 前缀；本地开发填 http://localhost:9999/oes）
  engineUrl: 'http://localhost:9999/oes',

  // Vue Router 基础路径（固定 /oes/demo，与 vite base 一致）
  routerBase: '/oes/demo',
}
