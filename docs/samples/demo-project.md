# 瘦客户端示例项目

> 仓库 `demo/` 目录是一个**完整可运行**的瘦客户端示例，演示业务系统如何用 iframe 接引擎，含登录、文档列表、编辑器页 + 四类交互演示。

---

## 它是什么

`demo/` 是一个**不打包进引擎镜像**的独立前端项目，模拟「业务系统」的角色：

- 含登录页、文档列表页、编辑器页
- 通过 iframe 嵌入引擎的 `/embed` 页
- 演示四类交互：**同源直调**、**postMessage**、**导出回传**、**鉴权对接**
- 有自己的后端（`demo/server/`），代理签发 JWT + 接收导出文件

> 引擎镜像里**没有**文档列表/登录页——这些是业务系统自己的职责。引擎只管「编辑这一篇文档时的实时协同」。`demo/` 补齐了「业务系统」这一角色。

---

## 目录结构

```
demo/
├── src/
│   ├── main.js                  # 应用入口（注册路由 + TDesign UI）
│   ├── views/
│   │   ├── LoginView.vue        # 登录页
│   │   ├── DocumentsView.vue    # 文档列表页
│   │   └── EditorView.vue       # 编辑器页（核心：iframe 嵌入 + 交互演示）
│   ├── store/
│   │   ├── auth.js              # 登录态
│   │   └── documents.js         # 文档列表
│   └── utils/
│       ├── api.js               # 业务后端 REST 客户端
│       └── engine-config.js     # 引擎地址解析 + iframe URL 构造
├── server/
│   └── index.js                 # 业务后端（代理签 JWT + 接收导出）
├── package.json
└── README.md
```

---

## 核心文件说明

### `src/utils/engine-config.js`

引擎地址解析与 iframe URL 构造。可直接复用到你的项目：

```js
// 运行时覆盖引擎地址（无需重新构建）
window.__UMO_ENGINE_URL__ = 'http://editor-host:9999'
// 或反代同源前缀
window.__UMO_ENGINE_URL__ = '/editor'

import { getEngineUrl, getEmbedUrl } from '@/utils/engine-config'
const url = getEmbedUrl('doc-123', '<jwt>', 'edit', 'zh-CN')
```

### `src/views/EditorView.vue`

编辑器页核心（719 行），演示完整的接入流程：

1. 打开文档：调业务后端拿 token → 构造 iframe URL
2. 监听 `ready` 消息感知编辑器就绪
3. **同源直调演示**：`iframe.contentWindow.__UMO_EDITOR__.getHTML()`
4. **postMessage 演示**：`pmGetContent()` / `pmInsertContent()`
5. **导出演示**：`exportDocx()` → 方案 B3 文件回传
6. **鉴权演示**：`refreshToken()` 重新签 JWT

### `server/index.js`

业务后端，两个关键接口：

- `GET /api/doc-token` — 代理调引擎 `/api/token` 签 JWT
- `POST /api/receive-doc` — 接收导出的 docx 文件

---

## 运行示例

### 前置条件

1. 引擎镜像已启动（见 [部署引擎镜像](../get-started/installation.md)）

   ```bash
   docker run -d --name umo-editor -p 9999:9999 \
     -e JWT_SECRET='<密钥>' -e UMO_API_KEY='<密钥>' \
     umo-editor-engine:latest
   ```

2. Node.js 18+

### 启动步骤

```bash
# 1. 启动业务后端（代理签 JWT + 接收导出）
cd demo/server
npm install
# 配置引擎地址和 API Key（编辑 .env 或环境变量）
export UMO_ENGINE_URL=http://localhost:9999
export UMO_API_KEY=<启动引擎时设的 UMO_API_KEY>
npm start

# 2. 启动业务前端
cd demo
npm install
npm run dev
```

### 配置

业务前端通过环境变量或全局变量指定引擎地址：

```js
// demo/vite.config.js 或运行时
window.__UMO_ENGINE_URL__ = 'http://localhost:9999'
```

业务后端（`demo/server/`）通过环境变量配置：

| 变量 | 说明 |
| --- | --- |
| `UMO_ENGINE_URL` | 引擎地址（如 `http://localhost:9999`） |
| `UMO_API_KEY` | 引擎的 API Key（与引擎镜像的 `UMO_API_KEY` 一致） |
| `PORT` | 业务后端端口（默认 3000） |

---

## 照抄到你的项目

`demo/` 的代码可直接复制到你的业务系统，根据实际情况调整：

| 文件 | 用途 | 是否可直接复用 |
| --- | --- | --- |
| `src/utils/engine-config.js` | 引擎地址 + URL 构造 | ✅ 直接复用 |
| `src/utils/api.js` | 业务后端 REST 客户端 | ⚠️ 改接口地址 |
| `src/views/EditorView.vue` | 编辑器页 + 交互演示 | ⚠️ 提取 iframe 部分复用 |
| `server/index.js` | 代理签 JWT + 接收导出 | ⚠️ 改语言（如 Java/Python） |

---

## 下一步

- [前端 iframe 嵌入](../get-started/embedding.md)
- [同源直调 API](../api-reference/same-origin-api.md)
- [postMessage 协议](../api-reference/postmessage-protocol.md)
