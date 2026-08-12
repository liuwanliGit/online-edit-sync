# 部署引擎镜像

> 本页介绍如何用 Docker 启动 Umo Editor Engine 镜像，包括环境变量配置、数据持久化与启动验证。

---

## 前置要求

- **Docker** 20.10+（或 Docker Desktop）
- **Docker Compose** v2+（可选，推荐）
- 宿主机开放端口供业务系统访问：引擎默认 `9999`，demo 示例默认 `9998`
- 一个强随机字符串作为 `JWT_SECRET`（生产环境必须），另一个作为 `UMO_API_KEY`（生产环境推荐）

> 提示：可用 `openssl rand -hex 32` 或 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 生成密钥。

---

## 方式一：docker compose 全栈部署（推荐）

仓库自带 `docker/docker-compose.yml`，一键启动 **引擎 + demo 瘦客户端示例** 两个容器：

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

或用一键脚本：

- **Linux/macOS**：`bash docker/build.sh up`
- **Windows**：`docker\build.bat`

启动后：

| 容器 | 对外端口 | 用途 |
| --- | --- | --- |
| `umo-editor-engine` | `9999` | 编辑器引擎（业务系统 iframe 嵌入） |
| `umo-editor-demo` | `9998` | demo 瘦客户端示例（登录 / 文档列表 / 编辑器页） |

- demo 示例入口：`http://localhost:9998/oes/demo/`（登录后即可体验协同编辑）
- 引擎入口：`http://localhost:9999/oes/embed?doc=<docId>&token=<jwt>`

> 仅启动已导入的镜像（不重新构建）：`docker compose -f docker/docker-compose-server.yml up -d`

---

## 方式二：docker run 单独启动引擎

如果只需要引擎（业务系统已就绪，不需要 demo 示例）：

```bash
docker run -d \
  --name umo-editor \
  -p 9999:9999 \
  -e JWT_SECRET='<你的强随机密钥，用于签发JWT>' \
  -e UMO_API_KEY='<你的强随机密钥，业务后端调用token接口时带这个>' \
  -e JWT_EXPIRES_IN=24h \
  -v umo-collab-data:/app/collab-server/data \
  --restart unless-stopped \
  umo-editor-engine:latest
```

---

## 环境变量

### 引擎（`umo-editor-engine`）

| 变量 | 必填 | 默认值 | 说明 |
| --- | :---: | --- | --- |
| `JWT_SECRET` | 生产必填 | `umo-collab-secret-dev-only` | JWT 签名密钥（HS256）。**生产务必设为强随机值，不对外公开** |
| `UMO_API_KEY` | 推荐 | 空 | 业务后端调用 `/oes/api/token` 时的凭据。**留空为 dev 无鉴权模式（仅限本地开发）；生产务必设为强随机值** |
| `JWT_EXPIRES_IN` | ❌ | `24h` | JWT 过期时间。支持 `1h`、`12h`、`7d` 等 |
| `PORT` | ❌ | `4000` | collab-server 内部端口（容器内一般不用改） |
| `COMMENT_DB_PATH` | ❌ | `data/comments.db` | 评论 SQLite 数据库路径（可选，默认与协同库同目录） |

> ⚠️ `JWT_SECRET` 与 `UMO_API_KEY` 是引擎安全的基石。切勿提交到代码仓库或暴露给前端。

### demo 容器（`umo-editor-demo`，可选）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `UMO_ENGINE_URL` | `http://umo-editor-engine:9999/oes` | demo 后端 → 引擎（容器内通信，一般不用改） |
| `UMO_ENGINE_PUBLIC_URL` | `http://localhost:9999/oes` | **浏览器**访问引擎的地址（写入前端 `config.js`，iframe 用，前端自动拼 `/embed`）。远程部署改成 `http://<服务器IP或域名>:9999/oes` 或外层 nginx 的 `http://<域名>/oes` |
| `UMO_API_KEY` | 空 | 与引擎一致，demo 后端代理签 JWT 时带 |
| `BIZ_RECEIVE_KEY` | 空 | 接收导出文件的鉴权 key（前端透传；留空不校验） |

---

## 端口说明

容器内 nginx 固定监听 `9999`（demo 容器固定 `9998`）。通过 `-p <宿主机端口>:<容器端口>` 映射：

```bash
# 引擎默认 9999
-p 9999:9999

# 改用 8080 对外
-p 8080:9999
```

修改 `docker-compose.yml` 的 `ports` 段即可。

---

## 数据持久化

| 卷 | 容器内路径 | 内容 |
| --- | --- | --- |
| `umo-collab-data` | `/app/collab-server/data` | 协同文档 Yjs 二进制（`collab.db`）+ 评论数据（`comments.db`） |
| `umo-demo-data` | `/app/server/data` | demo：文档元数据 SQLite + 回传的导出文件 |

```bash
-v umo-collab-data:/app/collab-server/data
```

> 生产环境强烈建议挂载 named volume 或宿主机目录，避免容器删除后文档丢失。彻底清除数据：`docker compose -f docker/docker-compose.yml down -v`

---

## 验证启动

### 健康检查

```bash
curl http://localhost:9999/oes/api/health
```

正常返回：

```json
{ "ok": true, "service": "umo-collab-server" }
```

### 访问 embed 页

```bash
# 应返回纯编辑器页的 HTML（含 <div id="app">），不是 nginx 默认页
curl 'http://localhost:9999/oes/embed?doc=test&token=xxx'
```

> 引擎根路径 `/` 会自动 302 跳转到 `/oes/embed`。`token=xxx` 此处仅为验证页面可达，实际使用需传业务后端签发的合法 JWT，否则协同连接会鉴权失败。

---

## 查看日志

```bash
docker compose -f docker/docker-compose.yml logs -f          # 全栈日志
docker compose -f docker/docker-compose.yml logs umo-editor-engine
docker compose -f docker/docker-compose.yml logs umo-editor-demo
```

引擎容器内用 supervisord 管理 nginx、collab-server、convert-server 三个进程。如需排查单个服务，可进容器：

```bash
docker exec -it umo-editor-engine bash
supervisorctl status
```

---

## 升级镜像

```bash
docker pull umo-editor-engine:latest
docker stop umo-editor && docker rm umo-editor
# 重新执行 docker run（数据卷保留）
```

> 升级前建议备份 `umo-collab-data` 卷。

---

## 下一步

引擎跑起来后，下一步是 [鉴权对接](./authentication.md) —— 让业务后端代理签发 JWT。
