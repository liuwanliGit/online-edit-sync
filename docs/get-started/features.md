# 支持的功能

> 本页总览 Umo Editor Engine 的核心能力，帮助接入方快速判断是否满足需求。

---

## 协同编辑

| 能力 | 说明 |
| --- | --- |
| 实时同步 | 基于 Yjs CRDT，多用户同时编辑无冲突合并 |
| 协作者光标 | 每个协作者独立颜色的光标，实时显示他人编辑位置 |
| 离线重连 | 网络断开自动重连，重连后自动合并离线期间的编辑 |
| 服务端持久化 | 文档实时存盘，无需手动保存 |

---

## 交互方式

| 能力 | 说明 |
| --- | --- |
| 同源直调 | iframe 与父页面同域时，可同步调用 `window.__UMO_EDITOR__` 全部方法 |
| 跨域 postMessage | 跨域时走异步请求/响应协议，覆盖取内容/插入/导出/书签等 |
| 协作者感知 | iframe 向父页面推送 `{ type: 'awareness', collaborators: [...] }`，业务前端可展示在线列表 |

---

## 内容操作

| 方法 | 同源直调 | postMessage | 说明 |
| --- | :---: | :---: | --- |
| `getHTML()` | ✅ | ✅ | 取文档 HTML |
| `getJSON()` | ✅ | ✅ | 取 ProseMirror JSON |
| `getText()` | ✅ | ✅ | 取纯文本 |
| `getContent(format)` | ✅ | ✅ | 按 format 取内容（html/text/json） |
| `setContent(content)` | ✅ | ✅ | 替换文档内容 |
| `insertContent(content)` | ✅ | ✅ | 在光标处插入内容 |
| `getImage(format)` | ✅ | ✅ | 截图，返回 Blob/Promise |
| `getVanillaHTML()` | ✅ | ❌ | 取高保真 HTML（导出用） |

详见 [同源直调 API](../api-reference/same-origin-api.md) 与 [postMessage 协议](../api-reference/postmessage-protocol.md)。

---

## 导出

| 能力 | 说明 |
| --- | --- |
| 导出 docx | 编辑器转 HTML → convert-server 转 docx → 直接 POST 推给业务后端 callbackUrl |
| 高保真 | 走前端已渲染的 DOM，图表/公式/视频所见即所得 |
| 截图导出 | `getImage('png')` 导出当前文档为图片 |

详见 [导出与文件回传](../api-reference/export.md)。

---

## 文件上传

| 能力 | 说明 |
| --- | --- |
| 零配置上传 | 图片等附件转 base64 Data URL 写入 Yjs 文档，无需配置外部对象存储 |
| 协同同步 | 文件随文档实时同步，天然支持协同 |
| 无外部依赖 | 不依赖 OSS/S3/MinIO，开箱即用 |

> 大文件（视频等）建议外链，避免 base64 膨胀 Yjs 文档体积。

---

## 只读与权限

| 能力 | 说明 |
| --- | --- |
| 只读模式 | `mode=view` 或 `setReadOnly(true)`。只读由引擎服务端强制，前端无法绕过 |
| 角色控制 | JWT role claim 决定 editor/viewer，由业务后端签发 |
| 运行时切换 | `setReadOnly(bool)` 可在运行时切换编辑/只读 |

---

## 书签

| 方法 | 说明 |
| --- | --- |
| `setBookmark(name)` | 在当前光标处设置书签 |
| `focusBookmark(name)` | 定位到指定书签 |
| `getAllBookmarks()` | 获取全部书签列表 |
| `deleteBookmark(name)` | 删除书签 |

---

## 编辑器 UI

| 能力 | 说明 |
| --- | --- |
| 工具栏模式 | ribbon（默认）|
| 页面布局 | page（分页）/ web（流式）|
| 多语言 | zh-CN（默认）/ en-US |
| 打印 | `print()` |
| 全屏 | `toggleFullscreen()` |
| 主题/皮肤 | `setTheme()` / `setSkin()`（同源直调） |

---

## 后端读取（二阶段）

read-server 提供无头读取 Yjs 文档的能力，用于列表摘要/全文检索：

| 接口 | 说明 |
| --- | --- |
| `GET /api/doc/:id/excerpt?limit=100` | 纯文本摘要（前 N 字） |
| `GET /api/doc/:id/html` | 完整 HTML（基础节点） |
| `GET /api/doc/:id/json` | ProseMirror JSON |
| `GET /api/doc/:id/text` | 完整纯文本 |

> ⚠️ read-server 在无 DOM 环境下渲染，复杂节点（Echarts 图表、视频、数学公式）会降级。仅用于「够用就行」的离线读取，不用于高保真导出。

详见 [服务端接口](../api-reference/server-api.md)。

---

## 不支持的能力

| 能力 | 原因 |
| --- | --- |
| 跨域拿 Tiptap/ProseMirror 底层实例 | 函数引用不可跨域克隆。需同源直调 |
| 跨域拖拽进 iframe | drop 事件不跨 frame。需父页面拦截 → postMessage → insertContent |
| 离线编辑（无网络） | 协同依赖 WebSocket 长连接 |
| 自定义 Tiptap 扩展（iframe 模式） | 需走「组件库集成」模式（npm 包） |

---

## 下一步

- [同源直调 API](../api-reference/same-origin-api.md)
- [postMessage 协议](../api-reference/postmessage-protocol.md)
- [导出与文件回传](../api-reference/export.md)
