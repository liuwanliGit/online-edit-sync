# Umo Editor 瘦客户端示例

演示**业务系统如何通过 iframe 嵌入 Umo Editor 引擎**，实现协同编辑。

这是一个**瘦客户端**：不包含编辑器组件、不包含协同运行时（无 `@tiptap/*` / `yjs` / `@hocuspocus/provider` 等依赖），编辑器完全由引擎镜像的 `/embed` 页面提供，本示例只演示接入方真实要做的事。

> 完整接入文档见仓库根目录 `EMBED_INTEGRATION_GUIDE.md`。

## 架构

```
┌──────────────────────────────────────────────────────┐
│ 示例（本目录）= 业务系统的缩影                          │
│                                                      │
│  示例前端 (5173)              示例后端 (4001)          │
│  ┌──────────┐  ┌──────────┐   ┌──────────────┐        │
│  │ 登录/列表 │  │ <iframe> │   │ 文档元数据    │        │
│  │          │  │  src=    │   │ + /api/doc-  │        │
│  │          │  │  embed   │   │   token(代签) │        │
│  │          │  │          │   │ + /api/      │        │
│  │          │  └────┬─────┘   │   receive-doc │        │
│  └──────────┘       │         └──────┬───────┘        │
└─────────────────────┼────────────────┼────────────────┘
                      │ iframe src      │ GET /api/token
                      ▼                ▼
┌──────────────────────────────────────────────────────┐
│ Umo Editor 引擎镜像 (9999)  ← 先启动这个              │
│  nginx → /embed 纯编辑器页 + /collab WS + /api/*     │
└──────────────────────────────────────────────────────┘
```

- **示例前端**（`demo/src/`）：登录、文档列表、编辑器页（iframe 嵌入引擎 + 四类交互演示）
- **示例后端**（`demo/server/`）：文档元数据 REST + 代理签 JWT + 接收导出文件（演示业务后端职责）
- **引擎镜像**：私有化部署的编辑器引擎，独立启动，不含 demo

## 前置条件

### 1. 启动引擎镜像

```bash
# 在仓库根目录
bash docker/build.sh up        # Linux/macOS
# 或 Windows:
docker\build.bat

# 验证
curl http://localhost:9999/api/health    # → {"ok":true,...}
```

> 引擎镜像启动后，`/embed` 纯编辑器页即可通过 iframe 嵌入。详见 `docker/README.md`。

### 2. 启动示例后端

```bash
cd demo/server
npm install
npm start          # http://localhost:4001
```

环境变量（可选）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `4001` | 示例后端端口 |
| `UMO_ENGINE_URL` | `http://localhost:9999` | 引擎地址（代理签 JWT 时调） |
| `UMO_API_KEY` | 空 | 引擎 `/api/token` 的凭据（与引擎启动时一致；引擎 dev 模式可留空） |
| `BIZ_RECEIVE_KEY` | 空 | 接收导出文件的鉴权 key（前端透传；留空不校验） |

## 启动示例前端

```bash
cd demo
npm install
npm run dev          # http://localhost:5173
```

登录页输入用户名、选择角色即可进入文档列表。

> 示例前端**不需要**构建上层编辑器库（不再通过 `file:..` 引用 `@umoteam/editor`），依赖极轻。

## 配置引擎地址

默认指向 `http://localhost:9999`。部署到生产时，在 `index.html` 加载前端前设置全局变量即可，无需重新构建：

```html
<script>
  // 引擎地址（iframe src、token 代理调）
  window.__UMO_ENGINE_URL__ = 'http://editor-host:9999'
  // 示例后端地址（文档元数据 REST）
  window.__UMO_API_URL__ = 'http://localhost:4001'
</script>
```

**反代同源时**（业务系统 nginx 把引擎反代到 `/editor/` 子路径）：

```js
window.__UMO_ENGINE_URL__ = '/editor'    // iframe 与父页面同域，可走同源直调
```

## 四类交互演示

打开任意文档后，右侧面板展示四个核心接入场景（对应 `EMBED_INTEGRATION_GUIDE.md` 第三~五节）：

### 1. 鉴权对接（业务后端代理签 JWT）

前端不直接调引擎 `/api/token`（需 API Key，不能暴露给前端），而是调示例后端 `/api/doc-token`，后端持 `UMO_API_KEY` 代签 JWT，前端只拿到短时 JWT 放进 iframe URL。

### 2. 同源直调（同步取内容）

配 nginx 反代后 iframe 与父页面同源，可直接调 `iframe.contentWindow.__UMO_EDITOR__.getHTML()` 同步取值。

> 跨域时此按钮会报错（预期行为），请用场景 3 的 postMessage。

### 3. 跨域 postMessage

不配反代时用 postMessage（异步请求/响应）。演示 `getContent`（取内容）和 `insertContent`（插入段落）。

### 4. 导出 Word（方案 B3 回传）

点按钮 → iframe 内转 docx → 直接 POST 推给示例后端 `/api/receive-doc` → 后端存盘返回下载链接。

> 这就是方案 B3 的核心：不让后端「凭地址取」前端内存里的 Blob（取不到），而是由 iframe 直接把文件推给业务后端。

## 目录结构

```
demo/
├── package.json          # 依赖极轻：vue + tdesign + vue-router
├── vite.config.js        # 无 dedupe / optimizeDeps（不含协同运行时）
├── index.html
├── server/               # 示例后端（演示业务后端职责）
│   ├── package.json      #   deps: better-sqlite3, uuid, busboy
│   ├── index.js          #   文档元数据 REST + /api/doc-token + /api/receive-doc
│   └── data/             #   SQLite + 回传文件（gitignore）
└── src/
    ├── main.js           # 注册 router + TDesign（不注册编辑器组件）
    ├── App.vue
    ├── router/index.js
    ├── store/
    │   ├── auth.js       # 用户名/角色（localStorage）
    │   └── documents.js  # 文档 CRUD（REST → 示例后端）
    ├── utils/
    │   ├── api.js        # 示例后端 REST 客户端 + fetchDocToken
    │   └── engine-config.js  # 引擎地址解析 + /embed URL 构造
    ├── composables/useToast.js
    ├── styles/global.css
    └── views/
        ├── LoginView.vue        # 登录页（用户名 + 角色）
        ├── DocumentsView.vue    # 文档列表（卡片网格）
        └── EditorView.vue       # 编辑器页（iframe + 四类交互演示）
```

## 与引擎的关系

| 维度 | 示例（本目录） | 引擎镜像 |
|---|---|---|
| 编辑器 | iframe 引用引擎 `/embed` | 提供编辑器 + 协同运行时 |
| 协同依赖 | 无（零 `@tiptap`/`yjs`/`@hocuspocus`，仅 vue+tdesign+router） | 全部在内 |
| 打包 | 仅源码，不进 Dockerfile | 单镜像交付 |
| 职责 | 演示业务系统接入 | 提供编辑能力 |

## 体验多用户协同

1. 启动引擎镜像 + 示例后端 + 示例前端
2. 浏览器窗口 A：用户名「张三」、角色「编辑者」→ 新建文档「会议纪要」
3. 浏览器窗口 B（或无痕窗口）：用户名「李四」、角色「编辑者」→ 列表里能看到「会议纪要」
4. 两人都打开它 → 输入实时同步，对方光标带颜色和名字

> 协同能力由引擎 collab-server 提供，示例前端只管 iframe 嵌入和交互，不碰 Yjs。
