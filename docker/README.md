# Umo Editor 引擎镜像 Docker 部署

把「协同服务（collab-server）+ 文档转换服务（convert-server）+ /embed 纯编辑器前端」打包进**单个镜像**（`umo-editor-engine`），用 **nginx 统一对外服务**，对外端口 **9999**。

引擎**不含** demo 前端 / demo-server / 登录页 / 文档列表——这些是业务系统自己的职责。接入方通过 **iframe 嵌入 `/embed`** 使用编辑器。

## 架构

```
浏览器 ──:9999──► nginx
                  ├─ /embed                → embed 前端（纯编辑器页，iframe 着陆页）
                  ├─ /                     → 根路径也返回 embed（非登录页）
                  ├─ /api/token            → 协同服务 HTTP 签 JWT (:4000，需 x-api-key)
                  ├─ /api/health           → 协同服务健康检查 (:4000)
                  ├─ /api/convert/         → 转换服务 HTML→docx (:4002)
                  └─ /collab (WebSocket)   → 协同服务 Yjs 实时同步 (:4000)

容器内进程（supervisor 托管）：nginx + collab-server + convert-server
```

embed 前端是同源服务，WS 地址由 `location.host` 推导（`ws://host/collab`），无需运行时全局变量注入。

## 快速开始

```bash
# 一键构建并启动（后台）
bash docker/build.sh up
```

启动后：
- 健康检查：`curl http://localhost:9999/api/health` → `{"ok":true,...}`
- iframe 嵌入：`http://localhost:9999/embed?doc=<docId>&token=<jwt>&mode=edit`

> 引擎根路径直接打开会显示「缺少 doc/token 参数」——这是预期行为，引擎只服务于 iframe 嵌入，不提供用户可直接访问的页面。完整接入示例见仓库 `demo/`（瘦客户端源码）。

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
| `.dockerignore` | 构建上下文排除项 |

## 构建说明（多阶段）

1. **editor-builder**：用 `node:22-bookworm-slim`，`npm install` + `npm run build` 产出编辑器库 `dist/`
2. **embed-builder**：embed 通过 `file:..` 引用上层 `dist/`，`npm run build` 产出 `embed/dist/`（纯编辑器页静态资源）
3. **engine**：`apt-get install nginx supervisor`，`npm install --omit=dev` 装两个服务端依赖（better-sqlite3 用 linux-x64 预编译二进制），复制 embed 静态资源，supervisor 托管三进程

## 排错

**访问 :9999 白屏 / 404**
- `docker compose -f docker/docker-compose.yml logs nginx` 看 nginx 是否启动成功
- 确认容器健康：`docker ps` 看 STATUS 是否 `healthy`
- `curl http://localhost:9999/api/health` 应返回 `{"ok":true}`

**协同连不上 / 编辑不同步**
- iframe URL 是否带了 `doc` 和 `token` 参数
- `docker compose -f docker/docker-compose.yml logs collab-server` 看协同服务日志
- F12 Network 看 `ws://<host>:9999/collab` 是否连接
- token 是否过期（默认 24h），过期则重新让业务后端签发

**JWT 鉴权失败**
- 确认 `JWT_SECRET` 在容器重启后没变（变了会导致旧 token 失效）
- token 里的 `doc` claim 必须与 iframe 的 `doc` 参数一致（引擎会校验）

**`/api/token` 返回 401**
- 镜像启动时设置了 `UMO_API_KEY`，但业务后端调用时没带 `x-api-key` header（或值不对）
- dev 模式（`UMO_API_KEY` 未设置）不会校验

**镜像构建慢 / 失败**
- 首次构建需下载 node 基础镜像 + npm 包，国内网络建议配 Docker 镜像加速器
- `npm install` 要求 `package-lock.json` 与 `package.json` 一致；如本地改过依赖，先在宿主机 `npm install` 更新 lockfile
