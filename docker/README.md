# Umo Editor 引擎镜像 Docker 部署

把「协同服务（collab-server）+ 文档转换服务（convert-server）+ /embed 纯编辑器前端」打包进**单个镜像**（`umo-editor-engine`），用 **nginx 统一对外服务**，对外端口 **9999**。

引擎**不含** demo 前端 / demo-server / 登录页 / 文档列表——这些是业务系统自己的职责。接入方通过 **iframe 嵌入 `/embed`** 使用编辑器。

> 想直接跑一个完整的示例（含登录页 / 文档列表 / 编辑器页）？跳到 [全栈部署（引擎 + 瘦客户端示例）](#全栈部署引擎--瘦客户端示例)。

## 架构

前缀设计（单域名可共存的关健）：**引擎前端固定挂 `/oes/embed/` 前缀**（vite base 同名，与 demo 前端的 `/oes/demo/` 错开，两套 `/assets/` 互不冲突）；**引擎 API/WS 仍挂 `/oes/*` 前缀**（embed 的 `base-path.js` 从着陆页 URL 推导出 `/oes`）。以下为引擎容器内部路由：

```
浏览器 ──:9999──► nginx
                  ├─ /oes/embed             → embed 前端着陆页（iframe 入口，rewrite 到 index.html）
                  ├─ /oes/embed/            → embed 前端静态资源（assets 等，vite base=/oes/embed/）
                  ├─ /                     → 根路径跳转到 /oes/embed
                  ├─ /oes/api/token        → 协同服务 HTTP 签 JWT (:4000，需 x-api-key)
                  ├─ /oes/api/health       → 协同服务健康检查 (:4000)
                  ├─ /oes/api/convert/     → 转换服务 HTML→docx (:4002)
                  └─ /oes/collab (WebSocket) → 协同服务 Yjs 实时同步 (:4000)

容器内进程（supervisor 托管）：nginx + collab-server + convert-server
```

embed 前端是同源服务，WS 地址由 `location.host` + `base-path.js` 自动推导（`ws://host/oes/collab`），无需运行时全局变量注入。

## 快速开始

```bash
# 一键构建并启动（后台）
bash docker/build.sh up
```

启动后：
- 健康检查：`curl http://localhost:9999/oes/api/health` → `{"ok":true,...}`
- iframe 嵌入：`http://localhost:9999/oes/embed?doc=<docId>&token=<jwt>&mode=edit`

> 引擎根路径 `/` 会自动跳转到 `/oes/embed`；直接打开 `/oes/embed` 会显示「缺少 doc/token 参数」——这是预期行为，引擎只服务于 iframe 嵌入，不提供用户可直接访问的页面。完整接入示例见仓库 `demo/`（瘦客户端源码）。

## 命令一览

**Windows（双击 `docker\build.bat`）：**

```bat
docker\build.bat             :: 构建并启动引擎
```

**Linux / macOS / Git Bash：**

```bash
bash docker/build.sh         # 仅构建镜像（默认）
bash docker/build.sh up      # 构建并后台启动
bash docker/build.sh down    # 停止并清理容器（数据卷保留）
bash docker/build.sh logs    # 跟踪日志
```

或直接用 docker compose：

```bash
docker compose -f docker/docker-compose.yml up -d --build   # 启动
docker compose -f docker/docker-compose.yml logs -f        # 日志
docker compose -f docker/docker-compose.yml down           # 停止
```

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `JWT_SECRET` | `umo-collab-secret-dev-only` | 协同服务 JWT 签名密钥（HS256），**生产务必修改** |
| `JWT_EXPIRES_IN` | `24h` | JWT 过期时间 |
| `UMO_API_KEY` | 空 | 业务后端调 `/api/token` 时的凭据（`x-api-key` header）。**留空为 dev 无鉴权模式；生产务必设为强随机值** |

覆盖方式（任选其一）：

```bat
:: Windows - 命令行
set UMO_API_KEY=your-strong-random-key
docker\build.bat
```

```bash
# Linux/macOS - .env 文件
echo "UMO_API_KEY=your-strong-random-key" > .env
bash docker/build.sh up
```

### 端口

默认 `9999:9999`。如需改对外端口，编辑 `docker-compose.yml` 的 `ports`：

```yaml
ports:
  - "8080:9999"   # 宿主机 8080 → 容器 9999
```

### 数据持久化

命名卷持久化协同文档：
- `umo-collab-data` → 协同文档 Yjs 二进制内容

容器删除重建后数据不丢。**彻底清除数据**：

```bash
docker compose -f docker/docker-compose.yml down -v
```

## 文件说明

| 文件 | 作用 |
|---|---|
| `docker/Dockerfile` | 多阶段构建（构建库 → 构建 /embed → 引擎运行时镜像） |
| `docker/nginx.conf` | nginx 反代 + /embed 入口 + WS 升级 |
| `docker/supervisord.conf` | 容器内进程管理（nginx + collab + convert） |
| `docker/docker-compose.yml` | 编排 + 数据卷 + 环境变量 + 健康检查 |
| `docker/build.bat` | Windows 一键脚本 |
| `docker/build.sh` | Linux/macOS/Git Bash 一键脚本 |
| `docker/external-nginx.example.conf` | 外层反代示例（单域名子路径部署 demo + 引擎） |
| `.dockerignore` | 构建上下文排除项 |

## 构建说明（多阶段）

1. **editor-builder**：用 `node:22-bookworm-slim`，`npm install` + `npm run build` 产出编辑器库 `dist/`
2. **embed-builder**：embed 通过 `file:..` 引用上层 `dist/`，`npm run build` 产出 `embed/dist/`（纯编辑器页静态资源）
3. **engine**：`apt-get install nginx supervisor`，`npm install --omit=dev` 装两个服务端依赖（better-sqlite3 用 linux-x64 预编译二进制），复制 embed 静态资源，supervisor 托管三进程

## 全栈部署（引擎 + 瘦客户端示例）

如果服务器没有 Node 环境、也不想装，可以把**引擎 + demo 示例**一起用 docker compose 部署。会启动两个容器：

```
浏览器 ──:9998──► demo 容器（umo-editor-demo）
                   ├─ /oes/demo/      → demo 前端（登录 / 文档列表 / 编辑器页 / 文档页）
                   └─ /oes/demo/api/  → demo 后端（文档元数据 + 代理签 JWT + 接收导出）:4001
       ──:9999──► 引擎容器（umo-editor-engine）
                   └─ /oes/embed、/oes/embed/* 等  → 编辑器引擎（demo 前端通过 iframe 嵌入）
```

### 一键启动

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

启动后浏览器访问 **http://localhost:9998/oes/demo/** → 登录（随便填用户名）→ 文档列表 → 打开文档 → 协同编辑。

> 访问 `http://localhost:9998/`（根路径）会自动跳转到 `/oes/demo/`。

### 环境变量

除引擎的环境变量外，demo 容器额外使用：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `UMO_ENGINE_URL` | `http://umo-editor-engine:9999` | demo 后端 → 引擎（容器内通信，一般不用改） |
| `UMO_ENGINE_PUBLIC_URL` | `http://localhost:9999/oes` | **浏览器**访问引擎的地址（写入前端 config.js，iframe 用，前端自动拼 `/embed`）。远程部署改成 `http://<服务器IP或域名>:9999/oes` 或外层 nginx 的 `http://<域名>/oes` |
| `UMO_API_KEY` | 空 | 与引擎一致，demo 后端代理签 JWT 时带 |

> ⚠️ `UMO_ENGINE_PUBLIC_URL` 是**浏览器**加载 iframe 用的地址，必须是用户浏览器能访问到的引擎地址（**带 `/oes` 前缀，**不要**带 `/embed`**，前端会自动拼 `/embed`）。本机部署用默认 `http://localhost:9999/oes` 即可；部署到服务器上改成 `http://<服务器IP或域名>:9999/oes`。引擎静态资源挂 `/oes/embed/` 前缀，与 demo 的 `/oes/demo/` 不冲突。

覆盖方式（在仓库根目录建 `.env`）：

```bash
cat > .env <<EOF
UMO_API_KEY=your-strong-random-key
UMO_ENGINE_PUBLIC_URL=http://192.168.1.100:9999/oes
JWT_SECRET=your-strong-jwt-secret
EOF

docker compose -f docker/docker-compose.yml up -d --build
```

### 端口

| 容器 | 对外端口 | 用途 |
|---|---|---|
| `umo-editor-demo` | 9998 | demo 示例（浏览器访问入口） |
| `umo-editor-engine` | 9999 | 引擎（demo iframe 嵌入） |

改端口编辑 `docker-compose.yml` 的 `ports`。

### 数据持久化

| 卷 | 路径 | 内容 |
|---|---|---|
| `umo-collab-data` | 引擎 `/app/collab-server/data` | 协同文档 Yjs 二进制 |
| `umo-demo-data` | demo `/app/server/data` | 文档元数据 SQLite + 回传的导出文件 |

### demo 镜像文件说明

| 文件 | 作用 |
|---|---|
| `demo/docker/Dockerfile` | 两阶段构建（demo 前端 dist + 运行时镜像） |
| `demo/docker/nginx.conf` | demo nginx（静态资源 + 反代 /api/） |
| `demo/docker/supervisord.conf` | 容器内进程管理（nginx + demo-server） |
| `demo/docker/entrypoint.sh` | 启动前根据环境变量生成前端 config.js |

### 改 demo 地址（部署后）

demo 镜像部署后，**改引擎地址无需重新构建镜像**：

```bash
# 改 .env 里的 UMO_ENGINE_PUBLIC_URL，然后重启 demo 容器
docker compose -f docker/docker-compose.yml up -d umo-editor-demo
```

容器启动时 `entrypoint.sh` 会重新生成 `/app/public/config.js`。

---

## 外层 nginx 反代部署（单域名，把编辑器挂到已有系统下）

### 设计原则：固定前缀 + 整段透传

前缀已固定烧进镜像：**引擎前端 `/oes/embed/`**（vite base 同名）、**引擎 API/WS `/oes/*`**、**demo `/oes/demo/`**。因此外层 nginx 的配置**极大简化**：

- **直接端口访问**：`http://host:9998/oes/demo/`、`http://host:9999/oes/embed` 即可，无需任何 nginx。
- **外层 nginx 反代**：把 `/oes/demo/` 透传 **demo** 容器、其余 `/oes/`（含 `/oes/embed*`、`/oes/collab`、`/oes/api/*`）透传**引擎**容器（`proxy_pass` 不带尾斜杠，不剥前缀），因为容器内部已经认这些前缀。

相比旧方案（前端相对路径 + 外层 nginx 剥前缀 + 运行时推导），这套方案的优势：
1. **部署只需改 host:port**——有无外层 nginx 都一样，只改 `UMO_ENGINE_PUBLIC_URL` 一个变量。
2. **彻底消除"剥前缀"这个最容易出错的环节**——外层 nginx 透传即可。
3. **history 路由深层刷新不 404**——vite base 是绝对路径（引擎 `/oes/embed/`、demo `/oes/demo/`），资源引用稳定。
4. **引擎与 demo 的 /assets/ 不再冲突**——前缀错开后，单域名反代可按最长前缀匹配正确分流，不会互相兜底成 text/html。

### 外层 nginx 配置

参考 [`external-nginx.example.conf`](./external-nginx.example.conf)。核心要点：

- **`proxy_pass http://upstream`（不带尾斜杠）** → 整段路径透传 `/oes/...`，容器内 nginx 的 location 接收，**无需剥前缀**。
- **单端口区分 demo 和引擎**：`/oes/demo/` 转给 demo 容器，其余 `/oes/`（含 **`/oes/embed`、`/oes/embed/`（含引擎静态资源）**、`/oes/collab`、`/oes/api/*`）兜底转给引擎容器。
- **WebSocket（`/oes/collab`）和评论 SSE** 需单独 location 加特殊代理头（显式设置 `Upgrade`/`Connection` 等）。

### 部署步骤（外层 nginx 场景）

1. 启动两个容器：`docker compose -f docker/docker-compose.yml up -d --build`
2. 复制 `external-nginx.example.conf` 到宿主机 nginx，按实际域名/IP 改 upstream 和 server_name
3. 设置 demo 容器环境变量（关键）：
   ```bash
   # .env 文件
   UMO_ENGINE_PUBLIC_URL=https://your-domain/oes
   ```
   （指向外层 nginx 的 `/oes`，让 iframe 加载 `https://your-domain/oes/embed`）
4. `nginx -s reload`

### 验证清单

| 检查项 | 期望 |
|---|---|
| 访问 `https://your-domain/oes/demo/` | demo 登录页正常加载（无 404） |
| F12 Network：`/oes/demo/assets/*.js`（demo 自己的资源） | `Content-Type: application/javascript` |
| 打开文档，iframe 指向 `/oes/embed?...` | 编辑器正常加载 |
| F12 Network：`/oes/embed/assets/*.js`（引擎资源） | `Content-Type: application/javascript`（**不再是 text/html**） |
| F12 Network：`/oes/collab` WS | 101 Switching Protocols，协同编辑正常 |
| F12 Network：`/oes/api/convert/docx` | 导出 Word 正常 |
| demo 路由刷新（如 `/oes/demo/documents/123`） | 不 404，history fallback 正常 |

> 直接端口访问容器（`http://host:9998/oes/demo/`）**仍完全支持**，无需外层 nginx。

---

## 排错

**访问 :9999 白屏 / 404**
- `docker compose -f docker/docker-compose.yml logs nginx` 看 nginx 是否启动成功
- 确认容器健康：`docker ps` 看 STATUS 是否 `healthy`
- `curl http://localhost:9999/oes/api/health` 应返回 `{"ok":true}`
- 确认访问的是 `/oes/...` 路径（不是根路径 `/embed`，会 404）

**协同连不上 / 编辑不同步**
- iframe URL 是否带了 `doc` 和 `token` 参数
- `docker compose -f docker/docker-compose.yml logs collab-server` 看协同服务日志
- F12 Network 看 `ws://<host>:9999/oes/collab` 是否连接
- token 是否过期（默认 24h），过期则重新让业务后端签发

**JWT 鉴权失败**
- 确认 `JWT_SECRET` 在容器重启后没变（变了会导致旧 token 失效）
- token 里的 `doc` claim 必须与 iframe 的 `doc` 参数一致（引擎会校验）

**`/oes/api/token` 返回 401**
- 镜像启动时设置了 `UMO_API_KEY`，但业务后端调用时没带 `x-api-key` header（或值不对）
- dev 模式（`UMO_API_KEY` 未设置）不会校验

**镜像构建慢 / 失败**
- 首次构建需下载 node 基础镜像 + npm 包，国内网络建议配 Docker 镜像加速器
- `npm install` 要求 `package-lock.json` 与 `package.json` 一致；如本地改过依赖，先在宿主机 `npm install` 更新 lockfile
