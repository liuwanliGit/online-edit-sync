# 部署引擎镜像

> 本页介绍如何用 Docker 启动 Umo Editor Engine 镜像，包括环境变量配置、数据持久化与启动验证。

---

## 前置要求

- **Docker** 20.10+（或 Docker Desktop）
- **Docker Compose** v2+（可选，推荐）
- 宿主机开放一个端口（默认 `9999`）供业务系统访问
- 一个强随机字符串作为 `JWT_SECRET`，另一个作为 `UMO_API_KEY`

> 提示：可用 `openssl rand -hex 32` 或 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 生成密钥。

---

## 快速启动

### 方式一：docker run

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

### 方式二：docker compose（推荐）

仓库自带 `docker/docker-compose.yml`：

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

或用一键脚本：

- **Linux/macOS**：`bash docker/build.sh up`
- **Windows**：`docker\build.bat`

---

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | :---: | --- | --- |
| `JWT_SECRET` | ✅ | — | JWT 签名密钥（HS256）。**务必设为强随机值，不对外公开** |
| `UMO_API_KEY` | ✅ | — | 业务后端调用 `/api/token` 时的凭据。**务必设为强随机值** |
| `JWT_EXPIRES_IN` | ❌ | `24h` | JWT 过期时间。支持 `1h`、`12h`、`7d` 等 |

> ⚠️ `JWT_SECRET` 与 `UMO_API_KEY` 是引擎安全的基石。切勿提交到代码仓库或暴露给前端。

---

## 端口说明

容器内 nginx 固定监听 `9999`。通过 `-p <宿主机端口>:9999` 映射：

```bash
# 默认 9999
-p 9999:9999

# 改用 8080 对外
-p 8080:9999
```

---

## 数据持久化

引擎的协同文档数据存储在 `/app/collab-server/data`。挂载卷可保证容器重建不丢数据：

```bash
-v umo-collab-data:/app/collab-server/data
```

> 生产环境强烈建议挂载 named volume 或宿主机目录，避免容器删除后文档丢失。

---

## 验证启动

### 健康检查

```bash
curl http://localhost:9999/api/health
```

正常返回应包含 `status: ok` 或 HTTP 200。

### 访问 embed 页

```bash
# 应返回纯编辑器页的 HTML（含 <div id="app">），不是 nginx 默认页
curl 'http://localhost:9999/embed?doc=test&token=xxx'
```

> `token=xxx` 此处仅为验证页面可达，实际使用需传业务后端签发的合法 JWT，否则协同连接会鉴权失败。

---

## 查看日志

```bash
# 查看全部日志
docker logs umo-editor

# 实时跟踪
docker logs -f umo-editor
```

引擎内部用 supervisord 管理 nginx、collab-server、convert-server 三个进程。如需排查单个服务，可进容器：

```bash
docker exec -it umo-editor bash
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
