/**
 * 协同文档存储层（SQLite 实现）
 * -----------------------------------------------------------
 * 后续切到 MySQL/PostgreSQL 时，只需替换本文件，
 * 保持 loadDoc / saveDoc / closeDb 三个导出的签名不变即可。
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 数据库文件路径（默认 collab-server/data/collab.db，可用 DB_PATH 环境变量覆盖）
const DB_PATH = process.env.DB_PATH || join(__dirname, 'data', 'collab.db')

// 确保 data 目录存在
mkdirSync(dirname(DB_PATH), { recursive: true })

// 初始化数据库（WAL 模式：读写可并发，写仍串行——协同场景下写频率极低，完全够用）
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    name       TEXT PRIMARY KEY,
    content    BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)

// 预编译语句（better-sqlite3 是同步 API，预编译提升性能）
const loadStmt = db.prepare('SELECT content FROM documents WHERE name = ?')
const saveStmt = db.prepare(`
  INSERT INTO documents (name, content, updated_at) VALUES (@name, @content, @updatedAt)
  ON CONFLICT(name) DO UPDATE SET content = @content, updated_at = @updatedAt
`)

/**
 * 读取文档二进制状态
 * @param {string} name 文档名
 * @returns {Buffer | null} Yjs 文档的 encodeStateAsUpdate 二进制，不存在则 null
 */
export const loadDoc = (name) => {
  const row = loadStmt.get(name)
  return row ? row.content : null
}

/**
 * 保存文档二进制状态（UPSERT：存在则更新，不存在则插入）
 * @param {string} name 文档名
 * @param {Buffer} buffer Yjs 文档的 encodeStateAsUpdate 二进制
 */
export const saveDoc = (name, buffer) => {
  saveStmt.run({ name, content: buffer, updatedAt: Date.now() })
}

/**
 * 关闭数据库连接（优雅停机时调用）
 */
export const closeDb = () => {
  db.close()
}
