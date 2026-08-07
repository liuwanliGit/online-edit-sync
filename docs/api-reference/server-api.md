# 服务端接口

> 本页说明引擎对外暴露的全部 HTTP/WebSocket 接口。所有接口由引擎 nginx 统一入口（`:9999`）反代到内部各服务。

---

## 接口总览

| 接口 | 方法 | 说明 | 调用方 |
| --- | --- | --- | --- |
| [`/api/health`](#apihealth) | GET | 健康检查 | 运维/监控 |
| [`/api/token`](#apitoken) | GET | 签发 JWT（需 API Key） | 业务后端 |
| [`/collab`](#collab) | WS | Yjs 协同（需 JWT） | iframe（编辑器） |
| [`/api/convert/docx`](#apiconvertdocx) | POST | HTML → docx 转换 | iframe（编辑器内部调用） |
| [`/api/doc/:id/*`](#apidoc) | GET | 后端读取文档（二阶段） | 业务后端 |

---

## `/api/health`

健康检查。

### 请求

```bash
curl http://editor-host:9999/api/health
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

## `/api/token`

签发 JWT。**业务后端调用，需带 `x-api-key`。**

### 请求

```bash
curl -H "x-api-key: <UMO_API_KEY>" \
  "http://editor-host:9999/api/token?name=张三&doc=doc-123&role=editor"
```

### 参数

| 参数 | 位置 | 必填 | 说明 |
| --- | --- | :---: | --- |
| `x-api-key` | header | ✅ | `UMO_API_KEY`（引擎环境变量） |
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
| `401` | API Key 无效或缺失 |

```json
{ "error": "API Key 无效或缺失" }
```

### CORS

该接口支持 CORS（`Access-Control-Allow-Origin: *`），因为业务后端可能跨域调用。

### 示例（业务后端代理签发）

```js
// 业务后端（Node.js）
const r = await fetch(
  `http://editor-host:9999/api/token?name=${encodeURIComponent(userName)}&doc=${encodeURIComponent(docId)}&role=${role}`,
  { headers: { 'x-api-key': process.env.UMO_API_KEY } }
)
const { token } = await r.json()
```

> 详见 [鉴权对接](../get-started/authentication.md)。

---

## `/collab`

Yjs 协同 WebSocket 端点。**由 iframe 内的编辑器自动连接，业务前端一般不直接调用。**

### 连接

```
ws(s)://<engine-host>/collab
```

- 协议：`ws://`（HTTP）或 `wss://`（HTTPS）
- 鉴权：连接时传 `token`（HocuspocusProvider 的 `token` 参数）
- documentName：`doc`（文档 id）

编辑器内部连接代码（`embed/src/App.vue`）：

```js
const provider = new HocuspocusProvider({
  url: getCollabWsUrl(),       // ws(s)://<host>/collab
  name: String(docId),         // documentName = 业务文档 id
  document: ydoc,
  token,                       // JWT
})
```

### 鉴权流程

1. 编辑器连接 `/collab`，传 JWT 作为 `token`
2. 引擎 `onAuthenticate` hook 校验 JWT 签名
3. 校验 JWT 中的 `doc` claim 与请求的 `documentName` 一致
4. 若 `role === 'viewer'`，连接设为只读（服务端拒绝其 update）

### 鉴权失败

JWT 无效或 `doc` 不匹配时，连接被拒绝。编辑器触发 `onAuthenticationFailed`，向父页面推送错误态：

```js
onAuthenticationFailed({ reason }) {
  errorMsg.value = `协同鉴权失败：${reason}`
}
```

---

## `/api/convert/docx`

HTML → docx 转换。**由 iframe 内的编辑器在导出时自动调用（同源），业务后端一般不直接调用。**

### 请求

```bash
curl -X POST http://editor-host:9999/api/convert/docx \
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
| `400` | 转换失败（HTML 格式错误等） |

```json
{ "error": "转换失败原因" }
```

### 用途

该接口由编辑器导出流程（方案 B3）内部调用，业务前端通常不直接调。完整导出流程见 [导出与文件回传](./export.md)。

---

## `/api/doc/:id/*`

后端无头读取 Yjs 文档。**二阶段提供，业务后端调用。**

> ⚠️ 该接口在二阶段上线。一阶段仅提供前端交互路径。

### 接口列表

#### 获取纯文本摘要

```bash
curl http://editor-host:9999/api/doc/<docId>/excerpt?limit=100
```

| 参数 | 说明 |
| --- | --- |
| `limit` | 摘要字数（默认 100） |

返回前 N 字的纯文本，适合文档列表展示。

#### 获取完整 HTML

```bash
curl http://editor-host:9999/api/doc/<docId>/html
```

返回基础节点的 HTML 渲染。

#### 获取 ProseMirror JSON

```bash
curl http://editor-host:9999/api/doc/<docId>/json
```

返回原始 ProseMirror JSON。

#### 获取完整纯文本

```bash
curl http://editor-host:9999/api/doc/<docId>/text
```

返回完整纯文本。

### 保真度边界（重要）

read-server 在 Node 无 DOM 环境下渲染，**复杂节点会降级**：

| 节点类型 | 保真度 |
| --- | --- |
| 段落、标题、表格、列表 | ✅ 正常渲染 |
| Echarts 图表、视频、音频 | ⚠️ 占位或空壳 |
| 代码块高亮、数学公式 | ⚠️ 降级 |
| 图片 | ⚠️ base64 和外链保留，样式可能丢 |

> read-server 只用于「够用就行」的离线读取（摘要/检索/统计），**不用于高保真导出**。高保真导出必须走前端路径（用户在线时）。

### 鉴权

read-server 接口不需要 JWT，建议在业务后端调用时加内网/API Key 校验（引擎侧可配）。

---

## 接口调用关系图

```
业务前端                 业务后端                  引擎
    │                        │                       │
    │ ① /my-doc-token        │                       │
    │ ───────────────────→   │ ② /api/token          │
    │                        │ ───────────────────→  │
    │                        │ ←──── JWT ─────────── │
    │ ←──── token ─────────  │                       │
    │                        │                       │
    │ ③ iframe /embed?token  │                       │
    │ ───────────────────────────────────────────── →│
    │                                                │
    │                        ④ /collab (WS, token)   │
    │ ───────────────────────────────────────────── →│
    │ ←─────────────── 实时协同 ───────────────────── │
    │                                                │
    │                        ⑤ /api/convert/docx     │
    │                        （导出时 iframe 内部调） │
    │ ───────────────────────────────────────────── →│
    │                                                │
    │                        ⑥ /api/doc/:id/*        │
    │                        （列表/检索，二阶段）    │
    │                        ────────────────────→   │
```

---

## 下一步

- [鉴权对接](../get-started/authentication.md) —— `/api/token` 的业务后端代理实现
- [导出与文件回传](./export.md) —— `/api/convert/docx` 的完整导出流程
- [postMessage 协议](./postmessage-protocol.md) —— iframe 交互协议
