# nginx 同域反代配置

> 同源直调是引擎最强的交互方式（同步、可传对象、可拿 Tiptap 实例）。通过 nginx 把引擎反代到业务系统的同域子路径，即可实现同源。本页提供配置模板与拓扑说明。

---

## 为什么要反代

| 交互方式 | 条件 | 能力 |
| --- | --- | --- |
| 同源直调 | iframe 与父页面同域 | 最强：同步调用、传对象、拿 Tiptap 实例 |
| 跨域 postMessage | 不同域 | 通用：异步请求/响应，拿不到底层实例 |

同源直调能力最强，但要求 iframe 与父页面**同域**。业务系统通常已有自己的域名（如 `https://biz.your-domain.com`），引擎部署在另一台机器（如 `http://editor-host:9999`）。通过 nginx 反代，把引擎映射到业务系统的子路径（如 `/oes/`），iframe 和父页面就同域了。

---

## 部署拓扑与前缀设计

引擎的所有路径**前缀已固定烧进镜像**，外层 nginx 只需**整段透传**（`proxy_pass` 不带尾斜杠，不剥前缀）：

- **引擎前端**：`/oes/embed`（着陆页）、`/oes/embed/*`（静态资源）
- **引擎 API/WS**：`/oes/api/token`、`/oes/api/health`、`/oes/api/convert/*`、`/oes/collab`(WS)、`/oes/api/documents/*`、`/oes/api/comments/*`
- **demo 示例**：其余 `/oes/*`（页面、静态资源、demo 后端 API）

单域名部署时，nginx 按**最长前缀匹配**把引擎专属路径转给引擎容器（`:9999`），其余 `/oes/*` 转给 demo 容器（`:9998`）。

```
https://your-domain/oes/embed、/oes/embed/*、/oes/collab、/oes/api/convert、/oes/api/token
                                                          → 引擎容器 :9999
https://your-domain/oes/  （页面、静态资源、业务 /api/documents 等）   → demo 容器 :9998
```

---

## nginx 配置模板

仓库提供完整示例 [`../../docker/external-nginx.example.conf`](../../docker/external-nginx.example.conf)，核心结构如下（在**业务系统的 nginx** 中配置，不是引擎容器内的 nginx）：

```nginx
# WebSocket 升级映射（协同是长连接，必须）
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# 后端容器（按实际部署改 IP/端口）
upstream umo_engine {
    server 127.0.0.1:9999;   # 引擎容器
}
upstream umo_demo {
    server 127.0.0.1:9998;   # demo 容器
}

server {
    listen 443 ssl;
    server_name biz.your-domain.com;
    # ssl_certificate / ssl_certificate_key ...

    client_max_body_size 20m;   # 导出 docx 可能较大

    # ---- 引擎专属路径（优先匹配，转给引擎容器）----

    # 协同 WebSocket：必须单独 location 处理升级头
    location /oes/collab {
        proxy_pass http://umo_engine;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;      # 长连接，避免空闲 WS 被断开
        proxy_send_timeout 86400s;
    }

    # 引擎 iframe 着陆页
    location = /oes/embed {
        proxy_pass http://umo_engine;
        proxy_set_header Host $host;
    }

    # 引擎静态资源与子路径（/oes/embed/assets/...）
    location /oes/embed/ {
        proxy_pass http://umo_engine;
        proxy_set_header Host $host;
    }

    # 引擎 API（转换 / 令牌 / 健康检查）
    location = /oes/api/token {
        proxy_pass http://umo_engine;
        proxy_set_header Host $host;
    }
    location = /oes/api/health {
        proxy_pass http://umo_engine;
        proxy_set_header Host $host;
    }
    location /oes/api/convert/ {
        proxy_pass http://umo_engine;
        proxy_set_header Host $host;
    }

    # ---- demo（页面 / 静态资源 / 业务 API）通用 /oes/ 兜底 → demo 容器 ----
    location /oes/ {
        proxy_pass http://umo_demo;
        proxy_set_header Host $host;
    }
}
```

### 配置要点

| 配置项 | 说明 |
| --- | --- |
| `proxy_pass http://upstream`（**不带尾斜杠**） | **整段透传** `/oes/...`，不剥前缀——容器内 nginx 的 location 直接命中 |
| `map $http_upgrade` | WebSocket 升级映射，协同长连接必须 |
| `proxy_read_timeout 86400s` | **关键**。nginx 默认 60s 会断开空闲 WS，导致协同断连。必须调大 |
| `client_max_body_size 20m` | 导出 docx 文件可能较大，适当放宽 |
| 引擎专属路径放前面 | nginx 最长前缀匹配，`/oes/embed/`、`/oes/collab` 等先于通用 `/oes/` 命中 |

---

## 反代后的地址

反代后，所有引擎接口都在 `https://biz.your-domain.com/oes/...` 下：

| 原地址 | 反代后地址 |
| --- | --- |
| `http://editor-host:9999/oes/embed` | `https://biz.your-domain.com/oes/embed` |
| `http://editor-host:9999/oes/collab` | `https://biz.your-domain.com/oes/collab` |
| `http://editor-host:9999/oes/api/token` | `https://biz.your-domain.com/oes/api/token` |
| `http://editor-host:9999/oes/api/convert/docx` | `https://biz.your-domain.com/oes/api/convert/docx` |

---

## 反代后的用法

### iframe URL（同域）

```js
// iframe 用同域地址（与父页面同域）
iframe.src = `/oes/embed?doc=${docId}&token=${token}`

iframe.onload = () => {
  const editor = iframe.contentWindow.__UMO_EDITOR__   // 同源，直接拿
  const html = editor.getHTML()                        // 同步
}
```

### 协同 WS（引擎自动感知）

引擎 `/oes/embed` 页面内部从页面 URL 自动推导子路径前缀（`base-path.js`），反代后 WS 自动变成 `wss://biz.your-domain.com/oes/collab`，无需额外配置。

### 运行时指定引擎地址

业务前端可通过全局变量指定反代前缀：

```js
// 在应用启动前设置（带 /oes 前缀；前端自动拼 /embed）
window.__UMO_ENGINE_URL__ = '/oes'
```

---

## 常见问题

### Q: 协同 WebSocket 总是断开？

通常是 nginx 的 `proxy_read_timeout` 默认 60s 断开了空闲长连接。按上面的配置设 `proxy_read_timeout 86400s`。

### Q: 反代后页面白屏？

检查：
1. `proxy_pass` 是否**不带尾斜杠**（`http://umo_engine` 而非 `http://umo_engine/`），否则前缀会被剥掉导致资源 404
2. 引擎静态资源 URL 是否为 `/oes/embed/assets/...`
3. 浏览器控制台是否有 CORS 或混合内容（HTTPS 页面加载 HTTP 资源）报错

### Q: 反代后导出失败？

检查 `client_max_body_size` 是否足够大（docx 文件可能几 MB）。

### Q: 如何区分引擎与 demo 的流量？

引擎专属路径（`/oes/embed`、`/oes/embed/`、`/oes/collab`、`/oes/api/convert`、`/oes/api/token`、`/oes/api/health`、`/oes/api/documents/`、`/oes/api/comments/`）单独 location 转给引擎容器，其余 `/oes/` 兜底转给 demo 容器。直接按模板配置即可，无需自己推导前缀。

---

## 下一步

- [同源直调 API](./same-origin-api.md) —— 反代后可用的全部方法
- [完整示例（同源）](../samples/full-same-origin.md)
