# 评论功能内置于编辑器引擎 — 详细设计方案

> **状态：已实现（2026-08）**。本页为设计文档，记录了目标架构与实施步骤；实施结果与本文的设计存在少量差异，见文末 [实现现状与设计差异](#八实现现状与设计差异)。
> 使用层面的说明见 [支持的功能 - 评论](./get-started/features.md) 与 [服务端接口 - 评论 API](./api-reference/server-api.md)。

## 一、目标

将评论功能从 embed 瘦客户端移入编辑器引擎（`@umoteam/editor`），使其成为编辑器的内置功能：
- 评论 UI（气泡按钮、左侧面板、状态栏入口）全部在引擎 `src/` 内
- 评论存储由引擎的 `collab-server` 提供（独立的 `comments.db`）
- 业务系统零配置即可使用评论功能
- 不需要评论的业务系统可通过 `comments: { enabled: false }` 关闭
- 业务系统可通过 REST API 读取评论数据（只读口子）

## 二、当前架构 vs 目标架构

> 2026-08 该迁移已完成：embed 瘦客户端的评论代码已删除，评论功能由引擎内置提供。下方「目标架构」即当前实现。

### 当前架构

```
┌─ 引擎 src/ @umoteam/editor ──────────────────────────┐
│  纯前端编辑器库，无评论功能                             │
│  扩展点：extensions prop、#bubble_menu slot            │
└──────────────────────────────────────────────────────┘
         ↑ 通过 slot/extension 扩展
┌─ embed/src/ 瘦客户端 ────────────────────────────────┐
│  Comment mark 扩展、BubbleButton、CommentSidebar      │
│  useComments（调 demo 后端 REST+SSE）                  │
│  💬 FAB 浮动按钮                                       │
└──────────────────────────────────────────────────────┘
         ↑ HTTP API
┌─ demo/server/comments.js 业务后端 ────────────────────┐
│  SQLite 评论表 + REST CRUD + SSE                       │
└──────────────────────────────────────────────────────┘
```

### 目标架构

```
┌─ 引擎 src/ @umoteam/editor ──────────────────────────┐
│  内置评论功能（默认开启，可通过 option 关闭）            │
│  · src/extensions/comment/     → Comment mark + 高亮   │
│  · src/components/comment/     → 左侧面板、表单、气泡   │
│  · src/composables/useComments → 状态管理（调引擎API）  │
│  · options.comments            → 配置开关               │
│  · 状态栏评论入口                                      │
└──────────────────────────────────────────────────────┘
         ↑ HTTP API（引擎内部同源调用）
┌─ collab-server/ 引擎服务 ────────────────────────────┐
│  新增 comment-storage.js（独立 comments.db）           │
│  新增 REST 路由：/api/documents/:docId/comments/*      │
│  新增 SSE 推送                                         │
└──────────────────────────────────────────────────────┘
         ↑ 只读 API（业务系统可选调用）
┌─ 业务系统 ────────────────────────────────────────────┐
│  GET /api/documents/:docId/comments → 读取评论列表     │
│  或者完全不关心评论                                    │
└──────────────────────────────────────────────────────┘

embed/src/ 瘦客户端：
  删除所有评论代码，评论功能由引擎内置提供
```

## 三、文件改动清单

### 3.1 新增文件

#### 引擎前端 `src/`

| 文件 | 说明 |
|------|------|
| `src/extensions/comment/index.js` | Comment Mark 扩展（从 `embed/src/extensions/comment-mark.js` 移入） |
| `src/extensions/comment/highlight.js` | CommentHighlight 高亮扩展（从 `embed/src/extensions/comment-highlight.js` 移入） |
| `src/components/comment/sidebar.vue` | 左侧评论面板（从 `embed/src/components/comment/CommentSidebar.vue` 移入并改造） |
| `src/components/comment/form.vue` | 评论/回复表单（从 `embed/src/components/comment/CommentForm.vue` 移入） |
| `src/composables/comment.js` | 评论状态管理（从 `embed/src/composables/useComments.js` 移入并改造） |

#### 引擎服务 `collab-server/`

| 文件 | 说明 |
|------|------|
| `collab-server/comment-storage.js` | 评论 SQLite 存储层（独立 `comments.db`），从 `demo/server/comments.js` 提取核心逻辑 |

#### 文档

| 文件 | 说明 |
|------|------|
| `docs/comment-builtin-design.md` | 本文档 |

### 3.2 修改文件

#### 引擎前端 `src/`

| 文件 | 改动 |
|------|------|
| `src/extensions/index.js` | 在 `getDefaultExtensions` 中注册 Comment mark + CommentHighlight |
| `src/components/index.vue` | 注册 comment 状态 provide；将 Comment mark 加入默认 extensions；暴露 `getComments()` 方法 |
| `src/components/container/page.vue` | 新增左侧评论面板，与 TOC 同侧并列（上下排列） |
| `src/components/statusbar/index.vue` | 新增评论按钮（状态栏左区，显示评论数 badge，点击开关面板） |
| `src/components/menus/bubble/menus.vue` | 在气泡菜单末尾内置"评论"按钮（不再依赖 slot 注入） |
| `src/options/config/index.js` | 新增 `comments: { enabled: true, apiBase: '' }` 默认配置 |
| `src/options/schema.js` | 新增 `comments` 选项验证 |
| `src/locales/zh_CN.js` | 新增评论相关文案 |
| `src/locales/en_US.js` | 新增评论相关文案 |

#### 引擎服务 `collab-server/`

| 文件 | 改动 |
|------|------|
| `collab-server/server.js` | `onRequest` hook 新增评论 REST 路由 + SSE |
| `collab-server/package.json` | 新增 `uuid` 依赖（如需服务端生成 id） |

#### Docker 配置

| 文件 | 改动 |
|------|------|
| `docker/nginx.conf` | 新增 `/oes/api/documents/` 反代到 collab-server（评论 REST+SSE） |
| `docker/Dockerfile` | 确保 collab-server 新增依赖被安装 |

#### embed 瘦客户端

| 文件 | 改动 |
|------|------|
| `embed/src/App.vue` | **删除**所有评论相关代码（Comment mark 注册、BubbleButton、CommentSidebar、useComments、FAB、CSS），评论功能由引擎内置提供 |
| `embed/src/extensions/comment-mark.js` | **删除**（移入引擎） |
| `embed/src/extensions/comment-highlight.js` | **删除**（移入引擎） |
| `embed/src/components/comment/` | **删除整个目录**（移入引擎） |
| `embed/src/composables/useComments.js` | **删除**（移入引擎） |

#### demo 示例

| 文件 | 改动 |
|------|------|
| `demo/server/comments.js` | **保留**（业务系统自建评论后端的参考实现），但不再被 embed 调用 |
| `demo/src/views/EditorView.vue` | 移除 `commentApiBase` 下发（引擎自带评论） |

## 四、详细设计

### 4.1 数据结构

#### 评论对象（前端 + API 通用）

```typescript
interface Comment {
  id: string             // UUID，与 comment mark 的 commentId 一致
  docId: string          // 文档 ID（Yjs documentName）
  selectedText: string   // 被评论文字的快照（max 2000 字符）
  author: {
    id: string           // 用户 ID
    name: string         // 显示名
    color: string        // 头像/光标颜色
  }
  content: string        // 评论内容（max 8000 字符）
  createdAt: number      // 创建时间（epoch ms）
  resolved: boolean      // 是否已解决
  replies: Array<{       // 回复列表
    id: string
    author: Author
    content: string
    createdAt: number
  }>
}
```

#### SQLite 表结构（`comments.db`）

```sql
CREATE TABLE IF NOT EXISTS comments (
  id            TEXT PRIMARY KEY,         -- 客户端生成 UUID（= mark commentId）
  doc_id        TEXT NOT NULL,            -- 文档 ID
  selected_text TEXT,                     -- 被评论文字快照
  author_json   TEXT,                     -- JSON: { id, name, color }
  content       TEXT,                     -- 评论内容
  created_at    INTEGER NOT NULL,         -- 创建时间
  resolved      INTEGER NOT NULL DEFAULT 0, -- 是否已解决
  replies_json  TEXT NOT NULL DEFAULT '[]' -- JSON: 回复数组
);

CREATE INDEX IF NOT EXISTS idx_comments_doc ON comments(doc_id);
```

> 注：不再需要 `from_pos` / `to_pos` / `status` 列——位置由 Tiptap comment mark 锚定。

### 4.2 REST API 设计

所有路由挂载在 `collab-server` 的 `onRequest` hook 中，nginx 透传到 `127.0.0.1:4000`。

外部访问路径（经 nginx）：`http://<engine>:9999/oes/api/documents/:docId/comments`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/documents/:docId/comments` | 获取文档的所有评论 |
| POST | `/api/documents/:docId/comments` | 新建评论（body: `{ id, selectedText, content, author }`） |
| PATCH | `/api/comments/:id` | 更新评论（body: `{ content?, resolved? }`） |
| DELETE | `/api/comments/:id` | 删除评论 |
| POST | `/api/comments/:id/replies` | 添加回复（body: `{ content, author }`） |
| DELETE | `/api/documents/:docId/comments` | 批量删除文档的所有评论（文档删除时级联清理） |
| GET | `/api/documents/:docId/comments/stream` | SSE 实时推送（评论变更广播） |

**鉴权策略：JWT 复用**

> ⚠️ **本节为早期设计，实际实现不同——以 8.1 节（无鉴权·同源信任）和第九章（commenter 角色）为准。**
> 本节保留作为设计推演记录，请勿据此实现（评论 API 实际无 JWT 鉴权；评论角色为 commenter 而非 viewer）。

评论 API 复用协同连接的 JWT 鉴权，不再使用 `x-api-key`：

- 前端调用评论 API 时，在 `Authorization: Bearer <token>` 头中带上当前文档的协同 JWT
- 服务端 `onRequest` 中用与 `onAuthenticate` 相同的 `JWT_SECRET` 验证 token
- 验证通过后从 JWT payload 取 `doc` 校验是否与请求的 `docId` 匹配（防越权访问其他文档的评论）
- token 过期时返回 401，前端提示重新签发
- viewer 和 editor 都可以读写评论（评论权限不随文档编辑权限走）

```javascript
// onRequest 中的 JWT 验证逻辑
function verifyCommentToken(request, docId) {
  const auth = request.headers['authorization'] || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return null
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    // 校验 token 中的 doc 与请求的 docId 匹配（防越权）
    if (payload.doc && payload.doc !== docId) return null
    return payload
  } catch {
    return null
  }
}
```

**CORS**：`Access-Control-Allow-Origin: *`，允许头 `Authorization, Content-Type`

### 4.3 `comment-storage.js` 设计

```javascript
// collab-server/comment-storage.js
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 独立的 comments.db（与 collab.db 隔离）
const COMMENT_DB_PATH = process.env.COMMENT_DB_PATH
  || join(__dirname, 'data', 'comments.db')

mkdirSync(dirname(COMMENT_DB_PATH), { recursive: true })

const db = new Database(COMMENT_DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id            TEXT PRIMARY KEY,
    doc_id        TEXT NOT NULL,
    selected_text TEXT,
    author_json   TEXT,
    content       TEXT,
    created_at    INTEGER NOT NULL,
    resolved      INTEGER NOT NULL DEFAULT 0,
    replies_json  TEXT NOT NULL DEFAULT '[]'
  )
`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_doc ON comments(doc_id)`)

// 预编译语句 ...
// 导出：listComments, getComment, insertComment, updateComment,
//        deleteComment, deleteCommentsByDoc, addReply, closeCommentDb
```

### 4.4 SSE 推送设计

在 `collab-server/server.js` 的 `onRequest` 中处理 SSE 连接：

```javascript
// GET /api/documents/:docId/comments/stream?token=<jwt>
// SSE 连接通过 query 参数传 JWT（EventSource 不支持自定义 header）
// 连接时验证 JWT 并校验 docId 匹配
// 维护 docId -> Set<ServerResponse> 的注册表
// 评论 CRUD 时广播事件给该文档的所有订阅者
//
// 事件格式：data: { "type": "comment:added|updated|deleted|replied", "payload": {...} }\n\n
// 30s 心跳：data: : ping\n\n
```

> 注意：`onRequest` 是 Hocuspocus 的 HTTP hook，SSE 长连接需要手动管理 response 流。
> Hocuspocus 的 `onRequest` 返回后不会自动关闭 response（抛 `null` 跳过默认处理），
> 所以 SSE 连接可以保持。连接断开时 response 的 `close` 事件触发清理。
>
> **SSE 鉴权**：`EventSource` API 不支持自定义 HTTP header，JWT 通过 URL query 参数
> 传递（`?token=<jwt>`）。连接建立时服务端验证 token 并校验 `payload.doc === docId`。

### 4.5 前端 options 设计

```javascript
// src/options/config/index.js 新增
comments: {
  enabled: true,        // 是否启用评论功能（false 时完全移除评论 UI + mark 扩展）
  apiBase: '',          // 评论 API 基地址（空 = 同源，引擎内置场景留空）
}
```

```javascript
// src/options/schema.js 新增
comments: {
  merge: 'replace',
  validate: 'object',
  required: false,
  schema: {
    enabled: { merge: 'replace', validate: 'boolean', required: false },
    apiBase: { merge: 'replace', validate: 'string', required: false },
  },
},
```

### 4.6 Comment Mark 注册（引擎内置）

在 `src/extensions/index.js` 的 `getDefaultExtensions` 中：

```javascript
// 当 comments.enabled !== false 且 comment 不在 disableExtensions 中时注册
if (options.comments?.enabled !== false && !disabledList.includes('comment')) {
  buildInExtensions.push(Comment)          // comment mark
  buildInExtensions.push(CommentHighlight) // active 高亮
}
```

这样评论 mark 成为引擎默认 schema 的一部分，所有文档都能用。
不需要评论的项目传 `comments: { enabled: false }` 或 `disableExtensions: ['comment']`。

### 4.7 气泡菜单内置评论按钮

当前气泡菜单的评论按钮通过 `#bubble_menu` slot 从外部注入。
改为在 `src/components/menus/bubble/menus.vue` 内部直接渲染：

```vue
<!-- 在气泡菜单按钮组末尾，当 canComment 时显示（editor + commenter 可评论，viewer 不可） -->
<template v-if="canComment">
  <span class="umo-bubble-menu-divider"></span>
  <button class="umo-bubble-menu-btn" @mousedown.prevent="captureSelection" @click="onComment">
    {{ t('comment.add') }}
  </button>
</template>
```

> **commenter 模式（readOnly）也显示评论按钮**：评论权限不随文档编辑权限走，
> commenter（只读用户）也可以对文档内容发表评论。TipTap bubble menu 默认在 readOnly
> 下不显示（`shouldShow` 检查 `editor.isEditable`），需要为评论按钮覆盖此行为：当选中文本
> 且 `canComment` 为 true 时强制显示评论按钮（即使编辑器是 readOnly）。
>
> > ⚠️ 实现：气泡菜单的 `shouldShow` 用 `canComment`（= 评论功能开启 且 角色非 viewer）判断，
> > 而非旧的 `commentsEnabled`。**viewer 不再弹出气泡菜单、不可评论**；commenter 弹出（仅评论按钮）。
> > commenter 的评论 mark 由服务端代写（第九章）。

#### viewer 模式 bubble menu 显示方案

TipTap 的 BubbleMenu 扩展 `shouldShow` 在 `!editor.isEditable` 时返回 false，
导致 readOnly 模式下整个气泡菜单不显示。为了让 viewer 也能评论，有两种方案：

**方案（采用）：自定义 shouldShow**

在 `src/components/editor/index.vue` 中，BubbleMenu 配置自定义 `shouldShow`：
```javascript
shouldShow: ({ editor, view, state, from, to }) => {
  const { selection } = state
  if (selection.empty) return false
  // 原始逻辑：非空选区 + 编辑器可编辑 → 显示
  if (editor.isEditable) return true
  // viewer 模式：如果 comments 启用，选中文本时也显示气泡菜单（只有评论按钮）
  return commentsEnabled
}
```

这样 viewer 模式下选中文本也会弹出气泡菜单，但菜单中只有"评论"按钮
（其他编辑类按钮如加粗、斜体不显示——它们自身会检查 isEditable）。

气泡菜单不再需要 slot 注入评论按钮。slot 仍保留给其他自定义需求。

### 4.8 评论面板（左侧，与 TOC 同侧）

在 `src/components/container/page.vue` 新增左侧评论面板，与 TOC 面板并列。
两个面板可以同时打开（上下叠放），也可以独立开关：

```vue
<div class="umo-main-container">
  <!-- 左侧面板区：TOC + 评论（上下排列） -->
  <div v-if="pageOptions.showToc || showCommentPanel" class="umo-side-panels">
    <container-toc
      v-if="pageOptions.showToc"
      @close="pageOptions.showToc = false"
    />
    <container-comment
      v-if="showCommentPanel"
      :doc-id="docId"
      @close="showCommentPanel = false"
    />
  </div>

  <!-- 中间：可缩放的编辑区 -->
  <div class="umo-zoomable-container">...</div>
</div>
```

布局设计：

- **左侧面板容器** `.umo-side-panels`：`flex-direction: column`，高度 100%，
  TOC 在上、评论在下，各自独立滚动。两个面板之间有分隔线。
- **面板宽度** 320px（与 TOC 一致），可收起。
- **只开一个面板时**：该面板占满左侧高度。
- **两个面板同时开时**：TOC 占上半区（min-height 200px），评论占下半区（flex: 1），
  中间有可拖拽的分隔条（与 TOC 现有的 resize 机制一致）。
- **都不开时**：`.umo-side-panels` 不渲染，编辑区占满全宽。

> 这个布局模式比右侧面板更自然——左侧是"导航/管理"区（目录、评论），
> 右侧保持干净给编辑区，与 Word/Notion 的左侧面板设计一致。

### 4.9 状态栏评论入口

在 `src/components/statusbar/index.vue` 左区新增评论按钮：

```vue
<!-- 评论入口（显示评论数 badge） -->
<template v-if="commentsEnabled">
  <div class="umo-status-bar-split"></div>
  <tooltip :content="t('comment.title')">
    <t-button
      class="umo-status-bar-button"
      :class="{ active: showCommentPanel }"
      variant="text"
      size="small"
      @click="showCommentPanel = !showCommentPanel"
    >
      <icon name="comment" />
      <span v-if="commentCount > 0" class="umo-comment-badge">{{ commentCount }}</span>
    </t-button>
  </tooltip>
</template>
```

### 4.10 前端状态管理 `useComments`

从 `embed/src/composables/useComments.js` 移入，改造为引擎内置：

```javascript
// src/composables/comment.js
// 变化点：
// 1. apiBase 默认走同源（withBasePath），不再需要父页面 postMessage 下发
// 2. author 从 inject('collabUser') 或 options.user 取
// 3. docId 从协同 provider 的 documentName 取
// 4. 评论 id 客户端生成（crypto.randomUUID）
// 5. JWT 鉴权：每个请求带 Authorization: Bearer <token>（复用协同 JWT）
//    token 从 URL 参数 ?token= 取（embed 场景）或从 provider 实例取
```

#### JWT 鉴权细节

```javascript
// 所有评论 API 请求自动带上 JWT
function authHeaders() {
  const token = getCollabToken() // 从 URL ?token= 或 provider 取
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request(path, options = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...options.headers,
    },
  })
  // 401 时通知前端重新签发 token（回调到 options.comments.onAuthError）
  if (res.status === 401) {
    throw new Error('评论鉴权失败，请重新签发 token')
  }
  return res
}
```

### 4.11 API 地址推导

引擎内置评论时，API 地址通过 `withBasePath`（已有工具）自动推导：

```javascript
// 引擎同源场景：/api/documents/:docId/comments
// 子路径反代场景：/editor/api/documents/:docId/comments
const apiBase = options.comments?.apiBase || withBasePath('')
```

embed 页面由引擎 nginx 提供服务，评论 API 也由引擎 nginx 反代到 collab-server，
所以前端调 `/api/documents/:docId/comments` 是同源的，不需要跨域。

**JWT token 来源**：
- embed 场景：URL 参数 `?token=<jwt>`（已在 `embed/src/App.vue` 中解析）
- 独立使用场景：从 `HocuspocusProvider` 实例的 `configuration.token` 取
- 前端 `useComments` 接受 `getToken: () => string` 回调，由上层传入

### 4.12 nginx 配置改动

在 `docker/nginx.conf` 新增评论 API 反代：

```nginx
# 评论 REST + SSE API → collab-server(:4000)
location /oes/api/documents/ {
    rewrite ^/oes(/.*)$ $1 break;
    proxy_pass http://collab_backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # SSE 需要关缓冲
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
    chunked_transfer_encoding on;
}
```

### 4.13 embed 瘦客户端简化

评论功能移入引擎后，embed 大幅简化：

```vue
<!-- embed/src/App.vue 改造后 -->
<umo-editor
  ref="editorRef"
  v-bind="editorOptions"
  @created="onEditorCreated"
>
  <!-- 不再需要 #bubble_menu slot 注入评论按钮 -->
  <!-- 不再需要 CommentSidebar / FAB -->
</umo-editor>
<!-- 不再需要评论面板（引擎内置了，在左侧与 TOC 同侧） -->
```

`editorOptions` 中不再需要 `extensions: [Comment, CommentHighlight]`（引擎内置注册）。
`parentConfig` 不再需要 `commentApiBase`。

## 五、实施步骤

### 阶段一：后端存储（collab-server）

1. 新建 `collab-server/comment-storage.js`（SQLite comments 表 + CRUD + `deleteCommentsByDoc`）
2. 在 `collab-server/server.js` 的 `onRequest` 新增 REST 路由（含 JWT 鉴权）+ SSE
   - 单条 CRUD：`GET/POST /api/documents/:docId/comments`、`PATCH/DELETE /api/comments/:id`
   - 批量清理：`DELETE /api/documents/:docId/comments`（文档删除时级联清理）
   - 回复：`POST /api/comments/:id/replies`
   - SSE：`GET /api/documents/:docId/comments/stream?token=<jwt>`
   - JWT 验证：复用 `JWT_SECRET`，校验 `payload.doc === docId`
3. `collab-server/package.json` 添加依赖（如需 uuid，或纯用服务端 `crypto.randomUUID`）
4. `docker/nginx.conf` 新增 `/oes/api/documents/` 反代（含 SSE 关缓冲配置）
5. 测试：`curl -H "Authorization: Bearer <token>" http://localhost:9999/oes/api/documents/test-doc/comments`

### 阶段二：引擎前端（src/）

1. 新建 `src/extensions/comment/`（mark + highlight）
2. 在 `src/extensions/index.js` 注册（`comments.enabled !== false` 时自动加入）
3. 新建 `src/composables/comment.js`（状态管理，JWT 鉴权，getToken 回调）
4. 新建 `src/components/comment/`（sidebar + form）
5. 改造 `src/components/container/page.vue`（左侧面板，与 TOC 同侧上下排列）
6. 改造 `src/components/statusbar/index.vue`（评论按钮 + badge）
7. 改造 `src/components/menus/bubble/menus.vue`（内置评论按钮，editor + viewer 均显示）
8. 改造 `src/components/editor/index.vue`（自定义 BubbleMenu `shouldShow`：viewer 模式也弹气泡）
9. 新增 `options.comments` 配置（`{ enabled, apiBase }`）+ schema
10. 新增 i18n 文案（zh_CN / en_US）
11. 构建验证

### 阶段三：清理 embed + demo

1. 从 `embed/src/App.vue` 移除所有评论代码
2. 删除 `embed/src/extensions/comment-*.js`
3. 删除 `embed/src/components/comment/`
4. 删除 `embed/src/composables/useComments.js`
5. 从 `demo/src/views/EditorView.vue` 移除 `commentApiBase`
6. `demo/server/comments.js` 保留作为业务系统参考

### 阶段四：Docker 重建 + 验证

1. 重建 engine 镜像 + demo 镜像
2. 端到端验证：
   - editor 模式：选中文字 → 点"评论" → 输入 → 发表 → 文字出现 mark → 侧栏显示
   - viewer 模式：选中文字 → 气泡菜单弹出（只有评论按钮）→ 发表评论 → 正常显示
   - 刷新页面：评论 mark 位置正确，侧栏列表完整
   - 协同同步：A 用户评论 → B 用户实时看到 mark + 侧栏更新
   - 标记解决：mark 变灰 + 删除线
   - 删除评论：mark 从文档移除
   - 导出 HTML：`getHTML()` 输出含 `<span data-comment-id="...">`（mark 保留）
   - 级联删除：`DELETE /api/documents/:docId/comments` 清空该文档所有评论
   - 鉴权：不带 JWT 或 docId 不匹配时返回 401

## 六、影响评估

### 正面

| 维度 | 影响 |
|------|------|
| 使用成本 | 所有 `@umoteam/editor` 使用者零配置获得评论功能 |
| UI 一致性 | 评论面板与编辑器深度融合（与 TOC 面板对称的布局） |
| 维护性 | 评论代码集中在引擎内，不再分散在 embed |
| 协同 | comment mark 随 Yjs 自动同步，引擎内置后体验统一 |

### 负面 / 风险

| 维度 | 影响 | 缓解 |
|------|------|------|
| 引擎包体积 | 评论 UI 增加 ~20KB gzip | 可接受 |
| 引擎复杂度 | 新增评论组件 + 左侧面板基建 | 复用 TOC 左侧面板的 flex 布局模式 |
| schema 影响 | comment mark 进入默认 schema | `comments.enabled: false` 可关闭 |
| 鉴权复杂度 | 评论 API 需要鉴权 | 复用协同 JWT（`Authorization: Bearer`），零额外配置 |
| 向后兼容 | 不使用评论的项目 | 默认开启但 mark 存在不可见，不影响现有功能 |

### 设计决策（已确认）

1. **viewer 模式支持评论**：只读用户也能添加评论。TipTap bubble menu 默认在 readOnly 下
   不显示，需要自定义 `shouldShow` 覆盖——当选中文本且 comments 启用时强制弹出气泡菜单
   （仅评论按钮可见，编辑类按钮自身检查 isEditable 自行隐藏）

   > ⚠️ **本条已被第九章取代**：实际实现中 viewer 不再可评论，新增 **commenter** 角色承担"只读+可评论"。
   > commenter 的协同连接同样为 readOnly，但评论的 comment mark 由服务端代写到 Yjs 文档
   > （viewer 的协同连接 readOnly 导致本地 setMark 的 update 被丢弃，刷新/他端无法定位）。
   > 详见第九章。本设计决策保留作为历史记录。

2. **导出 HTML 保留 comment mark**：`getHTML()` / `getContent()` 默认保留 `<span data-comment-id>`
   mark。导出的 HTML 包含评论标记，业务系统可据此识别哪些文字有评论。Comment mark 的
   `renderHTML` 已经输出 `data-comment-id` 属性，无需额外处理

3. **文档删除级联删除评论**：新增 `DELETE /api/documents/:docId/comments` 批量清理接口。
   业务系统删除文档时调用此接口级联清理评论。引擎本身不管理文档生命周期（文档存储在
   collab-server 或业务系统），所以级联删除由业务系统触发

4. **API 鉴权复用 JWT**：评论 API 通过 `Authorization: Bearer <token>` 鉴权，token 与
   协同连接共用同一个 JWT。服务端验证 token 并校验 `payload.doc === docId` 防越权。
   viewer 和 editor 的 JWT 都有 `doc` claim，都能访问对应文档的评论 API

---

## 八、实现现状与设计差异

> 本页设计在 2026-08 已落地实现。以下为**实现与本文设计不一致**之处，以实际代码为准：

### 8.1 鉴权：设计为 JWT 复用，实现为「无鉴权（同源信任）」

- **设计**（本文 4.2 节）：评论 API 复用协同 JWT，`Authorization: Bearer <token>` 鉴权，校验 `payload.doc === docId` 防越权。
- **实现**（`collab-server/comment-storage.js`）：评论 API **无鉴权**。理由：collab-server 的 4000 端口在 Docker 中不对外暴露，评论 API 只能经引擎 nginx 同源反代访问，依赖「同源信任」即可。`editor` / `commenter` / `viewer` 均可读写评论。
- **影响**：业务系统直接调用评论 REST 时无需带 JWT；若将评论 API 暴露到公网（不推荐），需自行在业务侧加鉴权。

### 8.2 组件路径：`src/components/comment/` → `src/components/container/comment/`

- 评论面板组件实际位于 `src/components/container/comment.vue` 与 `src/components/container/comment/`（与 TOC 同侧布局由 container 层管理）。

### 8.3 前端 API 前缀推导

- `src/utils/base-path.js` 的 `getCommentApiBase()`：优先级为 `options.comments.apiBase`（显式配置）> 从页面 URL 自动推导部署前缀（embed 场景 `/oes`、子路径反代 `/editor/oes` 等）> 同源根路径。embed 场景前端请求必须带 `/oes` 前缀才能命中引擎 nginx 反代。

### 8.4 SSE 细节

- 心跳间隔 30s（`setInterval(..., 30000)`），与设计一致；连接时通过响应头 `X-Accel-Buffering: no` 提示反代关闭缓冲。
- SSE 无需 token（与 8.1 一致，无鉴权）。

### 8.5 其余已按设计落地

- REST 路由、SQLite 表结构、`comments.enabled`/`apiBase` 选项、comment mark 注册（`disableExtensions: ['comment']` 可关）、气泡菜单评论按钮（**commenter 显示，viewer 不显示**——见第九章）、左侧面板、状态栏 badge、级联删除接口均与设计一致。

> ### ⚠️ 第一~七章关于「viewer 可评论」的设计已被第九章取代
>
> 本文档前八章（尤其 4.7 节气泡菜单、六.1 设计决策）描述的"viewer 可评论"是基于二角色模型
> （editor/viewer）的早期设计。**实际落地时发现**：viewer 的协同连接被 `connection.readOnly` 拦截，
> 本地 `setMark` 的 update 被服务端丢弃，导致评论刷新/他端无法定位。因此引入了第三个角色
> **commenter**（只读 + 可评论，mark 由服务端代写），viewer 改为纯只读不可评论。
> **第九章为权威实现，前八章的 viewer 评论描述仅作历史记录保留。**

---

## 九、commenter 角色：查看模式下可评论（服务端代写 mark）

> 2026-08 增量设计。解决「查看模式（viewer）评论后，刷新或他端无法定位」的问题。

### 9.1 问题根因

原设计中 viewer 也能评论（气泡菜单对 readOnly 强制弹出），但 viewer 的协同连接被 `connection.readOnly = true` 拦截，本地 `setMark` 触发的 Yjs update 被服务端丢弃——不 apply、不广播。结果：

- **本地 viewer**：DOM 有 `data-comment-id`，点击能定位（假象可用）
- **其他端 / 刷新后**：Yjs 文档无该 mark → DOM 无 span → `querySelector` 返回 null → **评论点不动**

Hocuspocus 的 `readOnly` 是全有或全无的布尔开关，无法「只放行 comment mark update」；`beforeHandleMessage` 抛异常会断开整个连接，无法软丢弃单条 update。

### 9.2 解决方案：新增 commenter 角色 + 服务端代写 mark

**三种角色**：

| 角色 | 能力 | 协同连接 | mark 写入通道 |
|---|---|---|---|
| `editor` | 查看+编辑+评论+辅助 | 可编辑 | 本地 setMark，经自己连接同步 |
| `commenter`（新增）| 查看+评论+辅助，**不可改正文** | readOnly | HTTP 提交相对位置，**服务端代写** |
| `viewer` | 纯查看 | readOnly | 无（不可评论）|

**服务端代写**：commenter 的评论位置（Yjs RelativePosition）随 HTTP 提交，collab-server 用 `server.openDirectConnection(docId).transact(doc => {...})` 直接在服务端 Y.Doc 上 `format` comment mark，修改经 Y.Doc update 事件自动广播给所有协同连接（含 commenter 自己）。无需建「内部 editor WebSocket 连接」。

### 9.3 数据流

```
commenter 端（readOnly 协同连接）
  ① 选中文本 [from,to)
  ② y-prosemirror 的 absolutePositionToRelativePosition 转 RelativePosition
     （相对位置绑在 item 上，并发编辑时自动漂移到正确文字）
  ③ 本地不 setMark
  ④ POST /api/comments { id, anchor:{fromRel,toRel}, selectedText, content }
       ──────────────────────────────▶ collab-server
                                      ⑤ 存 comments.db
                                      ⑥ openDirectConnection(docId).transact(doc => {
                                           解析 fromRel/toRel → 当前 offset
                                           读区间文字与 selectedText 比对，不一致 throw（事务回滚）
                                           yXmlText.format(off, len, {comment:{commentId,resolved:false}})
                                         })
                                      ⑦ Y.Doc update 事件 → Hocuspocus 广播给所有连接
                                      ⑧ SSE comment:added
所有端收到 Yjs update → DOM 出现 <span data-comment-id> → querySelector 命中 → scrollIntoView ✓
```

resolve / delete 同理：commenter 的 PATCH/DELETE 带 `serverWrite: true`，服务端按 commentId 扫描 mark 区间后代写（改 resolved / format null 移除）。

### 9.4 三项并发缓解措施

1. **相对位置提交**：commenter 前端用 `Y.createRelativePositionFromTypeIndex` 提交，editor 并发插入/删除时相对位置自动漂移到正确文字。
2. **selectedText 校验**：服务端代写前读区间当前文字与提交快照比对，不一致（文字被删/已变/position 失效）→ 事务回滚、返回 409，前端提示重新选中。
3. **commentFocus 轮询**：点击评论定位时，mark 可能尚未从协同广播落地，`commentFocus` 查不到 DOM 元素时轮询等待（上限 1.5s），命中后再滚动。

### 9.5 服务端 position 映射（`collab-server/yjs-position.js`）

服务端无 ProseMirror schema，无法用 y-prosemirror 的 position 工具，手写 ProseMirror 绝对 position → Y.XmlText 相对 offset 映射。ProseMirror position 模型（经 prosemirror-model 验证）：每个 block 占 `nodeSize = 2 + 内容长度` 个 pos（开标签1 + 内容 + 闭标签1），XmlText 内 pos 直接当 index 用。

### 9.6 角色识别与传递

- **embed 瘦客户端**：URL `mode=comment` 或 JWT `role=commenter` claim → `options.user.role = 'commenter'`、awareness role、`readOnly: true`
- **引擎**：`options.user.role` → `commentUserRole` / `isCommenter` / `canComment`（= commentsEnabled 且 role ≠ viewer）
- **气泡菜单**：`shouldShow` 用 `canComment`（commenter 弹、viewer 不弹）；评论按钮 `v-if="canComment"`
- **状态栏徽章**：editor→编辑、commenter→评论（琥珀色）、viewer→只读（灰色）

### 9.7 并发语义边界

- **同区间同 key 不同 value 并发**（服务端写 commentId:A 与 editor 写 commentId:B 重叠）：CRDT 按 clientID+clock 拓扑序保留其一，属 Yjs 既有 last-write 语义，概率极低，局部影响。
- **HTTP 代写绕过 readOnly**：commenter 能通过 HTTP 让服务端以编辑权限写 mark，依赖「同源信任 + 限频（单 docId 每分钟 60 次）+ 范围校验」防护。

### 9.8 涉及文件（增量）

| 文件 | 改动 |
|---|---|
| `collab-server/yjs-position.js`（新增）| position 映射、按 commentId 扫描、setMark/removeMark |
| `collab-server/server.js` | commenter 角色签发；传 server 给 commentStorage |
| `collab-server/comment-storage.js` | 接收 server；POST/PATCH/DELETE 代写 mark；selectedText 校验；限频 |
| `embed/src/App.vue` | mode=comment 识别、readOnly、awareness role、user.role |
| `src/app.vue` | commenter role 支持、readOnly、user.role |
| `src/components/index.vue` | commentAdd 按角色分流（editor 本地 setMark / commenter 提交 anchor）；commentResolve/Delete 分流；commentFocus 轮询；canComment/isCommenter provide |
| `src/composables/comment.js` | addComment 透传 anchor；updateComment/deleteComment 支持 serverWrite |
| `src/components/menus/bubble/index.vue` | shouldShow 用 canComment |
| `src/components/menus/bubble/menus.vue` | 评论按钮 v-if=canComment |
| `src/components/statusbar/index.vue` | commenter 角色徽章 |
| `src/assets/styles/editor.less` | is-commenter 样式 |
| `demo/` | 登录页 commenter 选项、auth store、EditorView 角色徽章、server 代理三角色 |
