# 瘦客户端示例项目

> 仓库 `demo/` 目录是一个**完整可运行**的瘦客户端示例，演示业务系统如何用 iframe 接引擎，含登录、文档列表、编辑器页 + 四类交互演示。也可以用 `docker compose` 一键把它作为容器跑起来（`umo-editor-demo`，:9998）。

---

## 它是什么

`demo/` 是一个**不打包进引擎镜像**的独立前端+后端项目，模拟「业务系统」的角色：

- 含登录页、文档列表页、编辑器页、文档查看页
- 通过 iframe 嵌入引擎的 `/oes/embed` 页
- 演示四类交互：**同源直调**、**postMessage**、**导出回传**、**鉴权对接**
- 有自己的后端（`demo/server/`），代理签发 JWT + 接收导出文件

> 引擎镜像里**没有**文档列表/登录页——这些是业务系统自己的职责。引擎只管「编辑这一篇文档时的实时协同」。`demo/` 补齐了「业务系统」这一角色。

---

## 目录结构

```
demo/
├── src/
│   ├── main.js                  # 应用入口（注册路由 + TDesign UI）
│   ├── App.vue
│   ├── router/index.js          # 路由（/login /documents /editor /docs）
│   ├── views/
│   │   ├── LoginView.vue        # 登录页（用户名 + 角色）
│   │   ├── DocumentsView.vue    # 文档列表页（卡片网格，新建/删除）
│   │   ├── EditorView.vue       # 编辑器页（核心：iframe 嵌入 + 交互演示）
│   │   └── DocsView.vue         # 文档查看页（只读打开）
│   ├── store/
│   │   ├── auth.js              # 登录态（localStorage）
│   │   └── documents.js         # 文档列表（REST → 示例后端）
│   ├── utils/
│   │   ├── api.js               # 业务后端 REST 客户端（fetchDocToken 等）
│   │   ├── engine-config.js     # 引擎地址解析 + /oes/embed URL 构造
│   │   └── collab-config.js     # 协同服务地址解析（独立使用引擎时用）
│   └── composables/useToast.js
├── server/
│   ├── index.js                 # 业务后端（文档元数据 + 代理签 JWT + 接收导出 + 评论参考实现）
│   ├── comments.js              # 评论后端参考实现（业务系统自建评论后端的示例，demo 前端用引擎内置评论）
│   ├── config.json              # 本地配置（port / engineUrl / apiKey / receiveKey）
│   └── config.example.json      # 配置模板
├── docker/                      # demo 容器构建（Dockerfile / nginx.conf / supervisord.conf / entrypoint.sh）
├── vite.config.js               # dev 端口 5173
└── README.md
```

---

## 核心文件说明

### `src/utils/engine-config.js`

引擎地址解析与 iframe URL 构造。可直接复用到你的项目：

```js
// 运行时覆盖引擎地址（优先级：__UMO_CONFIG__.engineUrl > __UMO_ENGINE_URL__ > 默认）
window.__UMO_CONFIG__ = { engineUrl: 'http://editor-host:9999/oes' }
// 或反代同源前缀（带 /oes）
window.__UMO_ENGINE_URL__ = '/oes'

import { getEngineUrl, getEmbedUrl } from '@/utils/engine-config'
const url = getEmbedUrl('doc-123', '<jwt>', 'edit', 'zh-CN', '我的文档')
// → "http://editor-host:9999/oes/embed?doc=doc-123&token=...&mode=edit&lang=zh-CN&title=..."
```

> 引擎地址必须带 **`/oes` 前缀**且**不要**带 `/embed`（`getEmbedUrl` 自动拼）。

### `src/views/EditorView.vue`

编辑器页核心，演示完整的接入流程：

1. 打开文档：调业务后端拿 token → 构造 iframe URL（`/oes/embed`）
2. 监听 `request-config` → 回传业务配置（模板 / @提及用户 / 书签显示）
3. 监听 `ready` 消息感知编辑器就绪
4. **同源直调演示**：`iframe.contentWindow.__UMO_EDITOR__.getHTML()`
5. **postMessage 演示**：`pmGetContent()` / `pmInsertContent()`
6. **导出演示**：`exportDocx()` → 方案 B3 文件回传
7. **鉴权演示**：重新签发 JWT

### `server/index.js`

业务后端，关键接口：

- `POST /api/doc-token` — 代理调引擎 `/oes/api/token` 签 JWT
- `POST /api/receive-doc` — 接收导出的 docx 文件（存盘 + 返回下载链接）
- `GET/POST /api/documents`、`GET/DELETE /api/documents/:id` — 文档元数据 CRUD
- `GET /api/files/:name` — 提供回传文件的下载
- 评论路由（`comments.js`）— 业务系统自建评论后端的参考实现

---

## 运行示例

### 方式一：Docker 容器（推荐，无需 Node 环境）

```bash
cd 仓库根目录
docker compose -f docker/docker-compose.yml up -d --build
# 浏览器访问 http://localhost:9998/oes/demo/（登录 → 文档列表 → 打开文档）
```

demo 容器环境变量（可选）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `UMO_ENGINE_URL` | `http://umo-editor-engine:9999/oes` | demo 后端 → 引擎（容器内通信） |
| `UMO_ENGINE_PUBLIC_URL` | `http://localhost:9999/oes` | **浏览器**访问引擎的地址（iframe 用，自动拼 /embed）。远程部署改成 `http://<IP>:9999/oes` |
| `UMO_API_KEY` | 空 | 与引擎一致，代理签 JWT 时带 |
| `BIZ_RECEIVE_KEY` | 空 | 接收导出文件的鉴权 key |

> 部署后改引擎地址无需重新构建镜像：改 `.env` 的 `UMO_ENGINE_PUBLIC_URL`，重启 demo 容器即可（entrypoint 启动时重新生成 `config.js`）。

### 方式二：本地源码运行（开发）

```bash
# 1. 引擎镜像已启动（见 部署引擎镜像），或本地起 collab-server(4000) + convert-server(4002)

# 2. 启动业务后端（代理签 JWT + 接收导出）
cd demo/server
npm install
npm start            # http://localhost:4001
# 配置：编辑 config.json，或用环境变量 UMO_ENGINE_URL / UMO_API_KEY / PORT 覆盖

# 3. 启动业务前端
cd demo
npm install
npm run dev          # http://localhost:5173
```

`demo/server/config.json` 配置字段：

| 字段 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `port` | `PORT` | `4001` | 业务后端端口 |
| `engineUrl` | `UMO_ENGINE_URL` | `http://localhost:9999/oes` | 引擎地址（**带 /oes 前缀**） |
| `apiKey` | `UMO_API_KEY` | 空 | 引擎 API Key（与引擎一致；引擎 dev 模式可留空） |
| `receiveKey` | `BIZ_RECEIVE_KEY` | 空 | 接收导出文件的鉴权 key |

---

## 照抄到你的项目

`demo/` 的代码可直接复制到你的业务系统，根据实际情况调整：

| 文件 | 用途 | 是否可直接复用 |
| --- | --- | --- |
| `src/utils/engine-config.js` | 引擎地址 + URL 构造 | ✅ 直接复用 |
| `src/utils/api.js` | 业务后端 REST 客户端 | ⚠️ 改接口地址 |
| `src/views/EditorView.vue` | 编辑器页 + 交互演示（含 config 下发） | ⚠️ 提取 iframe 部分复用 |
| `server/index.js` | 代理签 JWT + 接收导出 | ⚠️ 改语言（如 Java/Python） |
| `server/comments.js` | 评论后端参考实现 | ⚠️ 引擎已内置评论，一般不需要 |

---

## 下一步

- [前端 iframe 嵌入](../get-started/embedding.md)
- [同源直调 API](../api-reference/same-origin-api.md)
- [postMessage 协议](../api-reference/postmessage-protocol.md)
