# Umo Editor Engine

> 一个可私有化部署的**实时协同富文本编辑引擎**，以 Docker 镜像交付。业务系统通过 **iframe** 嵌入编辑器，通过**同源直调**或**跨域 postMessage**两种方式交互。对标产品形态：OnlyOffice Document Server（自部署版）。

**中文** | [English](./README.md)

---

## ✨ 核心亮点

- **实时协同编辑** —— 基于 [Yjs](https://yjs.dev/) CRDT 实现无冲突合并，每个协作者有独立颜色的光标，服务端实时持久化（SQLite WAL），刷新页面、重启服务都不丢内容。
- **内置评论功能** —— 选中文字 → 气泡菜单「评论」→ 左侧面板集中管理。评论位置由 Tiptap comment mark 锚定，随 Yjs 协同自动同步；列表更新走 SSE 推送。**无需业务系统提供后端**。
- **技术栈无关** —— 通过 iframe 嵌入任意前端（Vue / React / 原生 HTML），对接任意后端（Java / Python / Go / Node），不强制业务系统引入 Vue 生态依赖。
- **双模式交互** —— 同源直调（`window.__UMO_EDITOR__`）能力最强：同步调用、拿函数返回值，甚至拿到 Tiptap 底层实例；跨域 `postMessage` 通用：异步请求/响应，覆盖取内容/插入/导出/书签/评论等。
- **高保真导出** —— 走前端已渲染的 DOM（图表、公式、视频都在）→ `convert-server` 转 `.docx`，所见即所得。两种方式：工具栏一键下载；或 `postMessage export` 把 docx 直接 POST 推给业务后端 callback。
- **文件上传零配置** —— 图片等附件转 base64 Data URL 写入 Yjs 文档，无需配置外部对象存储（OSS / S3 / MinIO），文件随文档实时同步。
- **私有化部署** —— 数据全部留在企业内网。JWT + API Key 双层鉴权，`UMO_API_KEY` 绝不暴露给浏览器。

---

## 🏗 架构总览

引擎容器对外统一端口 `9999`，前端静态资源挂 `/oes/embed/` 前缀，API/WS 挂 `/oes/*` 前缀：

```
┌─────────────────────────────────────────────────────────────┐
│ 企业业务系统（你的项目）                                       │
│  业务前端                    业务后端                         │
│  ┌───────────┐              ┌──────────────┐               │
│  │ 业务页面   │ ──REST──→   │ 业务后端      │               │
│  │ <iframe>  │             │ 持有 UMO_API_KEY              │ │
│  └─────┬─────┘              └──────┬───────┘               │
│        │ iframe src                │ GET /oes/api/token     │
│        │ /oes/embed?doc=&token=    │ (header: x-api-key)    │
│        ▼                           ▼                        │
└────────┼───────────────────────────┼────────────────────────┘
         │      HTTP/WS              │
         ▼                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Umo Editor Engine 镜像（企业自部署，:9999）                   │
│  nginx                                                        │
│   ├─ /oes/embed        → 纯编辑器页（iframe 着陆页）          │
│   ├─ /oes/embed/*      → 编辑器静态资源                      │
│   ├─ /oes/collab (WS)  → collab-server(:4000) Yjs 协同       │
│   ├─ /oes/api/token    → collab-server JWT 签发（需 API Key） │
│   ├─ /oes/api/convert/ → convert-server(:4002) HTML→docx     │
│   └─ /oes/api/documents|comments/* → collab-server 评论      │
└─────────────────────────────────────────────────────────────┘
```

| 组件 | 端口 | 职责 |
| --- | --- | --- |
| **nginx**（容器内 `:9999`） | 9999 | 引擎统一入口，反代 `/oes/embed`、`/oes/collab`、`/oes/api/*` |
| **collab-server** (`:4000`) | 4000 | Yjs 协同服务端（Hocuspocus），实时同步、SQLite 持久化、评论 API（REST + SSE） |
| **convert-server** (`:4002`) | 4002 | HTML → docx 转换（导出用） |

> 仓库还附带一个 **demo 瘦客户端容器**（`umo-editor-demo`，`:9998`），模拟业务系统（登录 / 文档列表 / 编辑器页），`docker compose up` 一键启动即可体验完整链路。

---

## 🚀 快速开始

### 方式一：docker compose 全栈部署（推荐）

一键启动**引擎 + demo 瘦客户端示例**两个容器：

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

| 容器 | 端口 | 用途 |
| --- | --- | --- |
| `umo-editor-engine` | `9999` | 编辑器引擎（iframe 嵌入目标） |
| `umo-editor-demo` | `9998` | demo 瘦客户端（登录 / 文档列表 / 编辑器） |

- demo 入口：`http://localhost:9998/oes/`（登录后即可体验协同编辑）
- 引擎入口：`http://localhost:9999/oes/embed?doc=<docId>&token=<jwt>`

### 方式二：单独启动引擎

业务系统已就绪、不需要 demo 时：

```bash
docker run -d \
  --name umo-editor \
  -p 9999:9999 \
  -e JWT_SECRET='<强随机密钥，用于签发 JWT>' \
  -e UMO_API_KEY='<强随机密钥，业务后端调 token 接口时带>' \
  -e JWT_EXPIRES_IN=24h \
  -v umo-collab-data:/app/collab-server/data \
  --restart unless-stopped \
  umo-editor-engine:latest
```

### 验证启动

```bash
curl http://localhost:9999/oes/api/health
# { "ok": true, "service": "umo-collab-server" }
```

---

## 🔜 接入只需四步

```
第一步：部署引擎镜像（Docker 启动）
       ↓
第二步：鉴权对接（业务后端代理签发 JWT）
       ↓
第三步：前端 iframe 嵌入（构造 /oes/embed URL）
       ↓
第四步：与编辑器交互（同源直调 或 postMessage）
```

最小 iframe 嵌入示例：

```html
<iframe
  src="http://localhost:9999/oes/embed?doc=doc-123&token=<jwt>"
  width="100%" height="800"
></iframe>
```

---

## 🧩 核心能力

| 能力域 | 说明 |
| --- | --- |
| **协同编辑** | 实时同步、协作者光标、离线重连自动合并、服务端实时持久化 |
| **评论** | 内置（默认开启）、mark 锚定、Yjs 同步、SSE 推送、完整 CRUD、REST 可读、`comments: { enabled: false }` 可关闭 |
| **内容操作** | `getHTML` / `getJSON` / `getText` / `setContent` / `insertContent` / `getImage` / 书签 … |
| **导出** | 工具栏一键导出 Word（零配置），或 `postMessage export` → docx 推送给业务后端 callback |
| **文件上传** | base64 Data URL 写入 Yjs 文档，无需对象存储 |
| **只读与权限** | `mode=view` / `setReadOnly(bool)`（服务端强制）；JWT `role`（`editor` / `viewer`）；viewer 仍可评论 |
| **书签** | `setBookmark` / `focusBookmark` / `getAllBookmarks` / `deleteBookmark` |
| **编辑器 UI** | ribbon 工具栏、page/web 布局、zh-CN / en-US、打印、全屏、主题/皮肤、模板与 @提及经 `config` 下发 |

---

## 🔐 安全模型

双层鉴权，密钥不落地到前端：

- **`UMO_API_KEY`** —— 业务后端持有，用于调 `/oes/api/token` 签发 JWT。**绝不暴露给浏览器**。留空为 dev 无鉴权模式（仅限本地开发，**生产必须配置**）。
- **JWT** —— 短时令牌（默认 `24h`），放进 iframe URL，包含用户名、文档 id、角色（`editor` / `viewer`），由业务后端通过引擎签发。

```bash
# 生成强随机密钥
openssl rand -hex 32
```

---

## 📦 仓库结构

```
online-edit-sync/
├── docker/          # Dockerfile、docker-compose.yml、nginx/supervisor 配置
├── collab-server/   # Yjs 协同服务（Hocuspocus）+ 评论 API
├── convert-server/  # HTML → docx 转换服务
├── embed/           # /oes/embed 编辑器前端（iframe 目标）
├── demo/            # 瘦客户端示例：登录 / 文档列表 / 编辑器页
├── deploy/          # 部署辅助脚本
├── docs/            # 完整文档（中文）
└── src/             # @umoteam/editor 组件库源码
```

---

## 📚 文档

完整文档位于 [`docs/`](./docs) 目录。核心入口：

**入门**
- [概述](./docs/get-started/overview.md) —— 是什么、架构、核心能力
- [部署引擎镜像](./docs/get-started/installation.md) —— Docker 启动、环境变量、数据持久化
- [鉴权对接](./docs/get-started/authentication.md) —— JWT 签发、角色与权限
- [前端 iframe 嵌入](./docs/get-started/embedding.md) —— URL 参数、config 协议、token 过期
- [支持的功能](./docs/get-started/features.md) —— 协同、评论、导出、上传、书签

**API 参考**
- [同源直调 API](./docs/api-reference/same-origin-api.md) —— `window.__UMO_EDITOR__` 全部方法
- [postMessage 协议](./docs/api-reference/postmessage-protocol.md) —— 跨域消息协议
- [服务端接口](./docs/api-reference/server-api.md) —— `/oes/api/token`、`/oes/api/convert`、`/oes/collab`、评论 API
- [导出与文件回传](./docs/api-reference/export.md) —— 工具栏下载 vs 推送给后端（方案 B3）
- [nginx 同域反代配置](./docs/api-reference/nginx-reverse-proxy.md) —— 单域名子路径部署模板

**示例**
- [最小可用集成（跨域）](./docs/samples/minimal-cross-domain.md) —— 纯 postMessage，不配反代
- [强交互集成（同源）](./docs/samples/full-same-origin.md) —— nginx 反代 + 同源直调完整示例
- [瘦客户端示例项目](./docs/samples/demo-project.md) —— 可运行的 `demo/` 目录说明

---

## 🆚 与同类产品对比

| 维度 | Umo Editor Engine | OnlyOffice DS | 组件库集成（npm 包） |
| --- | --- | --- | --- |
| 部署方式 | Docker 私有化 | Docker 私有化 | npm 安装 |
| 集成方式 | iframe | iframe | Vue 组件 |
| 业务系统技术栈 | 任意 | 任意 | 必须 Vue 3 |
| 深度定制能力 | 中（直调可拿 Tiptap） | 低 | 高（完全开放） |
| 协同运行时维护 | 引擎托管 | 引擎托管 | 业务自行维护 |

---

## 📄 开源协议

[MIT](./LICENSE)
