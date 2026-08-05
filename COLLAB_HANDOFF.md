# Umo Editor 协同编辑开发交接文档

> 本文档供切换对话时使用，包含完整的项目背景、已完成工作、技术细节和后续计划。
> 最后更新：多文档编辑完成后

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
```

---

## 二、当前状态：阶段二核心功能已完成 ✅

### 已完成功能总览

| 功能 | 状态 | 说明 |
|---|---|---|
| 内容实时同步 | ✅ 完成 | 阶段一，多窗口实时同步编辑 |
| 远程光标/选区显示 | ✅ 完成 | 彩色竖线 + 用户名标签 + 选区背景色 |
| JWT 鉴权 | ✅ 完成 | HS256，服务端验证 + 文档级权限校验 |
| 数据库持久化 | ✅ 完成 | SQLite（WAL 模式），重启不丢数据 |
| 多文档编辑 | ✅ 完成 | URL 参数 `?doc=xxx` 指定文档，互不干扰 |
| 撤销/重做 | ⏸️ 卡在上游 bug | Umo 层改动已完成，根因在 y-tiptap（见第七节） |

### 三阶段规划

| 阶段 | 内容 | 状态 |
|---|---|---|
| **阶段一** | 最小协同服务 + 前端接入验证 | ✅ 完成 |
| **阶段二** | 准生产：光标 UI、JWT 鉴权、数据库持久化、多文档 | ✅ 基本完成（撤销/重做除外） |
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
- `onRequest`：HTTP token 签发端点 `GET /api/token?name=xxx&doc=xxx`（同端口 4000 提供 WebSocket + HTTP）
- `onAuthenticate`：JWT 验证（`jwt.verify`）+ 文档级权限校验（token 的 doc claim 必须匹配 documentName）
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

**核心设计**：URL 参数 `?collab=1` 切换协同/单机模式，`?doc=xxx` 指定文档名。**单机模式完全不受影响**。

当前改动点：
- **import**：`Collaboration`、`Extension`（@tiptap/core）、`yCursorPlugin`（@tiptap/y-tiptap）、`HocuspocusProvider`、`Y`、`onUnmounted`、`ref`
- **`collabEnabled`**：`urlParams.has('collab')`
- **`collabDoc`**：`urlParams.get('doc') || 'demo-doc'`（多文档支持）
- **`collabUser`**：随机用户名 + 从预设 hex 色池随机选颜色（**color 必须是 `#RRGGBB` 格式**，yCursorPlugin 的 `defaultSelectionBuilder` 会拼 alpha 后缀并正则校验）
- **`editorReady`**：协同模式默认 `false`，等 `provider.on('synced')` 后置 `true`
- **`collabError`**：鉴权失败时显示错误信息
- **provider 连接**：`ws://localhost:4000`，文档名 `collabDoc`
- **token**：异步函数 `async () => fetch('/api/token?name=...&doc=...')`（JWT 动态获取）
- **`provider.on('authenticationFailed')`**：显示鉴权错误，不挂载编辑器
- **预填充段落（关键修复）**：创建 Collaboration 前，给 `ydoc.getXmlFragment('default')` push 一个 `new Y.XmlElement('paragraph')`——修复初始化竞争（见第五节）
- **`collabExtensions`**：注入 3 个扩展：
  1. `Collaboration.configure({ document: ydoc })` — Yjs 同步
  2. `collaborationCursor`（Extension.create + `yCursorPlugin(provider.awareness)`）— 远程光标/选区
  3. （undo/redo 的修复扩展当前未注入，见第七节）
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

### 3.5 撤销/重做的 Umo 层改动（已完成，等上游 bug 修复后即生效）

以下 5 个文件的改动逻辑正确，一旦 y-tiptap 的上游 bug 修复就能生效：

| 文件 | 改动 |
|---|---|
| `src/utils/history-record.js` | `addHistory` 增加 `isCollab` 参数，协同模式 editor 类型短路（不依赖 `state.history$`） |
| `src/components/editor/index.vue` | `onUpdate` 传入 `isCollab` 标志 |
| `src/components/index.vue` | `undoHistory`/`redoHistory` 协同分流（editor 走 Yjs undo，page 走 Umo 队列）+ `collabCanUndo`/`collabCanRedo` 响应式状态（在 `editor.on('transaction')` 里用 `editor.can().undo()` 刷新） |
| `src/components/menus/toolbar/base/undo.vue` | disabled 绑定协同分流（`isCollab ? !collabCanUndo : historyRecords.done.length === 0`） |
| `src/components/menus/toolbar/base/redo.vue` | 同上 |

### 3.6 `src/assets/styles/editor.less`（远程光标样式）

新增 `.ProseMirror-yjs-cursor`（光标竖线 + 悬停用户名气泡）和 `.ProseMirror-yjs-selection`（选区背景）样式。

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
| 7 | 协同模式撤销/重做不工作 | y-tiptap 两个上游 bug（见第七节） | 已诊断，待修复 |

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

---

## 七、撤销/重做：深层诊断（卡点，待修复）

### Umo 层面改动已完成（见 3.5 节），逻辑正确，卡在两个上游 bug

**Bug A：y-tiptap 嵌套事务导致 UndoManager 栈永远为空**
- `@tiptap/y-tiptap` 的 `_prosemirrorChanged`（y-tiptap.js:811）内部开了 `this.doc.transact(fn, ySyncPluginKey)`，而外层 ySyncPlugin 的 update 钩子（y-tiptap.js:266-270）已经在 `doc.transact()` 内调用了它
- 嵌套事务导致 Yjs 的 `transaction.changedParentTypes` 在 UndoManager 的 `afterTransactionHandler`（yjs.mjs:3625-3633）里为空
- UndoManager 的 scope 检查 `changedParentTypes.has(xmlFragment)` 永远为 false → 操作不进 undo 栈
- 诊断证据：monkey-patch `ydoc.emit` 统计 afterTransaction 触发 13 次，但 `changedParentTypesCount` 始终为 0

**Bug A2：去掉嵌套事务后 undo 数据损坏**
- 尝试去掉 `_prosemirrorChanged` 的嵌套事务（直接在外层事务执行 `updateYFragment`）→ 栈增长成功（按钮变 enabled）→ 但 `undoManager.undo()` 执行后内容不回滚
- `updateYFragment` 需要在自己的事务上下文里正确记录 Yjs item 变更，直接在外层事务执行导致 stack item 数据不完整

**Bug B：extension-collaboration 的 preventDispatch 导致命令不执行**
- `@tiptap/extension-collaboration` 的 undo/redo 命令（dist/index.js:107-131）设置了 `tr.setMeta('preventDispatch', true)`
- Tiptap 3.x 的命令执行器在 `preventDispatch` 时不传 `dispatch` 参数
- 命令在 `if (!dispatch) return true` 处直接返回，**永远不执行 `undo(state)`**
- 诊断证据：y-tiptap 的 `undo` 函数加日志，Ctrl+Z 后始终未被调用

**死锁关系**：Bug A 让栈空，去掉嵌套事务让栈数据损坏（A2），Bug B 独立阻断命令执行。

**升级 y-tiptap 无法解决**：3.0.8 已是最新版（latest），GitHub main 分支源码与 3.0.8 完全一致，bug 在上游仍存在。

**建议的后续方向**：
1. 向 tiptap 官方报 issue（两个 bug 都有精确诊断证据）
2. 深入研究 Yjs `cleanupTransactions` 为什么嵌套时不合并 `changed`
3. 换完全不同的 undo 方案：不用 Yjs UndoManager，按 PM 事务 origin 自定义 undo

**关键源码位置**：
- `@tiptap/y-tiptap/dist/y-tiptap.js:811`：`_prosemirrorChanged`（嵌套事务 bug）
- `@tiptap/y-tiptap/dist/y-tiptap.js:266-270`：ySyncPlugin update 钩子（外层事务）
- `@tiptap/extension-collaboration/dist/index.js:107-131`：undo/redo 命令（preventDispatch bug）
- `yjs/dist/yjs.mjs:3625-3633`：UndoManager afterTransactionHandler（scope 检查）
- `yjs/dist/yjs.mjs:5020-5031`：`callTypeObservers`（填充 changedParentTypes）

---

## 八、待实现功能（阶段三）

| 功能 | 说明 |
|---|---|
| 撤销/重做 | 见第七节，卡在上游 bug |
| 多实例扩展 | `@hocuspocus/extension-redis` 跨节点广播 |
| 高可用 | K8s + liveness probe + 优雅停机 |
| 监控 | Prometheus 指标（连接数/房间数/合并耗时） |
| 限流/防滥用 | 单房间人数上限、速率限制 |
| 只读模式 | `onAuthenticate` 里 `connection.readOnly = true`（Hocuspocus 已支持） |
| awareness 节流 | 光标更新节流（降低 O(N²) 广播量），提升大并发体验 |
| 业务系统对接 | JWT 签发端点接业务系统鉴权（当前无保护） |

---

## 九、架构图

```
┌──────────────┐   WebSocket    ┌─────────────────────────────┐
│  浏览器 A    │ ────────────► │                             │
│ ?collab=1    │ ◄──────────── │  Hocuspocus (Node.js:4000)  │
│ &doc=xxx     │   Yjs 二进制   │                             │
│ Umo Editor   │                │  onAuthenticate (JWT 验证)   │
│ + Collab扩展 │                │  onLoadDocument (SQLite 读) │
│ + Cursor扩展 │                │  onStoreDocument (SQLite 写)│
│ + 光标样式    │                │  onRequest (/api/token 签发)│
└──────────────┘                │                             │
┌──────────────┐   WebSocket    │  ┌─────────────────────┐   │
│  浏览器 B    │ ────────────► │  │  storage.js         │   │
│ ?collab=1    │ ◄──────────── │  │  loadDoc/saveDoc    │   │
│ &doc=xxx     │                │  │  ↓                  │   │
│ （同文档=A）  │                │  │  SQLite (WAL 模式)  │   │
└──────────────┘                │  │  data/collab.db    │   │
┌──────────────┐                │  └─────────────────────┘   │
│  浏览器 C    │ ────────────► │                             │
│ ?collab=1    │                │  Hocuspocus 防抖：          │
│ &doc=yyy     │                │  debounce 2s / maxDebounce  │
│ （不同文档）  │                │  10s / 断开立即 flush       │
└──────────────┘                └─────────────────────────────┘
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

---

## 十一、新对话快速接续指南

在新对话里可以这样开头：

> "我在给 Umo Editor（D:\workspace\editor）做协同编辑。阶段二核心功能（光标、JWT、SQLite 持久化、多文档）已完成。请看 COLLAB_HANDOFF.md 了解全部背景。接下来要做 [具体任务]。"

常见接续任务：
- "继续做撤销/重做" → 第七节（卡在两个上游 bug，需研究 yjs 嵌套事务或报 issue）
- "做 Redis 多实例广播" → 第八节（阶段三）
- "做只读模式" → 第八节（`connection.readOnly = true`）
- "优化大并发性能" → 第八节（awareness 节流）
- "切到 MySQL/PostgreSQL" → 替换 `collab-server/storage.js`，保持 `loadDoc`/`saveDoc`/`closeDb` 签名
- "验证 columns/callout 等节点的协同兼容性" → 逐个测试 Umo 自定义扩展
