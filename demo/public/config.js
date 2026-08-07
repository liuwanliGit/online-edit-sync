/**
 * Umo Editor 瘦客户端 — 运行时配置
 * -----------------------------------------------------------
 * 部署时直接编辑本文件即可更改服务端与引擎地址，无需重新打包前端。
 *
 * 本文件由 index.html 在应用主程序加载前同步引入，
 * 生效后通过全局变量 window.__UMO_CONFIG__ 被前端读取。
 *
 * 字段说明：
 *   apiBase    demo 后端（业务系统后端）地址。
 *              文档元数据管理 / 代理签 JWT / 接收导出文件回传 都指向这里。
 *   engineUrl  Umo Editor 引擎地址。
 *              iframe 嵌入的 /embed 页、协同 WebSocket 都指向这里。
 *
 * 留空（''）或不填则使用代码内置的兜底默认值（适合本地开发）：
 *   apiBase   兜底 http://localhost:4001
 *   engineUrl 兜底 http://localhost:9999
 */
window.__UMO_CONFIG__ = {
  // demo 后端地址（留空则用默认 http://localhost:4001）
  apiBase: '',

  // Umo Editor 引擎地址（留空则用默认 http://localhost:9999）
  engineUrl: '',
}
