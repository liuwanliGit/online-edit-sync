# Umo Editor 宿主应用 Demo

一个展示如何把 `@umoteam/editor` 集成到真实业务里的示例。支持**单机模式**和**协同模式**两种工作方式：

- **单机模式**：文档存在本浏览器（localStorage），开箱即用，零后端依赖
- **协同模式**：多人共享文档列表 + 实时协同编辑（A 建的文档 B 立刻能看到、能同时编辑）

## 架构

```
┌─────────────┐   REST(文档元数据)    ┌──────────────┐
│  demo 前端   │ ───────────────────→ │  demo 后端    │  demo/server：列表/创建/删除
│ (Vue3+Vite) │                      │ (Node+SQLite) │  存 id/title/createdBy/时间戳
│             │   WebSocket(Yjs协同)  ├──────────────┤
│             │ ───────────────────→ │ collab-server │  上层仓库自带：Yjs 实时同步+blob持久化
└─────────────┘                      └──────────────┘
```

- **demo 后端**（`demo/server`）：本 demo 自建，**只管文档元数据**（列表/创建/删除）
- **collab-server**（上层仓库 `collab-server/`）：**只管 Yjs 实时协同**（多人光标、内容同步、二进制持久化）
- **关联点**：demo 后端创建文档时生成的 uuid，同时作为 collab-server 的 Yjs 文档名，两边通过 uuid 关联

## 功能

- 🔐 **登录**：输入用户名，选择角色（编辑者/只读者）+ 编辑模式（单机/协同）
- 📄 **文档列表**：卡片网格、相对时间、新建/删除（二次确认）
- ✍️ **文档编辑**：嵌入 `<umo-editor>`，类 Word 富文本、分页排版、工具栏
- 🔒 **角色权限**：只读者打开文档为只读模式
- 🤝 **协同模式**：多人共享文档列表、实时同步编辑内容、彩色光标显示协作者
- 💾 **持久化**：单机模式写 localStorage；协同模式由后端 + collab-server 持久化

## 启动

### 方式一：单机模式（最简单，无需后端）

```bash
cd demo
npm install
npm run dev          # http://localhost:5173/
```

登录页选择「单机模式」即可。文档存在本浏览器。

### 方式二：协同模式（需启动两个服务）

需要三个进程：协同服务 + demo 后端 + 前端。

```bash
# 终端 1：协同服务（上层仓库自带，负责 Yjs 实时同步）
cd D:\workspace\editor\collab-server
npm install        # 首次
npm start          # ws://localhost:4000

# 终端 2：demo 后端（本 demo 自建，负责文档元数据）
cd D:\workspace\editor\demo\server
npm install        # 首次
npm start          # http://localhost:4001

# 终端 3：demo 前端
cd D:\workspace\editor\demo
npm install
npm run dev        # http://localhost:5173/
```

登录页选择「协同模式」即可。打开两个浏览器窗口，分别用不同用户名登录协同模式，即可看到：
- 用户 A 新建的文档，用户 B 的列表里立刻出现
- 两人同时打开同一篇文档，输入实时同步、光标互相可见

> **前置条件**：上层仓库需先构建过编辑器产物（`npm run build` 生成 `dist/`），demo 通过 `file:..` 引用它。

## 体验多用户协同

1. 启动上述三个服务
2. 浏览器窗口 A：用户名「张三」、角色「编辑者」、模式「协同」→ 新建文档「会议纪要」
3. 浏览器窗口 B（或无痕窗口）：用户名「李四」、角色「编辑者」、模式「协同」→ **列表里能看到「会议纪要」**
4. 两人都打开它 → 输入实时同步，对方光标带颜色和名字

## 目录结构

```
demo/
├── package.json              # @umoteam/editor 走 file:.. 引用本地仓库
├── vite.config.js
├── index.html
├── server/                   # demo 自建后端：文档元数据管理
│   ├── package.json          #   deps: better-sqlite3, uuid
│   ├── index.js              #   http 服务 + SQLite + REST 路由（端口 4001）
│   └── data/                 #   SQLite 数据（gitignore）
└── src/
    ├── main.js               # 注册 router + TDesign + useUmoEditor
    ├── App.vue
    ├── router/index.js       # 路由表 + 登录守卫
    ├── store/
    │   ├── auth.js           # 用户名/角色/模式（localStorage）
    │   └── documents.js      # 文档 CRUD（双模式：localStorage / REST）+ uuid + 摘要/相对时间
    ├── utils/
    │   ├── api.js            # demo 后端 REST 客户端（:4001）
    │   └── collab-config.js  # 协同服务地址解析（指向 collab-server :4000）
    ├── composables/useToast.js
    ├── styles/global.css
    └── views/
        ├── LoginView.vue        # 登录页（用户名 + 角色 + 模式选择）
        ├── DocumentsView.vue    # 文档列表（双模式）
        └── EditorView.vue       # 编辑器页（单机 localStorage / 协同 Yjs+Hocuspocus）
```

## 关键集成点

### 1. 注册编辑器（`src/main.js`）

```js
import { useUmoEditor } from '@umoteam/editor'
import '@umoteam/editor/style'
app.use(useUmoEditor, {})
```

### 2. 协同模式编辑器（`src/views/EditorView.vue`）

核心：建立 Yjs 文档 + HocuspocusProvider，注入 `Collaboration` 扩展，禁用内置 `undoRedo`：

```js
const ydoc = new Y.Doc()
const provider = new HocuspocusProvider({
  url: getCollabWsUrl(),          // ws://localhost:4000
  name: docId,                    // = 文档 uuid，与 demo 后端主键一致
  document: ydoc,
  token: async () => { /* fetch collab-server /api/token */ },
})

// 注入协同扩展 + 远程光标，禁用 undoRedo（改用 Yjs 撤销栈）
umo-editor :extensions="[Collaboration, 光标]" :disable-extensions="['undoRedo']"
```

完整实现（含预填空段落修初始竞争、只读权限、连接态）见 `EditorView.vue`。

## 运行时配置（可选）

部署到生产时，无需重新构建，在加载前端前设置全局变量即可指向各自服务：

```js
window.__UMO_API_URL__    = 'https://api.your-domain.com'     // demo 后端（REST）
window.__UMO_COLLAB_URL__ = 'wss://collab.your-domain.com'    // 协同服务（WebSocket）
```

不设置时分别兜底 `http://localhost:4001` / `ws://localhost:4000`。

## 清空数据

```js
// 单机模式
localStorage.removeItem('umo-demo:auth')
localStorage.removeItem('umo-demo:documents')
// 协同模式：删除 demo/server/data/docs.db 后重启 demo 后端
```

## 说明

- 协同模式需同时启动 collab-server（:4000）和 demo 后端（:4001），缺一不可。
- 协同文档的标题在创建时确定（不在编辑器内同步元数据），内容则实时协同。
- 这是一份 demo，登录不经过鉴权服务，角色/权限仅在前端 + collab-server 的 JWT 层面生效。
