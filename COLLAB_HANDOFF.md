# Umo Editor 协同编辑开发交接文档

> 本文档供切换对话时使用，包含完整的项目背景、已完成工作、技术细节和后续计划。
> 最后更新：demo 宿主应用（登录/文档列表/编辑器 + 单机/协同双模式 + 工具栏标题行布局 + 人员信息浮框）完成后

---

## 一、项目背景

- **项目**：Umo Editor（`@umoteam/editor` v11.1.1），基于 Vue3 + Tiptap3 的开源文档编辑器
- **仓库**：`D:\workspace\editor`，分支 `dev`
- **目标**：为 Umo Editor 实现多人实时协同编辑（collaborative editing）
- **技术选型**：Yjs（CRDT）+ Hocuspocus（Node.js 服务端）+ `@tiptap/extension-collaboration`（前端集成）

### 启动方式

```bash
# 终端 1：协同服务（端口 4000）
cd D:\workspace\editor\collab-server
npm install   # 首次
npm start

# 终端 2：前端 dev server（端口 9000）
cd D:\workspace\editor
npm run dev

# 浏览器访问
# 单机模式：http://localhost:9000/umo-editor/
# 协同模式（默认文档）：http://localhost:9000/umo-editor/?collab=1
# 多文档协同：http://localhost:9000/umo-editor/?collab=1&doc=my-doc
# 只读模式（权限控制）：http://localhost:9000/umo-editor/?collab=1&doc=my-doc&role=viewer
```

---

## 二、当前状态：阶段二核心功能已完成 ✅

### 已完成功能总览

| 功能 | 状态 | 说明 |
|---|---|---|
| 内容实时同步 | ✅ 完成 | 阶段一，多窗口实时同步编辑，80ms 节流合并 |
| 远程光标/选区显示 | ✅ 完成 | 彩色竖线 + 用户名标签 + 选区背景色（CSS 已修复，见第四节坑#8） |
| JWT 鉴权 | ✅ 完成 | HS256，服务端验证 + 文档级权限校验 |
| 数据库持久化 | ✅ 完成 | SQLite（WAL 模式），重启不丢数据 |
| 多文档编辑 | ✅ 完成 | URL 参数 `?doc=xxx` 指定文档，互不干扰 |
| 撤销/重做 | ⚠️ undo 已修复 / redo 部分可用 | undo 已工作，redo 栈被清空（见第七节） |
| 协作者图例 | ✅ 完成 | 状态栏头像组 + hover 详情浮层（用户名/颜色/权限） |
| 编辑/只读权限 | ✅ 完成 | JWT role + 服务端 readOnly + 前端 setEditable 三重保障 |
| 同步节流 | ✅ 完成 | flushDelay 80ms，连续输入合并成单个 Yjs update |

### 三阶段规划

| 阶段 | 内容 | 状态 |
|---|---|---|
| **阶段一** | 最小协同服务 + 前端接入验证 | ✅ 完成 |
| **阶段二** | 准生产：光标 UI、JWT 鉴权、数据库持久化、多文档、权限、图例 | ✅ 基本完成（redo 遗留） |
| **阶段三** | 生产：多实例扩展、Redis 广播、监控告警 | ⬜ 待实现 |

---

## 三、所有代码改动清单

### 3.1 协同服务（`collab-server/` 独立子目录）

```
collab-server/
├── server.js              # Hocuspocus 协同服务（端口 4000）
├── storage.js             # SQLite 存储层抽象（loadDoc/saveDoc/closeDb）
├── e2e-test.mjs           # 端到端测试脚本
├── package.json           # 依赖：@hocuspocus/server 2.15.3, yjs 13.6.29, jsonwebtoken 9.0.3, better-sqlite3 13.0.2
├── .gitignore             # 含 data/（SQLite 数据文件）
├── README.md
├── data/                  # SQLite 数据目录（gitignore，运行时生成）
│   └── collab.db
└── client-example/
    └── README.md
```

**server.js 要点**（当前版本）：
- 用 `Server`（Hocuspocus 单例，**非构造函数**，用 `server.configure({...})` 配置）
- `onRequest`：HTTP token 签发端点 `GET /api/token?name=xxx&doc=xxx&role=editor|viewer`（同端口 4000 提供 WebSocket + HTTP）
  - role 写入 JWT claims，响应里返回 role 供前端使用
- `onAuthenticate`：JWT 验证（`jwt.verify`）+ 文档级权限校验（token 的 doc claim 必须匹配 documentName）+ 权限控制
  - **权限控制**：`payload.role === 'viewer'` 时设 `connection.readOnly = true`（Hocuspocus 原生支持，服务端拒绝该连接的所有 update）
  - context.user 写入 `{name, doc, role}`
- `onLoadDocument` / `onStoreDocument`：通过 `storage.js` 的 `loadDoc`/`saveDoc` 读写 SQLite（Hocuspocus 自带 2s 防抖）
- 优雅停机：SIGINT/SIGTERM → `server.destroy()` + `closeDb()`

**storage.js 要点**：
- SQLite + WAL 模式，单表 `documents(name TEXT PRIMARY KEY, content BLOB, updated_at INTEGER)`
- 预编译语句 + UPSERT（`INSERT ... ON CONFLICT DO UPDATE`）
- 导出 `loadDoc(name)` / `saveDoc(name, buffer)` / `closeDb()`——后续切 MySQL/PG 只需替换此文件

### 3.2 编辑器主项目 `package.json`

```jsonc
{
  "dependencies": {
    "@tiptap/y-tiptap": "^3.0.8"   // 从 3.0.2 升级（原版本与 tiptap 3.20.0 严重错位）
  },
  "devDependencies": {
    "@hocuspocus/provider": "^4.4.0"  // 前端连服务端用
  },
  "overrides": {
    "rolldown": "^1.1.3",
    "@umoteam/editor-external": {
      "@tiptap/y-tiptap": "3.0.8"     // 消除 editor-external 嵌套的旧版 y-tiptap 副本
    }
  }
}
```

### 3.3 `src/app.vue`（dev 入口，协同模式开关）

**核心设计**：URL 参数 `?collab=1` 切换协同/单机模式，`?doc=xxx` 指定文档名，`?role=viewer` 指定只读。**单机模式完全不受影响**。

当前改动点：
- **import**：`Collaboration`、`Extension`（@tiptap/core）、`yCursorPlugin`（@tiptap/y-tiptap）、`HocuspocusProvider`、`Y`、`onUnmounted`、`provide`、`ref`
- **`collabEnabled`**：`urlParams.has('collab')`
- **`collabDoc`**：`urlParams.get('doc') || 'demo-doc'`（多文档支持）
- **`collabRole`**：`urlParams.get('role') === 'viewer' ? 'viewer' : 'editor'`（权限，demo 阶段用 URL 参数，生产接业务系统鉴权）
- **`collabUser`**：随机用户名 + 从预设 hex 色池随机选颜色 + role（**color 必须是 `#RRGGBB` 格式**，yCursorPlugin 的 `defaultSelectionBuilder` 会拼 alpha 后缀并正则校验）
- **`editorReady`**：协同模式默认 `false`，等 `provider.on('synced')` 后置 `true`
- **`collabError`**：鉴权失败时显示错误信息
- **provider 连接**：`ws://localhost:4000`，文档名 `collabDoc`
- **`flushDelay: 80`**：provider 配置项，80ms 节流窗口，把连续编辑合并成单个 Yjs update（见 6.5 节）
- **token**：异步函数 `async () => fetch('/api/token?name=...&doc=...&role=...')`（JWT 动态获取，带 role）
- **`provider.on('authenticationFailed')`**：显示鉴权错误，不挂载编辑器
- **协作者列表**：`provider.on('awarenessChange', ({states}) => collaborators.value = states)`，`provide('collaborators', collaborators)` + `provide('collabRole', collabRole)` 供状态栏 inject
- **`@created="onEditorCreated"`**：viewer 权限时 `editor.setEditable(false)`（前端禁编辑，服务端 readOnly 是双保险）
- **预填充段落（关键修复）**：创建 Collaboration 前，给 `ydoc.getXmlFragment('default')` push 一个 `new Y.XmlElement('paragraph')`——修复初始化竞争（见第五节）
- **`collabExtensions`**：注入 2 个扩展：
  1. `Collaboration.configure({ document: ydoc })` — Yjs 同步
  2. `collaborationCursor`（Extension.create + `yCursorPlugin(provider.awareness)`）— 远程光标/选区
- **`disableExtensions`**：协同模式 `['undoRedo']`
- **`document.content`**：协同模式留空（`''`），由 Y.Doc 驱动
- **`onSave`**：协同模式跳过 localStorage
- **`onUnmounted`**：清理 provider/ydoc
- **template**：`v-if="editorReady"` + `v-else-if="collabError"`（错误提示）+ `v-else`（loading）

### 3.4 `src/extensions/index.js`（扩展注册逻辑）

在 `return buildInExtensions` 之前新增过滤逻辑（让 disableExtensions 也能过滤 buildInExtensions 里的内置扩展）：
```js
if (disableExtensions?.length) {
  for (let i = buildInExtensions.length - 1; i >= 0; i -= 1) {
    if (disableExtensions.includes(buildInExtensions[i]?.name)) {
      buildInExtensions.splice(i, 1)
    }
  }
}
```

### 3.5 撤销/重做的 Umo 层改动（undo 已修复，redo 部分可用）

以下文件涉及 undo/redo，详见第七节（含根因和修复）：

| 文件 | 改动 |
|---|---|
| `src/utils/history-record.js` | `addHistory` 增加 `isCollab` 参数，协同模式 editor 类型短路（不依赖 `state.history$`） |
| `src/components/editor/index.vue` | `onUpdate` 传入 `isCollab` 标志 |
| `src/components/index.vue` | `undoHistory`/`redoHistory` 协同分流（editor 走 Yjs undo，page 走 Umo 队列）+ `collabCanUndo`/`collabCanRedo` 响应式状态 + `collabUndoManager`（直接调 `um.undo()/redo()` 绕过坏命令）+ **trackedOrigins 多副本修复**（`beforeTransaction` 捕获实际 origin）|
| `src/components/menus/toolbar/base/undo.vue` | disabled 绑定协同分流（`isCollab ? !collabCanUndo : historyRecords.done.length === 0`） |
| `src/components/menus/toolbar/base/redo.vue` | 同上 |

### 3.6 `src/assets/styles/editor.less`（远程光标样式 + 协作者头像组）

- `.ProseMirror-yjs-cursor`（光标竖线 + 悬停用户名气泡）和 `.ProseMirror-yjs-selection`（选区背景）样式
  - **注意**：这两段样式必须放在 `.umo-editor-content` 直接作用域下，**不能嵌套进 `:-webkit-any(article, aside, nav, section)` 块**——否则光标 span 的祖先是 `.ProseMirror/p`（非 article 等），选择器匹配不上，导致 opacity/position 失效，用户名 div 会以 block + opacity:1 渲染占满一整行（见第四节坑#8）
- `.umo-collaborators`（状态栏协作者头像组）和 `.umo-collaborators-panel`（hover 详情浮层）样式

### 3.7 `src/components/statusbar/index.vue`（协作者头像组 UI）

在状态栏**左区末尾**（字数统计/版权之后、右区视图工具之前）插入协作者头像组：
- `v-if="isCollab && collaboratorList.length > 0"`，仅协同模式且有人在线时显示
- 彩色头像圆圈（首字母 + user.color 背景）+ 超过 5 人显示 +N，层叠排列
- `t-popup`（trigger=hover, placement=top-left）包裹，浮层列出所有协作者：彩色圆点 + 用户名 + 权限标签（编辑/只读）
- inject `collaborators`（app.vue provide）+ `isCollab` 判断 + `collaboratorList` 计算属性（过滤无效项）

---

## 四、调试历程（踩过的坑，避免重复）

| # | 报错/现象 | 根因 | 解决 |
|---|---|---|---|
| 1 | `'vite' 不是内部或外部命令` | 未 `npm install` | 装依赖 |
| 2 | `Unexpected case`（第一次） | `@tiptap/y-tiptap@3.0.2` 与 tiptap 3.20.0 版本严重错位 | 升级到 3.0.8 |
| 3 | `Adding different instances of a keyed plugin (plugin$)` | `@umoteam/editor-external` 嵌套了旧的 y-tiptap@3.0.2 副本 | `package.json` overrides 去重 |
| 4 | `Unexpected case`（第二次，升级后复发） | 初始化竞争（见第五节） | 预填充段落 |
| 5 | `ERR_HTTP_HEADERS_SENT`（onRequest hook） | Hocuspocus 的 `onRequest` 执行后总是走默认响应 | 处理完 HTTP 后 `throw null`（falsy 值跳过默认处理） |
| 6 | 光标颜色不显示/选区背景无效 | `collabUser.color` 用了 `hsl()` 格式，yCursorPlugin 要求 `#RRGGBB` | 改为预设 hex 色池 |
| 7 | 协同模式撤销/重做不工作 | **undo 已修复**：trackedOrigins 多副本（见第七节）+ extension-collaboration preventDispatch；**redo 仍遗留** | undo 修复见第七节；redo 待处理 |
| 8 | 协作者用户名占满一整行（带背景色） | 光标 CSS 被错误嵌套进 `:-webkit-any(article,aside,nav,section)` 块，选择器匹配不上光标 DOM，opacity/position 失效 | 把 `.ProseMirror-yjs-cursor` 移到 `.umo-editor-content` 直接作用域（见 3.6） |
| 9 | `yUndoPluginKey.getState()` 返回 undefined | 用 `new PluginKey('y-undo')` 重建 key——ProseMirror 的 createKey 是模块级计数器，重建得 `y-undo$1` 而真正注册的是 `y-undo$` | 必须 `import { yUndoPluginKey } from '@tiptap/y-tiptap'` 用同一实例 |
| 10 | Tiptap 命令（insertContent 等）在协同模式不改 doc | Tiptap 3.x 命令系统与协同模式兼容问题（preventDispatch 家族），但 PM 原生 `view.dispatch(tr)` 正常 | undo 走 `um.undo()` 绕过；真实键盘输入走 PM 原生 dispatch 不受影响 |

---

## 五、核心技术细节：初始化竞争（最重要的坑）

### 现象
`findRootTypeKey` 抛 `Unexpected case`，调用栈：
```
yUndoPlugin.apply → getRelativeSelection → absolutePositionToRelativePosition
→ Y.createRelativePositionFromTypeIndex → findRootTypeKey → 找不到 → 报错
```

### 完整因果链
1. Umo 文档 schema 是 `block+`（至少一个块节点）→ ProseMirror 创建时**强制生成默认空段落**（选区落在 pos 1）
2. Yjs 文档初始为**空**（`_length: 0`）
3. `ySyncPlugin` 的 `update` 钩子（y-tiptap 源码 line 248）检测"ProseMirror 内容 == 默认空文档" → `findDiffStart` 返回 null → **判定无需同步** → Yjs 永远空
4. ProseMirror 初始事务触发 `yUndoPlugin.apply` → 转换 pos 1 → 在空 Yjs 根里找不到 → `findRootTypeKey` 报错

### 修复
在创建 Collaboration 前，预填充一个空段落到 Yjs：
```js
const fragment = ydoc.getXmlFragment('default')
if (fragment.length === 0) {
  const para = new Y.XmlElement('paragraph')
  fragment.push([para])
}
```
**这个修复不能删，删了会复发 `Unexpected case`。**

### 关键源码位置（node_modules，重装会变）
- y-tiptap `absolutePositionToRelativePosition`：`@tiptap/y-tiptap/dist/y-tiptap.js` 约 line 1841
- y-tiptap `ySyncPlugin` 的 `update` 钩子（同步判定）：同文件约 line 238-271
- y-tiptap `yUndoPlugin.apply`（报错触发点）：同文件约 line 2880
- yjs `findRootTypeKey`：`yjs/dist/yjs.mjs` 约 line 2063

---

## 六、已完成功能的技术细节

### 6.1 远程光标/选区显示

**实现方式**：用 `@tiptap/y-tiptap` 导出的 `yCursorPlugin` 封装成 Tiptap Extension，通过 `collabExtensions` 注入。

**关键点**：
- `yCursorPlugin(provider.awareness)` 全自动管理——监听 awareness 变化重建 decoration，编辑器聚焦/选区变化时自动写 cursor 字段
- 从 awareness 的 `user` 字段读取 name/color 渲染光标
- `color` 必须是 `#RRGGBB` 格式（`defaultSelectionBuilder` 会拼 alpha 后缀 `#RRGGBB70`，且正则 `/^#[0-9a-fA-F]{6}$/` 校验）
- `defaultAwarenessStateFilter` 自动过滤自己的 clientId（不显示自己的光标）
- CSS 类：`.ProseMirror-yjs-cursor`（竖线 + 名字气泡）、`.ProseMirror-yjs-selection`（选区背景）

**注意**：`@tiptap/extension-collaboration-cursor` 不存在（未发布），必须自己用 `Extension.create` + `yCursorPlugin` 封装。

### 6.2 JWT 鉴权

**数据流**：
1. 前端 `token: async () => fetch('/api/token?name=xxx&doc=xxx')` 获取 JWT
2. HocuspocusProvider 通过 Yjs 二进制协议消息（`MessageType.Auth`）把 token 发给服务端
3. 服务端 `onAuthenticate` 用 `jwt.verify(token, JWT_SECRET)` 验证
4. 文档级权限校验：token 的 `doc` claim 必须匹配请求的 `documentName`

**关键点**：
- 同端口 4000 同时提供 WebSocket + HTTP（通过 `onRequest` hook）
- `onRequest` 处理完 HTTP 后必须 `throw null`（falsy 值），否则 Hocuspocus 会再写一次响应头导致 `ERR_HTTP_HEADERS_SENT`
- `onAuthenticate` 鉴权失败时抛 `{ reason: '中文原因' }` 对象（不是 `Error`），前端 `authenticationFailed` 事件才能收到自定义原因（Hocuspocus 源码：`error.reason ?? 'permission-denied'`）
- JWT claims：`{ name, doc, iat, exp }`（HS256，24h 过期）
- 签发端点无鉴权保护（demo 阶段，生产需加业务系统鉴权）

**配置**：
- `JWT_SECRET`：环境变量，默认 `umo-collab-secret-dev-only`
- `JWT_EXPIRES_IN`：环境变量，默认 `24h`

### 6.3 数据库持久化（SQLite）

**架构**：存储层抽象为 `collab-server/storage.js`，导出 `loadDoc(name)` / `saveDoc(name, buffer)` / `closeDb()`。切 MySQL/PG 只需替换此文件。

**关键点**：
- `better-sqlite3`（同步 API，原生模块，预编译无需 node-gyp）
- WAL 模式（读写并发，写串行——协同场景写频率极低，完全够用）
- 全量快照存储（`encodeStateAsUpdate` 每次存整份文档，UPSERT 覆盖写）
- Hocuspocus 自带防抖：`debounce: 2000ms`（编辑停顿 2s 触发），`maxDebounce: 10000ms`（累计 10s 强制触发），最后连接断开时立即 flush
- schema：`documents(name TEXT PRIMARY KEY, content BLOB, updated_at INTEGER)`

### 6.4 多文档编辑

**实现**：前端 `collabDoc = urlParams.get('doc') || 'demo-doc'`，provider 的 `name` 和 token fetch 的 `doc` 参数都用它。

**为什么改动小**：多文档的基础设施在之前的任务里已全部就绪——Hocuspocus 按 `documentName` 隔离，SQLite 用 `name` 做 PRIMARY KEY，JWT 有文档级权限校验，yCursorPlugin 按 awareness 分文档隔离。唯一缺的就是前端把文档名从写死改成动态。

**并发容量**：单实例典型场景（5-20 人/篇）完全够用。awareness 广播的 O(N²) 复杂度是瓶颈——100+ 人/篇需阶段三的多实例 + Redis。SQLite 写入不构成限制（防抖后写频率极低）。

### 6.5 同步节流（flushDelay 80ms）

**配置**：`HocuspocusProvider` 的 `flushDelay: 80` 选项。

**机制**（provider 源码 `documentUpdateHandler`）：
- 每个 Yjs update 进 `pendingUpdates` 队列
- `scheduleFlush` 设 80ms 定时器（连续输入时不重设，一个窗口内多个按键都被合并）
- 定时器触发时 `Y.mergeUpdates(pendingUpdates)` 合并成**一个** update 再 `send`
- awareness（光标）走同样的节流，内容与光标体验一致

**为什么选 80ms**：低于人眼感知阈值（~100ms），连续打字每键间隔约 125-200ms，80ms 能合并连续输入，包数量减少 60-80%。

**关闭节流**：不设 `flushDelay`（默认），每个按键立即发一个包（0ms 应用层延迟，但高频输入时包数量大）。

**同步延迟实测**（localhost）：约 5-15ms（应用层 0ms + 网络 1-5ms + 服务端转发 1ms + B 端渲染 1-5ms）。

### 6.6 协作者图例与权限控制

**协作者图例**（状态栏头像组）：
- 数据源：`provider.on('awarenessChange', ({states}) => ...)`，states 是 `[{clientId, user:{name,color,role}}]`
- app.vue（根组件）`provide('collaborators', collaborators)`，statusbar `inject('collaborators')` 渲染
- UI：状态栏左区末尾，彩色头像圆圈（首字母 + color 背景）层叠排列，hover 弹出详情浮层（用户名 + 权限标签）
- 位置在字数统计/版权之后、右区视图工具（全屏/缩放/语言）之前——"文档状态"信息归在左半边

**编辑/只读权限**（三重保障）：
```
URL ?role=viewer
  → JWT claims 带 role:viewer（/api/token?role=viewer）
  → 服务端 connection.readOnly = true（强制：Hocuspocus 拒绝该连接的 update）
  → 前端 editor.setEditable(false)（体验：编辑器 contenteditable=false）
  → awareness user.role='viewer'（显示：图例标签"只读"，灰色）
```
- **服务端 readOnly 是权威**：即使前端被绕过，Hocuspocus 的 `MessageReceiver`（server dist line 1415/1447）会拒绝 readOnly 连接的 update
- **awareness 的 role 是客户端自报**：可篡改，但只影响图例显示，不影响实际权限（实际权限由服务端强制）
- demo 阶段用 URL 参数测，生产环境 `/api/token` 端点接业务系统鉴权，由业务系统决定每个用户的 role

---

## 七、撤销/重做：已修复 undo，redo 仍有边界问题

### 当前状态（2024 实测修复后）

| 功能 | 状态 | 说明 |
|---|---|---|
| 协同 undo（撤销） | ✅ 已修复 | 操作进栈，按钮 enabled，撤销后内容回滚 |
| 协同 redo（重做） | ⚠️ 部分可用 | undo 后 redo 栈被清空，无法重做（见下方"redo 遗留问题"） |

### 修复内容（都在 `src/components/index.vue`，协同模式的 `editor.on('create')` 钩子里）

**1. 绕过 extension-collaboration 坏掉的 undo/redo 命令（原 Bug B）**
- 直接从 `yUndoPlugin` 的 plugin state 取出 Yjs UndoManager：`yUndoPluginKey.getState(editor.state).undoManager`
- `undoHistory`/`redoHistory` 协同分支改为直接调 `um.undo()` / `um.redo()`，不走 `editor.commands.undo()`（后者因 Tiptap3 preventDispatch 永不执行）
- 用 `yUndoPluginKey` 必须从 `@tiptap/y-tiptap` import 同一个实例；**不能 `new PluginKey('y-undo')` 重建**——ProseMirror 的 `createKey` 是模块级计数器，重建会得到 `y-undo$1` 而 getState 永远 undefined
- 按钮状态（`collabCanUndo/Redo`）改为监听 UndoManager 的 `stack-item-added/popped/updated/cleared` 事件刷新

**2. 修复 UndoManager trackedOrigins 多副本问题（原 Bug A 的真正根因）**
- **根因**：UndoManager 的 `trackedOrigins` Set 里登记的 `ySyncPluginKey` 实例，与 `_prosemirrorChanged` 开事务时实际用的 `ySyncPluginKey` 实例**不是同一个对象引用**（两者 `.key` 均为 `'y-sync$'` 但 `===` 为 false）。疑似 Vite 预构建导致 y-tiptap 的 PluginKey 存在两个实例。
- 后果：`afterTransactionHandler` 里 `trackedOrigins.has(tx.origin)` 用 Set 引用相等判断 → 永远 false → 操作不进 undo 栈（栈始终为空）。
- 诊断铁证：浏览器实测 `trackedDetails: [{ctor:"PluginKey", key:"y-sync$", sameRef:false}]`——两个实例 key 相同但引用不同。
- **修复**：在 ydoc 的 `beforeTransaction`（事务执行前）监听里，捕获事务实际用的 origin 实例，补登记进 `trackedOrigins`：
  ```js
  binding.doc.on('beforeTransaction', (tx) => {
    if (tx.origin?.key === 'y-sync$' && !um.trackedOrigins.has(tx.origin)) {
      um.trackedOrigins.add(tx.origin)
    }
  })
  ```
  必须用 `beforeTransaction` 而非 `afterTransaction`——后者在 UndoManager 的 handler 之后触发，第一次真实改动的事务已经错过进栈时机。
- E2E 验证：输入后 `undo栈=1 canUndo=true`，`um.undo()` 后内容回滚（`doc含E2E=false`）。

### redo 遗留问题（未修复）

`um.undo()` 执行后，redo 栈仍为空（`redoStack.length === 0`），无法 redo。
- **推测原因**：`um.undo()` 产生 origin=UndoManager 的 ydoc 事务 → ydoc 变化触发 ySyncPlugin 的 `_typeChanged`（远程→PM 整体重建）→ PM 重建触发 `_prosemirrorChanged` → 产生新的 origin=y-sync$ 事务 → UndoManager 把它当作"新编辑"，**清空 redoStack**（UndoManager 遇到非 undo/redo 事务会清 redo 栈）。
- 这是协同 undo 的经典难题：本地 undo 的效果经过 ydoc 中转后，会触发额外的"看起来像新编辑"的事务。
- **可能的修复方向**：
  1. 在 `_typeChanged` 触发的 `_prosemirrorChanged` 事务上标记 origin 为 UndoManager（避免清 redo 栈）
  2. 用 `um.stopCapturing()` 的时机控制
  3. 监听 UndoManager 的 `stack-item-popped` 事件，手动维护 redo 栈

### 历史诊断（已被实测推翻，保留作参考）

> 以下是最初的推测，已被实测推翻。真正根因见上方"修复内容"。

**原推测 Bug A（错误）**：曾怀疑是 y-tiptap 的"嵌套事务"导致 `changedParentTypes` 为空。实测证明 `updateYFragment` 本身工作正常（Node 脚本验证：空 paragraph + PM 文本能正确写入 ydoc），且 `_prosemirrorChanged` 被调用时 ydoc 确实变化了（`ydocChanged=true`）。真正问题是 UndoManager 的 origin 引用不匹配，与嵌套事务无关。

**原推测 Bug B（正确）**：extension-collaboration 的 `preventDispatch` 问题确实存在，诊断准确。修复方式是绕过命令、直接调 undoManager。

**额外发现（Tiptap 命令系统在协同下的限制）**：实测发现 `editor.chain().insertContent().run()` 在协同模式下不改 PM doc（`textBefore === textAfter`），而 PM 原生 `view.dispatch(tr)` 正常。这是 Tiptap 3.x 命令系统与协同模式的另一个兼容问题，但不影响 undo（undo 走的是 um.undo()，不走 Tiptap 命令）。真实键盘输入走 PM 原生 dispatch 路径，不受此影响。

### 关键源码位置
- `src/components/index.vue` `editor.on('create')` 钩子：undoManager 取出 + trackedOrigins 修复 + 事件刷新
- `src/components/index.vue` `undoHistory`/`redoHistory`：协同分支直接调 `um.undo()/redo()`
- `@tiptap/y-tiptap` `_prosemirrorChanged`（y-tiptap.js:~811）：用 `ySyncPluginKey` 开事务（产生 origin）
- `@tiptap/y-tiptap` `yUndoPlugin`（y-tiptap.js:~2864）：`trackedOrigins: new Set([ySyncPluginKey].concat(...))`
- `yjs` `UndoManager.afterTransactionHandler`（yjs.mjs:3625-3633）：`trackedOrigins.has(transaction.origin)` 检查

---

## 八、待实现功能（阶段三 + 遗留）

### 遗留（阶段二未完成）

| 功能 | 说明 |
|---|---|
| 协同 redo（重做） | undo 后 redo 栈被清空（见第七节"redo 遗留问题"）。推测原因：undo 产生的 ydoc 事务触发 `_typeChanged` 重建 PM，又触发 `_prosemirrorChanged` 新事务，UndoManager 误判为"新编辑"清空 redo 栈。可能修复方向：在 `_typeChanged` 触发的事务上标记 origin 为 UndoManager |
| 权限管理 UI | 当前权限由 URL 参数 `?role=` 指定（demo 用）。生产需加邀请/权限表管理界面（SQLite 加 permissions 表，或接业务系统） |
| 用户颜色唯一性 | 当前 8 色随机分配，人多会撞色。可改用用户 ID 哈希生成颜色 |

### 阶段三（生产化）

| 功能 | 说明 |
|---|---|
| 多实例扩展 | `@hocuspocus/extension-redis` 跨节点广播 |
| 高可用 | K8s + liveness probe + 优雅停机 |
| 监控 | Prometheus 指标（连接数/房间数/合并耗时） |
| 限流/防滥用 | 单房间人数上限、速率限制 |
| 业务系统对接 | JWT 签发端点 `/api/token` 接业务系统鉴权（当前无保护，任何人可签 token） |
| 向 tiptap 报 issue | Bug B（preventDispatch）+ trackedOrigins 多副本 + Tiptap 命令协同不兼容，都有精确诊断证据 |

---

## 九、架构图

```
┌──────────────┐   WebSocket    ┌─────────────────────────────┐
│  浏览器 A    │ ────────────► │                             │
│ ?collab=1    │ ◄──────────── │  Hocuspocus (Node.js:4000)  │
│ &doc=xxx     │   Yjs 二进制   │                             │
│ (editor)     │   flushDelay   │  onAuthenticate:            │
│ Umo Editor   │   80ms 合并    │    JWT 验证 + 文档级权限     │
│ + Collab扩展 │                │    + role→readOnly (viewer) │
│ + Cursor扩展 │                │  onLoadDocument (SQLite 读) │
│ + 光标样式    │                │  onStoreDocument (SQLite 写)│
│ + 状态栏头像组│                │  onRequest (/api/token 签发)│
└──────────────┘                │                             │
┌──────────────┐   WebSocket    │  ┌─────────────────────┐   │
│  浏览器 B    │ ────────────► │  │  storage.js         │   │
│ ?collab=1    │ ◄──────────── │  │  loadDoc/saveDoc    │   │
│ &doc=xxx     │                │  │  ↓                  │   │
│ &role=viewer │                │  │  SQLite (WAL 模式)  │   │
│ (只读,setEdit│                │  │  data/collab.db    │   │
│  able=false) │                │  └─────────────────────┘   │
└──────────────┘                │                             │
                                │  Hocuspocus 防抖：          │
                                │  debounce 2s / maxDebounce  │
                                │  10s / 断开立即 flush       │
                                │  provider flushDelay 80ms   │
                                └─────────────────────────────┘
```

---

## 十、关键注意事项

1. **`@tiptap/y-tiptap` 版本必须与 tiptap 主包兼容**：当前 3.0.8 + tiptap 3.20.0 可用。`package.json` overrides 防止 editor-external 拉入旧版。
2. **yjs 版本必须前后端一致**：当前都是 13.6.29。
3. **Hocuspocus Server 是单例非构造函数**：用 `Server.configure({...})`，不是 `new Server({...})`。
4. **协同模式禁用 UndoRedo**：`disableExtensions: ['undoRedo']`，否则与 Collaboration 的 history 冲突。
5. **预填充段落是硬修复**：`app.vue` 里的 `new Y.XmlElement('paragraph')`，不能删。
6. **onRequest hook 的 falsy throw**：处理完 HTTP 请求后必须 `throw null`，否则 `ERR_HTTP_HEADERS_SENT`。
7. **onAuthenticate 的错误对象**：抛 `{ reason: '...' }`（不是 `Error`），前端才能收到自定义原因。
8. **collabUser.color 必须是 `#RRGGBB`**：hsl/rgb 格式会导致选区背景色无效。
9. **Hocuspocus 前后端版本不对齐**：前端 `@hocuspocus/provider` 4.4.0，服务端 `@hocuspocus/server` 2.15.3。当前 token 协议兼容，但建议后续对齐。
10. **better-sqlite3 是原生模块**：Windows 上用预编译二进制，无需 node-gyp。换 Node 版本可能需 rebuild（`npm rebuild better-sqlite3`）。
11. **yUndoPluginKey 必须 import 不能 new**：取 undoManager 要 `import { yUndoPluginKey } from '@tiptap/y-tiptap'` 用同一实例，不能 `new PluginKey('y-undo')` 重建（createKey 计数器会得 `y-undo$1`，getState 返回 undefined）。
12. **光标 CSS 不能嵌套进 `:-webkit-any` 块**：`.ProseMirror-yjs-cursor` 必须在 `.umo-editor-content` 直接作用域下，否则选择器匹配不上，opacity/position 失效导致用户名占行（见第四节坑#8）。
13. **Vite 改 node_modules 源文件不生效**：Vite 用 `node_modules/.vite/deps/` 预构建缓存，改 `node_modules/@tiptap/y-tiptap/dist/y-tiptap.js` 后必须删 `.vite/deps` 并重启 dev server（`--force`）才会重新预构建。
14. **trackedOrigins 多副本是 undo 的核心坑**：协同模式下 undoManager 的 trackedOrigins 里的 ySyncPluginKey 与事务实际用的不是同一实例（Vite 预构建导致），需在 `beforeTransaction` 捕获实际 origin 补登记（见第七节修复内容）。

---

## 十一、demo 宿主应用（`demo/` 子目录，独立 Vite 应用）

> 这是一个**独立的宿主应用 demo**，展示如何把 `@umoteam/editor` 集成到真实业务里。完整流程：**登录页（用户名 + 角色 + 模式）→ 文档列表（新建/删除/打开）→ 文档编辑器**。与库本身完全隔离，自带独立的 `package.json`/`vite.config.js`，不影响库的 `npm run build`。

### 11.1 三层架构

```
┌─────────────┐   REST(文档元数据)    ┌──────────────┐
│  demo 前端   │ ───────────────────→ │  demo 后端    │  demo/server：列表/创建/删除（端口 4001）
│ (Vue3+Vite) │                      │ (Node+SQLite) │  存 id/title/createdBy/时间戳
│ :5173       │   WebSocket(Yjs协同)  ├──────────────┤
│             │ ───────────────────→ │ collab-server │  上层仓库自带：Yjs 实时同步（端口 4000）
└─────────────┘                      └──────────────┘
```

- **demo 后端**（`demo/server/`，自建）：只管**文档元数据**（REST：GET/POST/DELETE `/api/documents`），SQLite 存 id/title/createdBy/时间戳
- **collab-server**（上层仓库，不动）：只管 **Yjs 实时协同**（内容同步、光标、二进制持久化）
- **关联点**：demo 后端创建文档生成的 **uuid**，同时作为 ① demo 后端主键 ② collab-server 的 Yjs `documentName`，两边通过 uuid 关联，互不碰对方的数据

### 11.2 双模式（单机 / 协同）

登录页选择，写入 `auth.user.mode`：
- **单机模式（standalone）**：文档存 localStorage，开箱即用，零后端依赖
- **协同模式（collab）**：文档列表走 demo 后端 REST（多用户共享），编辑器内容走 collab-server 的 Yjs 协同（实时同步 + 光标）

**需求动机**：单机模式用 localStorage 是单浏览器本地的，跨用户看不到；协同模式让用户 A 建的文档用户 B 立刻能看到、能同时编辑。

### 11.3 目录结构

```
demo/
├── package.json              # @umoteam/editor 走 file:.. 引用本地仓库 dist/
├── vite.config.js            # optimizeDeps.exclude + resolve.dedupe（见 11.6 关键坑）
├── index.html
├── server/                   # demo 自建后端
│   ├── package.json          #   deps: better-sqlite3 13.0.2, uuid 10.0.0
│   ├── index.js              #   http + SQLite + REST 路由（端口 4001）
│   └── data/                 #   SQLite 数据（gitignore）
└── src/
    ├── main.js               # 注册 router + TDesign + useUmoEditor + 引入样式
    ├── App.vue
    ├── router/index.js       # 3 路由 + 登录守卫
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
        ├── DocumentsView.vue    # 文档列表（双模式 + loading/失败态）
        └── EditorView.vue       # 编辑器页（单机 localStorage / 协同 Yjs+Hocuspocus + 工具栏人员信息注入）
```

### 11.4 关键功能实现

**EditorView.vue 协同分支**（参照 `src/app.vue` 成熟实现）：
- `new Y.Doc()` + `HocuspocusProvider({ url: getCollabWsUrl(), name: docId, token: fetch collab-server /api/token, ... })`
- **构造函数回调**注册事件（`onSynced`/`onAuthenticationFailed`/`onAwarenessChange`/`onAwarenessUpdate`），避免事件早于监听器的竞争（比 `provider.on()` 更可靠）
- 预填空段落（修 y-prosemirror 初始竞争，同第五节）
- `extensions:[Collaboration, 远程光标Extension]`、`disableExtensions:['undoRedo']`、`document.content:''`（协同内容由服务端驱动）
- `v-if="doc && editorReady"` 等同步后挂编辑器，连接中显示「正在连接协同服务…」
- `onUnmounted` 销毁 provider/ydoc

**工具栏人员信息注入**（`EditorView.vue` 的 `injectToolbarInfo`）：
- 编辑器工具栏的 `.umo-toolbar-actions` **不暴露 slot**，只能挂载后 DOM 注入
- 注入元素 `.umo-demo-toolbar-info` 到 `.umo-toolbar-actions-ribbon` 内末尾，含头像组（首字母 + 叠加）+ 编辑/查看 tag + 协同/单机 tag
- 单机显示自己 1 人，协同显示所有在线协作者（awareness 驱动，去重）
- 头像组可点击，弹出人员浮框（挂 document.body，定位头像下方），每人显示头像+用户名+角色（编辑/查看）
- 点击外部/滚动/缩放自动关闭；`@changed:toolbar` 事件触发 ribbon↔classic 切换后重新注入
- **每次注入都从容器内重新查询宿主**（`container.querySelector(INFO_HOST_CLASS)`），避免编辑器重渲后 `infoHostEl` 变游离节点导致事件失效
- 头像点击绑定用 `addEventListener`（每次 renderInfoBar 重绑），**不要用 inline onclick + window 全局**——HMR/重渲后全局函数会丢失

### 11.5 库的工具栏布局重构（`src/components/toolbar/index.vue`）

**需求**：把 ribbon 模式工具栏从「tabs 与 actions 同行」改为两行——标题行在上，tabs 下移：

```
┌─────────────────────────────────────────────────────────────┐
│ 文档标题                    保存状态│切换工具栏│人员信息│编辑│协同 │  ← 标题行（新增）
├─────────────────────────────────────────────────────────────┤
│ 开始  插入  表格  工具  页面  视图  导出                      │  ← tabs（下移）
│ [...工具按钮组...]                                            │
└─────────────────────────────────────────────────────────────┘
```

**改动**：
- 模板按 ribbon / classic 模式分离为两个独立 `<div>` 结构（`v-if` / `v-else-if`）
- ribbon 容器加 `.umo-toolbar-container-ribbon`（`flex-direction: column`），内含 `.umo-toolbar-header`（标题行）+ `<toolbar-ribbon>`
- `.umo-toolbar-header`：`display:flex; justify-content:space-between`，左 `.umo-toolbar-title`（文档标题，`$document.value.title`，响应式），右 `.umo-toolbar-actions-ribbon`
- `.umo-toolbar-actions-ribbon` 去掉 `position:absolute; right:0; top:1px`，改 `position:static`（标题行内自然右对齐）
- classic 模式**完全不变**（用户只要 ribbon 改动）
- modern skin 覆盖：移除 ribbon 的 `right/top !important`，改为给标题行加 padding
- demo 的 EditorView 顶部栏去掉文档标题（避免与工具栏标题行重复）

**注意**：demo 通过 `file:..` 引用库的 `dist/`，**库的工具栏改动必须 `npm run build` 重新构建后 demo 才生效**。

### 11.6 集成时的关键坑（demo 特有，库本身不会遇到）

| # | 报错/现象 | 根因 | 解决 |
|---|---|---|---|
| D1 | Vite 预打包报 `incompatible with the dep optimizer`（@umoteam/editor） | 编辑器是已构建的 ESM bundle，Vite 试图预打包它失败 | `optimizeDeps.exclude: ['@umoteam/editor']` |
| D2 | 协同编辑器挂载后报 `Cannot read properties of undefined (reading 'localsInner')` | demo 自己装的 `@tiptap/core`/`prosemirror-*` 与编辑器 bundle 外部化的实例是两个不同模块，ProseMirror schema instanceof 校验失败 | `resolve.dedupe` 强制 vue/yjs/@tiptap/*/prosemirror-* 用单一实例；并把 `@tiptap/*` 版本锁到 3.20.0（与库一致） |
| D3 | 协同模式编辑器不挂载（`editorReady` 一直 false） | HocuspocusProvider 的 `synced` 事件在 `provider.on('synced')` 注册前就触发了（事件竞争） | 用构造函数回调 `onSynced()` 注册（在内部建立连接前），比 `provider.on()` 更可靠 |
| D4 | 工具栏人员信息注入后点击无反应 | inline `onclick` + `window.__xxx` 全局函数在 HMR/重渲后丢失；或 `infoHostEl` 引用变成游离节点 | `addEventListener` 每次 renderInfoBar 重绑；每次注入都从容器重新查询宿主 |
| D5 | utf-8 中文在 curl 测试时乱码 | Git Bash 的 curl `-d` 在 Windows 把中文编码成 GBK | 服务端 UTF-8 处理正常（前端 fetch 发标准 UTF-8），curl 测试用 Node fetch 验证 |

### 11.7 启动方式（3 个终端）

```bash
# 终端 1：协同服务（上层仓库，不动）
cd D:\workspace\editor\collab-server && npm install && npm start   # :4000

# 终端 2：demo 后端（自建）
cd D:\workspace\editor\demo\server && npm install && npm start      # :4001

# 终端 3：demo 前端
cd D:\workspace\editor\demo && npm install && npm run dev           # :5173

# 浏览器：登录页选「协同模式」，开两个窗口用不同用户名登录
# → 用户 A 建文档，用户 B 列表立刻可见 → 两人同时编辑实时同步
# 单机模式：只开终端 3 即可，登录选「单机模式」
```

**运行时配置**（可选，部署时无需重新构建）：
```js
window.__UMO_API_URL__    = 'https://api.your-domain.com'     // demo 后端（REST）
window.__UMO_COLLAB_URL__ = 'wss://collab.your-domain.com'    // 协同服务（WebSocket）
```

---

## 十二、新对话快速接续指南

在新对话里可以这样开头：

> "我在给 Umo Editor（D:\workspace\editor）做协同编辑 + demo 宿主应用。阶段二协同核心（光标、JWT、SQLite、多文档、undo、协作者图例、权限）已完成，还做了一个独立的 demo 应用（登录/文档列表/编辑器，单机+协同双模式，工具栏标题行布局+人员信息浮框）。请看 COLLAB_HANDOFF.md 了解全部背景。接下来要做 [具体任务]。"

常见接续任务：
- "修复协同 redo" → 第七节"redo 遗留问题"（undo 后 redo 栈被清空，需研究 `_typeChanged` 触发的事务如何避免清栈）
- "做权限管理 UI" → 第八节（当前权限由 URL `?role=` 或 demo 登录角色指定，需加邀请/权限表界面）
- "做 Redis 多实例广播" → 第八节（阶段三）
- "优化大并发性能" → awareness 广播 O(N²) 是瓶颈，需多实例 + Redis（阶段三）
- "向 tiptap 报 issue" → 第八节（preventDispatch + trackedOrigins 多副本 + Tiptap 命令协同不兼容，都有诊断证据）
- "切到 MySQL/PostgreSQL" → 替换 `collab-server/storage.js`，保持 `loadDoc`/`saveDoc`/`closeDb` 签名
- "验证 columns/callout 等节点的协同兼容性" → 逐个测试 Umo 自定义扩展
- "demo 协同文档标题在编辑器内同步" → 当前协同文档标题创建时定死（不写回 demo 后端 meta），如需编辑器内改标题同步元数据，需加 PATCH /api/documents/:id + 监听编辑器 title 变化
- "demo 工具栏布局再调整" → 第十一节 11.5（toolbar/index.vue 的 ribbon 模式标题行结构）

### 当前所有改动文件清单（`git diff --stat`）

```
# 库源码（协同 + 工具栏布局）
COLLAB_HANDOFF.md                            # 本文档
collab-server/server.js                      # token 端点加 role + onAuthenticate 设 readOnly
src/app.vue                                  # role/collaborators/flushDelay/provide/setEditable
src/assets/styles/editor.less                # 光标 CSS 修复（移出 :-webkit-any）+ 协作者头像组样式
src/components/editor/index.vue              # onUpdate 传 isCollab
src/components/index.vue                     # undoManager 取出 + trackedOrigins 修复 + undoHistory 协同分流
src/components/menus/toolbar/base/undo.vue   # 协同 disabled 绑定
src/components/menus/toolbar/base/redo.vue   # 协同 disabled 绑定
src/components/statusbar/index.vue           # 协作者头像组 UI
src/components/toolbar/index.vue             # ribbon 模式工具栏标题行布局（文档标题+actions 上移一行，tabs 下移）
src/utils/history-record.js                  # addHistory 协同短路

# demo 宿主应用（独立子项目，新增）
demo/                                        # 整个 demo 目录是新增
demo/package.json                            # @umoteam/editor(file:..) + tdesign + vue-router + 协同客户端包
demo/vite.config.js                          # optimizeDeps.exclude + resolve.dedupe（修 D1/D2）
demo/server/                                 # demo 自建后端（Node + SQLite + REST，端口 4001）
demo/src/main.js                             # 注册 router + TDesign + useUmoEditor
demo/src/App.vue                             # router-view + 过渡动画
demo/src/router/index.js                     # 3 路由 + 登录守卫
demo/src/store/auth.js                       # 用户名/角色/模式（localStorage）
demo/src/store/documents.js                  # 文档 CRUD 双模式 + uuid + 摘要/相对时间
demo/src/utils/api.js                        # demo 后端 REST 客户端
demo/src/utils/collab-config.js             # 协同服务地址解析
demo/src/views/LoginView.vue                 # 登录页（用户名+角色+单机/协同模式）
demo/src/views/DocumentsView.vue             # 文档列表（双模式+loading/失败态）
demo/src/views/EditorView.vue                # 编辑器（单机/协同双模式 + 工具栏人员信息注入+浮框）
demo/README.md                               # demo 启动说明
```

### 启动验证

**方式 A：库协同 dev（最快验证协同能力本身）**
```bash
cd D:\workspace\editor\collab-server && npm start   # 端口 4000（协同服务）
cd D:\workspace\editor && npm run dev               # 端口 9000（库 dev demo）
# 浏览器：两个 ?collab=1&doc=test 窗口，或 A 用 ?role=viewer 测只读
# 观察：状态栏左区出现协作者头像组，hover 看权限标签，viewer 无法编辑
```

**方式 B：完整 demo（登录/列表/编辑器 + 单机/协同双模式，3 个终端）**
```bash
cd D:\workspace\editor\collab-server && npm start   # :4000（协同服务）
cd D:\workspace\editor\demo\server && npm start     # :4001（demo 后端）
cd D:\workspace\editor\demo && npm run dev          # :5173（demo 前端）
# 登录选「协同模式」，开两个窗口不同用户名 → A 建文档 B 列表可见 → 实时协同编辑
# 单机模式：只开 demo 前端（终端 3），登录选「单机模式」即可
# 注意：改了库源码（如 toolbar/index.vue）必须 cd D:\workspace\editor && npm run build 重建，demo 才生效
```
