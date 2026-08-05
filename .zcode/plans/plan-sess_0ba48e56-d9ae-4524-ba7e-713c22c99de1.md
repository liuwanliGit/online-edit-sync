## 任务：协同服务数据库持久化（SQLite）

### 目标
把 collab-server 的内存 Map 换成 SQLite 持久化。重启不丢数据。存储层抽象成独立模块，后续可切换到 MySQL/PG。

### 技术方案
- **数据库**：SQLite（`better-sqlite3`，同步 API、零配置、WAL 模式提升并发）
- **存储层抽象**：新建 `collab-server/storage.js`，导出 `loadDoc(name)` / `saveDoc(name, buffer)` 两个函数。当前实现用 SQLite，后续切 MySQL/PG 只需替换这个文件
- **schema**：单表 `documents(name TEXT PRIMARY KEY, content BLOB, updated_at INTEGER)`
- **防抖**：维持 Hocuspocus 默认（debounce 2000ms / maxDebounce 10000ms），不自己加
- **序列化**：维持 `encodeStateAsUpdate` / `applyUpdate`（全量快照，与当前内存版一致）

### 改动清单（3 个文件）

**1. `collab-server/package.json`** — 新增 `better-sqlite3` 依赖

**2. `collab-server/storage.js`（新建）** — 存储层抽象

```js
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const DB_PATH = process.env.DB_PATH || join(dirname(fileURLToPath(import.meta.url)), 'data', 'collab.db')

// 初始化数据库（WAL 模式提升读并发）
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    name TEXT PRIMARY KEY,
    content BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)

const loadStmt = db.prepare('SELECT content FROM documents WHERE name = ?')
const saveStmt = db.prepare(`
  INSERT INTO documents (name, content, updated_at) VALUES (@name, @content, @updatedAt)
  ON CONFLICT(name) DO UPDATE SET content = @content, updated_at = @updatedAt
`)

// 读取文档二进制状态，返回 Buffer 或 null
export const loadDoc = (name) => {
  const row = loadStmt.get(name)
  return row ? row.content : null
}

// 保存文档二进制状态（UPSERT）
export const saveDoc = (name, buffer) => {
  saveStmt.run({ name, content: buffer, updatedAt: Date.now() }
}
```

**3. `collab-server/server.js`** — 改用 storage.js 替代内存 Map

改动点：
- (a) 顶部新增 `import { loadDoc, saveDoc } from './storage.js'`，新增 `import { applyUpdate } from 'yjs'`（替换动态 import）
- (b) 删除内存 Map（`const store = new Map()`）和相关注释
- (c) `onLoadDocument`：`store.get(name)` → `loadDoc(name)`
- (d) `onStoreDocument`：`store.set(name, state)` → `saveDoc(name, state)`
- (e) 优雅停机的 `store.size` 日志改为 `db` 关闭（在 storage.js 导出 closeDb 或直接让进程退出时 SQLite 自动 flush）
- (f) onListen 日志更新为"SQLite 持久化"

**4. `collab-server/.gitignore`** — 新增 `data/`（SQLite 数据文件不纳入版本控制）

### 验证步骤
1. `cd collab-server && npm install`（装 better-sqlite3）
2. 重启 collab-server（杀旧进程 + npm start）
3. 浏览器打开协同窗口，编辑内容
4. **重启 collab-server**（杀进程 + 重新启动）
5. 再次打开协同窗口，确认内容还在（从 SQLite 恢复）
6. 确认 JWT 鉴权 + 光标同步仍正常
7. 确认单机模式不受影响
8. 检查 `collab-server/data/collab.db` 文件已生成

### 不做的事
- 不做 MySQL/PG 实现（架构预留切换，本次只做 SQLite）
- 不做增量 update 追加（维持全量快照，与当前一致）
- 不做多实例部署（阶段三 Redis 广播）
- 不做文档 GC / 压缩（Yjs 自带 GC，`yDocOptions: { gc: true }` 是默认值）

### 风险点
- `better-sqlite3` 是原生模块（C++ 编译），需要 node-gyp。Windows 上可能需要 Visual Studio Build Tools。如果编译失败，备选 `sql.js`（纯 JS 的 WASM SQLite，无需编译，但性能稍差）。
- SQLite 的 WAL 模式在 Windows 上工作正常，但 `data/` 目录需要存在（storage.js 初始化时自动创建）。