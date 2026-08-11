# 服务端接口

> 本页说明引擎对外暴露的全部 HTTP/WebSocket 接口。所有接口由引擎 nginx 统一入口（`:9999`）反代到内部各服务，**统一挂在 `/oes` 前缀下**。

---

## 接口总览

| 接口 | 方法 | 说明 | 调用方 |
| --- | --- | --- | --- |
| [`/oes/api/health`](#oesapihealth) | GET | 健康检查 | 运维/监控 |
| [`/oes/api/token`](#oesapitoken) | GET | 签发 JWT（需 API Key） | 业务后端 |
| [`/oes/collab`](#oescollab) | WS | Yjs 协同（需 JWT） | iframe（编辑器） |
| [`/oes/api/convert/docx`](#oesapiconvertdocx) | POST | HTML → docx 转换 | iframe（编辑器内部调用） |
| [`/oes/api/documents/:docId/comments`](#评论-api) | REST | 评论 CRUD + SSE（引擎内置，无鉴权） | 引擎前端 + 业务系统（只读） |
| `/oes/api/doc/:id/*` | GET | 后端读取文档（**二阶段规划，当前未启用**） | 业务后端 |

---

## `/oes/api/health`

健康检查。

### 请求

```bash
curl http://editor-host:9999/oes/api/health
```

### 响应

```json
{
  "ok": true,
  "service": "umo-collab-server"
}
```

- **状态码**：`200`
- **用途**：容器健康检查（Docker HEALTHCHECK）、负载均衡探活

---

## `/oes/api/token`

签发 JWT。**业务后端调用，需带 `x-api-key`。**

### 请求

```bash
curl -H "x-api-key: <UMO_API_KEY>" \
  "http://editor-host:9999/oes/api/token?name=张三&doc=doc-123&role=editor"
```

### 参数

| 参数 | 位置 | 必填 | 说明 |
| --- | --- | :---: | --- |
| `x-api-key` | header | 生产必填 | `UMO_API_KEY`（引擎环境变量）。**引擎未配置时跳过校验（dev 模式）** |
| `name` | query | ❌ | 用户名。默认随机生成。用于协同光标显示 |
| `doc` | query | ❌ | 文档 id。默认 `demo-doc` |
| `role` | query | ❌ | `editor`（默认）/ `viewer`（只读） |

### 响应

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "name": "张三",
  "doc": "doc-123",
  "role": "editor"
}
```

- **状态码**：`200`
- **`token`**：HS256 签名的 JWT，claims 包含 `name`、`doc`、`role`、`exp`
- **过期时间**：由 `JWT_EXPIRES_IN` 控制（默认 24h）

### 错误

| 状态码 | 说明 |
| --- | --- |
| `401` | API Key 无效或缺失（仅引擎配置了 `UMO_API_KEY` 时校验） |

```json
{ "error": "API Key 无效或缺失" }
```

### CORS

该接口支持 CORS（`Access-Control-Allow-Origin: *`），因为业务后端可能跨域调用。

### 示例（业务后端代理签发）

```js
// 业务后端（Node.js）—— 注意路径带 /oes 前缀
const r = await fetch(
  `http://editor-host:9999/oes/api/token?name=${encodeURIComponent(userName)}&doc=${encodeURIComponent(docId)}&role=${role}`,
  { headers: { 'x-api-key': process.env.UMO_API_KEY } }
)
const { token } = await r.json()
```

> 详见 [鉴权对接](../get-started/authentication.md)。

---

## `/oes/collab`

Yjs 协同 WebSocket 端点。**由 iframe 内的编辑器自动连接，业务前端一般不直接调用。**

### 连接

```
ws(s)://<engine-host>/oes/collab
```

- 协议：`ws://`（HTTP）或 `wss://`（HTTPS）
- 鉴权：连接时传 `token`（HocuspocusProvider 的 `token` 参数）
- documentName：`doc`（文档 id）

编辑器内部连接代码（`embed/src/App.vue`）：

```js
const provider = new HocuspocusProvider({
  url: getCollabWsUrl(),       // ws(s)://<host>/oes/collab（前缀由页面 URL 自动推导）
  name: String(docId),         // documentName = 业务文档 id
  document: ydoc,
  token,                       // JWT
})
```

### 鉴权流程

1. 编辑器连接 `/oes/collab`，传 JWT 作为 `token`
2. 引擎 `onAuthenticate` hook 校验 JWT 签名
3. 校验 JWT 中的 `doc` claim 与请求的 `documentName` 一致
4. 若 `role === 'viewer'`，连接设为只读（服务端拒绝其 update）

### 鉴权失败

JWT 无效或 `doc` 不匹配时，连接被拒绝。编辑器内显示错误态（"协同鉴权失败：<原因>"）。业务前端可通过轮询 `iframe.contentWindow.__UMO_EDITOR__` 或重新签发 token 后重载 iframe 恢复。

---

## `/oes/api/convert/docx`

HTML → docx 转换。**由 iframe 内的编辑器在导出时自动调用（同源），业务后端一般不直接调用。**

### 请求

```bash
curl -X POST http://editor-host:9999/oes/api/convert/docx \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>标题</h1><p>正文</p>","title":"文档标题"}'
```

### 参数

| 参数 | 位置 | 必填 | 说明 |
| --- | --- | :---: | --- |
| `html` | body | ✅ | HTML 字符串（建议用 `getVanillaHTML()` 取高保真 HTML） |
| `title` | body | ❌ | 文档标题，用于生成的 docx 文件名 |

### 响应

返回 `application/vnd.openxmlformats-officedocument.wordprocessingml.document`（docx）二进制流。

- **状态码**：`200`
- **Content-Type**：`application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- **Body**：docx 文件二进制

### 错误

| 状态码 | 说明 |
| --- | --- |
| `400` | 缺少 `html` 字段或转换失败 |
| `500` | 转换服务内部错误 |

```json
{ "error": "转换失败原因" }
```

> 请求体上限 20MB（HTML 可能含 base64 图片）。

### 用途

该接口由编辑器导出流程内部调用，业务前端通常不直接调。完整导出流程见 [导出与文件回传](./export.md)。

---

## 评论 API

引擎内置评论功能（默认开启），评论数据由 collab-server 存储（独立 `comments.db`，SQLite），经引擎 nginx 同源反代。

**外部访问路径**：`http://<engine>:9999/oes/api/...`（内部无 `/oes` 前缀，nginx 已剥除）。

### 鉴权说明

评论 API **无鉴权（同源信任）**：collab-server 的 4000 端口在 Docker 中不对外暴露，评论 API 只能经引擎 nginx 同源反代访问，因此不再叠加额外鉴权。viewer 与 editor 均可读写评论。

### 接口列表

#### 获取文档评论列表

```bash
curl http://editor-host:9999/oes/api/documents/<docId>/comments
```

```json
{
  "comments": [
    {
      "id": "uuid",
      "docId": "doc-123",
      "selectedText": "被评论的文字快照",
      "author": { "id": "u1", "name": "张三", "color": "#e06c75" },
      "content": "评论内容",
      "createdAt": 1720000000000,
      "resolved": false,
      "replies": [
        { "id": "uuid", "author": { "id": "u2", "name": "李四", "color": "" }, "content": "回复内容", "createdAt": 1720000001000 }
      ]
    }
  ]
}
```

#### 新建评论

```bash
curl -X POST http://editor-host:9999/oes/api/documents/<docId>/comments \
  -H "Content-Type: application/json" \
  -d '{"id":"uuid-与mark一致","selectedText":"选中文字","content":"评论内容","author":{"id":"u1","name":"张三","color":"#e06c75"}}'
```

- `id` 由客户端生成（与 Tiptap comment mark 的 `data-comment-id` 一致），缺省时服务端用 UUID 兜底
- `selectedText` 上限 2000 字符，`content` 上限 8000 字符
- 响应 `201`，返回完整评论对象

#### 更新评论（内容 / 解决状态）

```bash
curl -X PATCH http://editor-host:9999/oes/api/comments/<commentId> \
  -H "Content-Type: application/json" \
  -d '{"content":"修改后的内容","resolved":true}'
```

#### 删除评论

```bash
curl -X DELETE http://editor-host:9999/oes/api/comments/<commentId>
```

#### 添加回复

```bash
curl -X POST http://editor-host:9999/oes/api/comments/<commentId>/replies \
  -H "Content-Type: application/json" \
  -d '{"content":"回复内容","author":{"id":"u2","name":"李四","color":""}}'
```

#### 批量删除文档的所有评论（文档删除时级联清理）

```bash
curl -X DELETE http://editor-host:9999/oes/api/documents/<docId>/comments
```

#### SSE 实时推送

```bash
curl -N http://editor-host:9999/oes/api/documents/<docId>/comments/stream
```

- 事件格式：`data: { "type": "comment:added|updated|deleted|replied", "payload": {...} }\n\n`
- 30s 心跳：`data: : ping\n\n`（防止中间代理断开空闲长连接）
- 前端用 `EventSource` 订阅即可

### 接口汇总

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/oes/api/documents/:docId/comments` | 评论列表 |
| POST | `/oes/api/documents/:docId/comments` | 新建评论 |
| DELETE | `/oes/api/documents/:docId/comments` | 批量删除（级联清理） |
| GET | `/oes/api/documents/:docId/comments/stream` | SSE 订阅 |
| PATCH | `/oes/api/comments/:id` | 更新（content / resolved） |
| DELETE | `/oes/api/comments/:id` | 删除单条 |
| POST | `/oes/api/comments/:id/replies` | 添加回复 |

---

## 后端读取文档（二阶段规划）

read-server 提供无头读取 Yjs 文档的能力（列表摘要 / 全文检索）。**当前版本未实现**——引擎 nginx 中 `/oes/api/doc/` 路由处于注释状态，部署后访问会 404。

规划接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/oes/api/doc/:id/excerpt?limit=100` | 纯文本摘要（前 N 字） |
| GET | `/oes/api/doc/:id/html` | 基础节点 HTML |
| GET | `/oes/api/doc/:id/json` | ProseMirror JSON |
| GET | `/oes/api/doc/:id/text` | 完整纯文本 |

> 该能力为二阶段规划，接入前请以引擎当前版本的 nginx 配置为准。高保真导出必须走前端路径（用户在线时），无头渲染复杂节点会降级。

---

## 接口调用关系图

```
业务前端                 业务后端                  引擎
    │                        │                       │
    │ ① /my-doc-token        │                       │
    │ ───────────────────→   │ ② /oes/api/token      │
    │                        │ ───────────────────→  │
    │                        │ ←──── JWT ─────────── │
    │ ←──── token ─────────  │                       │
    │                        │                       │
    │ ③ iframe /oes/embed?token                       │
    │ ───────────────────────────────────────────── →│
    │                                                │
    │                        ④ /oes/collab (WS)      │
    │ ───────────────────────────────────────────── →│
    │ ←─────────────── 实时协同 ───────────────────── │
    │                                                │
    │                        ⑤ /oes/api/convert/docx │
    │                        （导出时 iframe 内部调） │
    │ ───────────────────────────────────────────── →│
    │                                                │
    │                        ⑥ /oes/api/documents/:docId/comments
    │                        （评论 REST + SSE）      │
    │ ───────────────────────────────────────────── →│
```

---

## 下一步

- [鉴权对接](../get-started/authentication.md) —— `/oes/api/token` 的业务后端代理实现
- [导出与文件回传](./export.md) —— `/oes/api/convert/docx` 的完整导出流程
- [postMessage 协议](./postmessage-protocol.md) —— iframe 交互协议
