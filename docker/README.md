# Umo Editor 全栈 Docker 部署

把「demo 前端 + 协同服务（collab-server）+ 文档管理后端（demo/server）」打包进**单个镜像**，用 **nginx 统一对外服务**，对外端口 **9999**。

## 架构

```
浏览器 ──:9999──► nginx
                  ├─ /                      → 前端静态资源（index.html 注入运行时配置）
                  ├─ /api/documents/*       → 文档管理后端 (:4001)
                  ├─ /collab/api/token      → 协同服务 HTTP 签 token (:4000)
                  └─ /collab (WebSocket)    → 协同服务 Yjs 实时同步 (:4000)

容器内进程（supervisor 托管）：nginx + collab-server + demo-server
```

前端零源码改动：nginx 返回 `index.html` 时注入一段 JS，动态设置 `window.__UMO_API_URL__` 和 `window.__UMO_COLLAB_URL__`，让前端按同源地址访问后端。

## 快速开始

```bash
# 一键构建并启动（后台）
bash docker/build.sh up

# 访问
open http://localhost:9999
```

登录页选择：
- **单机模式**：文档存浏览器 localStorage，零后端依赖（只需前端能加载即可）
- **协同模式**：文档元数据走后端 REST，内容走 Yjs WebSocket 实时同步。开两个浏览器窗口用不同用户名登录 → 用户 A 建文档，用户 B 列表立即可见 → 两人同时编辑实时同步 + 远程光标

## 命令一览

**Windows（双击 `docker\build.bat` 也有交互菜单）：**

```bat
docker\build.bat             :: 仅构建镜像（默认）
docker\build.bat up          :: 构建并后台启动（完成后问是否打开浏览器）
docker\build.bat down        :: 停止并清理容器（数据卷保留）
docker\build.bat logs        :: 跟踪日志
docker\build.bat restart     :: 重启容器
docker\build.bat ps          :: 查看容器状态
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

覆盖方式（任选其一）：

```bat
:: Windows - 方式 1：命令行（当前会话临时生效）
set JWT_SECRET=your-strong-secret
docker\build.bat up

:: Windows - 方式 2：在仓库根放 .env 文件
(echo JWT_SECRET=your-strong-secret) > .env
docker\build.bat up
```

```bash
# Linux/macOS - 方式 1：命令行
JWT_SECRET=your-strong-secret bash docker/build.sh up

# Linux/macOS - 方式 2：.env 文件
echo "JWT_SECRET=your-strong-secret" > .env
bash docker/build.sh up
```

### 端口

默认 `9999:9999`。如需改对外端口，编辑 `docker-compose.yml` 的 `ports`：

```yaml
ports:
  - "8080:9999"   # 宿主机 8080 → 容器 9999
```

### 数据持久化

两个命名卷分别持久化：
- `umo-collab-data` → 协同文档 Yjs 二进制内容
- `umo-docs-data` → 文档元数据（id/title/创建者/时间戳）

容器删除重建后数据不丢。**彻底清除数据**：

```bash
docker compose -f docker/docker-compose.yml down -v
```

## 文件说明

| 文件 | 作用 |
|---|---|
| `docker/Dockerfile` | 多阶段构建（构建库 → 构建 demo → 运行时镜像） |
| `docker/nginx.conf` | nginx 反代 + SPA 兜底 + WS 升级 + 配置注入 |
| `docker/supervisord.conf` | 容器内进程管理（nginx + 2 个 node 服务） |
| `docker/docker-compose.yml` | 编排 + 数据卷 + 环境变量 + 健康检查 |
| `docker/build.bat` | Windows 一键脚本（双击有菜单） |
| `docker/build.sh` | Linux/macOS/Git Bash 一键脚本 |
| `.dockerignore` | 构建上下文排除项 |

## 构建说明（多阶段）

1. **editor-builder**：用 `node:22-bookworm-slim`，`npm ci` + `npm run build` 产出编辑器库 `dist/`
2. **demo-builder**：demo 通过 `file:..` 引用上层 `dist/`，`npm run build` 产出 `demo/dist/`（完全静态）
3. **runner**：`apt-get install nginx supervisor`，`npm ci --omit=dev` 装两个服务端依赖（better-sqlite3 用 linux-x64 预编译二进制，无需编译工具链），复制静态资源，supervisor 托管三进程

> 不修改任何现有源码——所有适配都在 Dockerfile（构建）+ nginx（路由/注入）+ supervisor（进程）层完成。

## 排错

**访问 :9999 白屏 / 404**
- `docker compose -f docker/docker-compose.yml logs nginx` 看 nginx 是否启动成功
- 确认容器健康：`docker ps` 看 STATUS 是否 `healthy`

**协同模式连不上 / 编辑不同步**
- 浏览器控制台看 WebSocket 是否连接 `ws://<host>:9999/collab`
- `docker compose -f docker/docker-compose.yml logs collab-server` 看协同服务日志
- F12 Network 看 `/collab/api/token` 是否 200

**JWT 鉴权失败**
- 确认 `JWT_SECRET` 在容器重启后没变（变了会导致旧 token 失效，重新登录即可）

**镜像构建慢 / 失败**
- 首次构建需下载 node 基础镜像 + npm 包，国内网络建议配 Docker 镜像加速器
- `npm ci` 要求 `package-lock.json` 与 `package.json` 一致；如本地改过依赖，先在宿主机 `npm install` 更新 lockfile
