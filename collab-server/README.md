# Umo Editor 协同服务

基于 **Hocuspocus + Yjs** 的协同编辑服务，为 Umo Editor 提供多人实时协同、JWT 鉴权、文档级权限控制、SQLite 持久化和内置评论 API（REST + SSE）。单实例可支撑 5–20 人/篇的典型协同场景。

> 引擎的完整使用文档见仓库 [`docs/`](../docs/README.md)；本服务在 Docker 镜像中由引擎 nginx 统一反代（`/oes/*` 前缀）。

## 目录结构

```
collab-server/
├── server.js            # Hocuspocus 协同服务（端口 4000，WebSocket + HTTP 同端口）
├── storage.js           # SQLite 存储层抽象（loadDoc / saveDoc / closeDb）
├── comment-storage.js   # 评论存储层（独立 comments.db：REST + SSE）
├── e2e-test.mjs         # 端到端测试脚本
├── package.json
├── data/                # SQLite 数据目录（运行时生成，gitignore）
└── client-example/      # 前端接入示例
```

## 能力一览

| 能力 | 状态 | 说明 |
|---|---|---|
| 多人实时协同编辑 | ✅ | Yjs CRDT，内容实时同步，80ms 节流合并 |
| 远程光标 / 选区显示 | ✅ | 彩色竖线 + 用户名标签 + 选区背景 |
| JWT 鉴权 | ✅ | HS256，服务端验证 + 文档级权限校验 |
| 数据库持久化 | ✅ | SQLite（WAL 模式），重启不丢数据 |
| 多文档编辑 | ✅ | URL 参数 `?doc=xxx` 指定文档，互不干扰 |
| 编辑 / 只读权限 | ✅ | JWT role + 服务端 readOnly 双重保障 |
| 评论功能 | ✅ | 独立 comments.db，REST CRUD + SSE 实时推送（无鉴权，同源信任） |
| 协作者图例 | ✅ | 状态栏头像组 + hover 详情浮层 |
| 撤销 / 重做 | ⚠️ | undo 已修复；redo 仍有边界问题 |
| 多实例横向扩展 | ❌ | 阶段三：`@hocuspocus/extension-redis` 跨节点广播 |
| 监控 / 告警 | ❌ | 阶段三：Prometheus 指标 |

## 快速启动（开发）

```bash
cd collab-server
npm install        # 首次安装依赖
npm start          # 启动服务，端口 4000
```

启动成功后看到：

```
✅ 协同服务已启动: ws://localhost:4000
   鉴权方式: JWT (HS256)，签发端点 GET /api/token
   持久化方式: SQLite（WAL 模式）
```

再回到仓库根目录启动前端 dev server，即可联调：

```bash
cd ..
npm run dev        # 端口 9000
```

### URL 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `?collab=1` | — | 启用协同模式（不带该参数即单机模式，完全不受协同代码影响） |
| `?doc=xxx` | `demo-doc` | 指定文档名，多文档隔离 |
| `?role=viewer` | `editor` | 只读模式（demo 阶段用 URL 参数，生产应由业务系统签发的 JWT role 决定） |

示例：

```
http://localhost:9000/umo-editor/?collab=1&doc=my-doc&role=viewer
```

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `4000` | 服务端口（同端口提供 WebSocket + HTTP） |
| `JWT_SECRET` | `umo-collab-secret-dev-only` | HS256 密钥，**生产环境务必通过环境变量设置强随机值** |
| `JWT_EXPIRES_IN` | `24h` | JWT 有效期 |
| `UMO_API_KEY` | 空 | 业务后端调 `/api/token` 的凭据（`x-api-key` header）。**留空为 dev 无鉴权模式（仅限本地开发）** |
| `COMMENT_DB_PATH` | `data/comments.db` | 评论 SQLite 数据库路径（可选） |

```bash
# 示例：自定义配置启动
JWT_SECRET=$(openssl rand -hex 32) JWT_EXPIRES_IN=8h UMO_API_KEY=my-key PORT=4000 npm start
```

## API

服务端口（默认 4000）同时承载 WebSocket 协同流量和 HTTP 端点：

### `GET /api/token`

为客户端签发用于 WebSocket 鉴权的 JWT。

| 参数 | 说明 |
|---|---|
| `x-api-key`（header） | `UMO_API_KEY` 凭据（配置后必填，否则 401） |
| `name` | 用户名（缺省随机生成） |
| `doc` | 文档名，写入 JWT claims，连接时做文档级权限校验 |
| `role` | `editor`（默认，可编辑）或 `viewer`（只读，服务端拒绝 update） |

响应：

```json
{ "token": "<JWT>", "name": "alice", "doc": "demo-doc", "role": "editor" }
```

> **安全提示**：`UMO_API_KEY` 未配置时 `/api/token` 无鉴权（dev 模式），生产环境务必配置，并由业务系统对该端点做登录态校验后再签发 token。

### 评论 API（`/api/documents/:docId/comments` 等）

- REST CRUD + SSE（`/stream`），**无鉴权（同源信任）**，详见 [服务端接口 - 评论 API](../docs/api-reference/server-api.md#评论-api)。
- 外部访问经引擎 nginx 反代：`/oes/api/documents/...`、`/oes/api/comments/...`。

## 可用脚本

| 命令 | 说明 |
|---|---|
| `npm start` | 启动协同服务 |
| `npm run dev` | 以 `node --watch` 启动，文件改动自动重启（开发用） |
| `npm test` | 运行端到端测试 `e2e-test.mjs` |

---

## 打包部署

协同服务是一个纯 Node.js 服务，**无需构建步骤**——部署即"安装依赖 + 启动常驻进程"。前端编辑器走主仓库的 `npm run build`。

### 1. 前端构建（在仓库根目录）

```bash
cd <仓库根目录>
npm install
npm run build        # 产物输出到 dist/（umo-editor.js / umo-editor.css）
```

构建产物 `dist/` 可由业务系统按需集成。前端协同地址支持**运行时配置，无需重新构建**：

```js
// 在加载编辑器脚本之前设置一次即可（dev 不设则兜底 ws://localhost:4000）
window.__UMO_COLLAB_URL__ = 'wss://collab.your-domain.com'
```

`window.__UMO_COLLAB_URL__` 接受 `ws://` / `wss://` / `http://` / `https://` / 裸 `host:port` 任一写法，会自动推导出 WebSocket 连接地址和 `/api/token` 端点，两者一定指向同一台协同服务。详见 [`src/utils/collab-config.js`](../src/utils/collab-config.js)。

### 2. 协同服务部署

```bash
cd collab-server
npm install --omit=dev      # 仅装运行时依赖（better-sqlite3 是原生模块，预编译二进制）
mkdir -p data               # 确保 SQLite 数据目录存在（不存在会在启动时创建）

# 配置生产环境密钥后启动
export JWT_SECRET="<强随机密钥，如 openssl rand -hex 32>"
export JWT_EXPIRES_IN="24h"
export PORT="4000"
node server.js
```

#### 常见生产进程管理

**PM2**（推荐，单机常驻 + 崩溃自重启）：

```bash
npm install -g pm2
pm2 start server.js --name umo-collab --cwd collab-server
pm2 save                       # 保存进程列表
pm2 startup                    # 开机自启
pm2 logs umo-collab            # 查看日志
```

**Docker**（`Dockerfile` 示例）：

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p data
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server.js"]
```

```bash
docker build -t umo-collab .
docker run -d --name umo-collab \
  -p 4000:4000 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e JWT_EXPIRES_IN=24h \
  -v $(pwd)/data:/app/data \
  umo-collab
```

> `better-sqlite3` 是原生模块，换 Node 版本或换基础镜像后可能需要重新编译：`npm rebuild better-sqlite3`。

#### 反向代理（生产 wss）

生产环境前端通过 HTTPS 加载，协同 WebSocket 必须走 `wss://`，通常用 Nginx 把 `/collab` 反代到本服务的 4000 端口：

```nginx
location /collab/ {
    proxy_pass http://127.0.0.1:4000/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;        # WebSocket 升级
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 86400;                       # 长连接
}
```

前端对应设置全局变量：`window.__UMO_COLLAB_URL__ = 'wss://your.domain/collab'`（运行时配置，详见上方"前端构建"一节）。

### 3. 数据备份

SQLite 数据文件位于 `collab-server/data/collab.db`（WAL 模式下还有 `collab.db-wal` / `collab.db-shm`）。备份建议在服务运行时使用 `sqlite3 data/collab.db ".backup '/backup/collab-$(date +%F).db'"`，避免直接拷贝热文件不一致。

---

## 切换到其他数据库

存储层抽象在 [`storage.js`](./storage.js)，对外仅暴露 `loadDoc(name)` / `saveDoc(name, buffer)` / `closeDb()` 三个方法。切换到 MySQL / PostgreSQL 只需保持签名不变地替换该文件实现，`server.js` 无需改动。

## 演进路线

- **阶段三（生产化）**：`@hocuspocus/extension-redis` 多实例广播、K8s + 优雅停机、Prometheus 监控、单房间人数上限与限流、评论 API 接 JWT/业务系统鉴权（当前为同源信任）。
- **遗留**：协同 redo（undo 后 redo 栈被清空）、权限管理 UI、用户颜色唯一性。
