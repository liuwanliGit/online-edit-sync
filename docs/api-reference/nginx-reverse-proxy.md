# nginx 同域反代配置

> 同源直调是引擎最强的交互方式（同步、可传对象、可拿 Tiptap 实例）。通过 nginx 把引擎反代到业务系统的同域子路径，即可实现同源。本页提供配置模板。

---

## 为什么要反代

| 交互方式 | 条件 | 能力 |
| --- | --- | --- |
| 同源直调 | iframe 与父页面同域 | 最强：同步调用、传对象、拿 Tiptap 实例 |
| 跨域 postMessage | 不同域 | 通用：异步请求/响应，拿不到底层实例 |

同源直调能力最强，但要求 iframe 与父页面**同域**。业务系统通常已有自己的域名（如 `https://biz.your-domain.com`），引擎部署在另一台机器（如 `http://editor-host:9999`）。通过 nginx 反代，把引擎映射到业务系统的子路径（如 `/editor/`），iframe 和父页面就同域了。

---

## nginx 配置模板

在**业务系统的 nginx**（不是引擎的 nginx）中添加：

```nginx
# WebSocket 升级映射（协同是长连接，必须）
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name biz.your-domain.com;

    # 业务系统原有路由 ...

    # 反代 Umo Editor 引擎到 /editor/ 子路径
    location /editor/ {
        proxy_pass http://editor-host:9999/;    # 注意末尾 /，去掉 /editor 前缀
        proxy_http_version 1.1;

        # WebSocket 必需（协同长连接）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;

        # 长连接超时调大（默认 60s 会断开空闲 WS）
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        # 文件导出可能较大
        client_max_body_size 20m;
    }
}
```

### 配置要点

| 配置项 | 说明 |
| --- | --- |
| `proxy_pass .../`（末尾 `/`） | 去掉 `/editor` 前缀。如 `/editor/embed` → `http://editor-host:9999/embed` |
| `map $http_upgrade` | WebSocket 升级映射，协同长连接必须 |
| `proxy_read_timeout 86400s` | **关键**。nginx 默认 60s 会断开空闲 WS，导致协同断连。必须调大 |
| `client_max_body_size 20m` | 导出 docx 文件可能较大，适当放宽 |

---

## 反代后的地址

反代后，所有引擎接口都在 `/editor/` 前缀下：

| 原地址 | 反代后地址 |
| --- | --- |
| `http://editor-host:9999/embed` | `https://biz.your-domain.com/editor/embed` |
| `http://editor-host:9999/collab` | `https://biz.your-domain.com/editor/collab` |
| `http://editor-host:9999/api/token` | `https://biz.your-domain.com/editor/api/token` |
| `http://editor-host:9999/api/convert/docx` | `https://biz.your-domain.com/editor/api/convert/docx` |

---

## 反代后的用法

### iframe URL（同域）

```js
// iframe 用同域地址（与父页面同域）
iframe.src = `/editor/embed?doc=${docId}&token=${token}`

iframe.onload = () => {
  const editor = iframe.contentWindow.__UMO_EDITOR__   // 同源，直接拿
  const html = editor.getHTML()                        // 同步
}
```

### 协同 WS（引擎自动感知）

引擎 `/embed` 页面内部用 `window.location.host` 推算 WS 地址，反代后自动变成 `wss://biz.your-domain.com/collab`，无需额外配置。

### 运行时指定引擎地址

业务前端可通过全局变量指定反代前缀：

```js
// 在应用启动前设置
window.__UMO_ENGINE_URL__ = '/editor'
```

---

## 常见问题

### Q: 协同 WebSocket 总是断开？

通常是 nginx 的 `proxy_read_timeout` 默认 60s 断开了空闲长连接。按上面的配置设 `proxy_read_timeout 86400s`。

### Q: 反代后页面白屏？

检查：
1. `proxy_pass` 末尾是否带了 `/`（去掉前缀）
2. 静态资源（JS/CSS）路径是否正确（应为 `/editor/assets/...`）
3. 浏览器控制台是否有 CORS 或混合内容（HTTPS 页面加载 HTTP 资源）报错

### Q: 反代后导出失败？

检查 `client_max_body_size` 是否足够大（docx 文件可能几 MB）。

---

## 下一步

- [同源直调 API](./same-origin-api.md) —— 反代后可用的全部方法
- [完整示例（同源）](../samples/full-same-origin.md)
