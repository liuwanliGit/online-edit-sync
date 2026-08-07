# 概述

> **Umo Editor Engine** 是一个可私有化部署的实时协同富文本编辑引擎。它以 Docker 镜像形式交付，部署在企业自己的服务器上。业务系统通过 iframe 嵌入编辑器，获得「打开文档 → 实时协同编辑 → 导出 Word」的完整能力，无需自己维护协同运行时。

---

## 它是什么

Umo Editor Engine 解决的核心问题是：**让任意业务系统（OA / CMS / 知识库 / 教育平台）在不引入 Vue 生态依赖的前提下，获得 OnlyOffice 级别的协同文档编辑能力。**

传统做法是把编辑器作为 npm 组件集成进业务前端，但这要求业务系统：

- 技术栈必须是 Vue 3
- 自行安装并维护 `yjs`、`@hocuspocus/provider`、`@tiptap/*` 等协同运行时
- 处理 ProseMirror 实例唯一性、版本对齐等底层问题

Umo Editor Engine 把这些复杂度全部收进一个 Docker 镜像。业务系统只需要：

1. 启动引擎镜像
2. 用 iframe 指向引擎的 `/embed` 页面
3. 通过同源直调或 postMessage 与编辑器交互

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│ 企业业务系统（你的项目）                                       │
│                                                             │
│  业务前端                    业务后端                         │
│  ┌───────────┐              ┌──────────────┐               │
│  │ 业务页面   │ ──REST──→   │ 业务后端      │               │
│  │ <iframe>  │             │ 持有 UMO_API_KEY              │ │
│  └─────┬─────┘              └──────┬───────┘               │
│        │                           │                        │
│        │ iframe src                │ GET /api/token          │
│        │ /embed?doc=&token=        │ (header: x-api-key)     │
│        ▼                           ▼                        │
└────────┼───────────────────────────┼────────────────────────┘
         │                           │
         │      HTTP/WS              │
         ▼                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Umo Editor Engine 镜像（企业自部署）                          │
│  nginx(:9999)                                               │
│   ├─ /embed          → 纯编辑器页（iframe 着陆页）           │
│   ├─ /collab (WS)    → collab-server(:4000) Yjs 协同        │
│   ├─ /api/token      → collab-server JWT 签发（需 API Key）  │
│   ├─ /api/convert    → convert-server(:4002) HTML→docx      │
│   └─ /api/doc/:id    → read-server(:4003) Yjs→HTML（二阶段） │
└─────────────────────────────────────────────────────────────┘
```

### 组件职责

| 组件 | 职责 |
| --- | --- |
| **nginx (:9999)** | 引擎统一入口，反代 `/embed`、`/collab`、`/api/*` 到内部各服务 |
| **collab-server (:4000)** | Yjs 协同服务端（基于 Hocuspocus），管理文档实时同步与持久化 |
| **convert-server (:4002)** | HTML → docx 转换服务（导出用） |
| **read-server (:4003)** | 后端无头读取 Yjs 文档（列表摘要/检索，二阶段提供） |

---

## 核心能力

### 实时协同编辑

多用户同时编辑同一篇文档，基于 [Yjs](https://yjs.dev/) CRDT 算法实现无冲突合并。每个协作者有独立颜色的光标，实时显示其他人的编辑位置。

### 双模式交互

| 模式 | 适用场景 | 能力 |
| --- | --- | --- |
| **同源直调** | 业务前端配了 nginx 反代，iframe 与父页面同域 | 最强：同步调用，可传对象、拿函数返回值，甚至拿到 Tiptap 底层实例 |
| **跨域 postMessage** | iframe 与父页面不同域，或不配反代 | 通用：异步请求/响应，覆盖取内容/插入/导出/只读切换/书签等 |

### 私有化鉴权

采用 **JWT + API Key 双层鉴权**：

- `UMO_API_KEY`：业务后端持有，用于调引擎 `/api/token` 签发 JWT，**绝不暴露给前端**
- JWT：短时令牌（默认 24h），放进 iframe URL，包含用户名、文档 id、角色（editor/viewer）

### 高保真导出

编辑器在用户打开文档时已将内容渲染为 DOM（图表、公式、视频都在），导出走「前端已渲染的 HTML → convert-server 转 docx」路径，**所见即所得**，保真度极高。

### 文件上传零配置

图片等附件在 embed 模式下直接转 **base64 Data URL 写入 Yjs 文档**，无需配置外部对象存储。文件随文档实时同步，天然支持协同。

---

## 如何使用

接入引擎只需四步：

```
第一步：部署引擎镜像（Docker 启动）
   ↓
第二步：鉴权对接（业务后端代理签发 JWT）
   ↓
第三步：前端 iframe 嵌入（构造 /embed URL）
   ↓
第四步：与编辑器交互（同源直调 或 postMessage）
```

详见 [部署引擎镜像](./installation.md)。

---

## 它适合谁

### 适合

- ✅ 需要在 OA / CMS / 知识库 / 教育平台中加入协同文档编辑
- ✅ 业务系统技术栈不是 Vue 3，或不想维护协同运行时
- ✅ 要求私有化部署（数据不出企业内网）
- ✅ 跨技术栈、低耦合集成（Java/Python/Go 后端 + 任意前端）

### 不适合

- ❌ 需要把编辑器作为 Vue 组件深度定制（自定义 Tiptap 扩展、直接操作 ProseMirror transaction）—— 这应走「组件库集成」模式（npm 包 + 自行编排 Yjs provider），详见 `COLLAB_HANDOFF.md`
- ❌ 需要 Service Worker / PWA 级别的离线编辑（协同依赖 WebSocket 长连接）

---

## 与同类产品对比

| 维度 | Umo Editor Engine | OnlyOffice Document Server | 组件库集成（npm 包） |
| --- | --- | --- | --- |
| 部署方式 | Docker 私有化 | Docker 私有化 | npm 安装 |
| 集成方式 | iframe | iframe | Vue 组件 |
| 业务系统技术栈 | 任意 | 任意 | 必须 Vue 3 |
| 深度定制能力 | 中（直调可拿 Tiptap） | 低 | 高（完全开放） |
| 协同运行时维护 | 引擎托管 | 引擎托管 | 业务自行维护 |
| 交互方式 | 同源直调 + postMessage | postMessage | 直接调用 |

---

## 下一步

- [部署引擎镜像](./installation.md) —— 用 Docker 把引擎跑起来
- [鉴权对接](./authentication.md) —— 业务后端代理签发 JWT
- [前端 iframe 嵌入](./embedding.md) —— 构造 `/embed` URL
- [支持的功能](./features.md) —— 能力总览
