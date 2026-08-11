# iframe URL 参数

> `/oes/embed` 页面是引擎的 iframe 着陆页（纯编辑器页）。本页说明其 URL 参数契约。

---

## URL 格式

```
GET <engineUrl>/oes/embed?doc=<docId>&token=<jwt>&mode=<edit|view>&lang=<zh-CN|en-US>&title=<文档标题>
```

其中 `<engineUrl>` 是带 `/oes` 前缀的引擎地址，如 `http://editor-host:9999/oes`。

---

## 参数说明

### `doc`（必填）

文档唯一 id。

- 类型：`string`
- 含义：业务系统自己的文档主键
- 用途：协同服务端用此作为 Yjs `documentName`，相同 `doc` 值的连接会进入同一篇文档的协同会话
- 约束：必须与 JWT 中的 `doc` claim 一致，引擎会校验

```url
?doc=doc-123
```

### `token`（必填）

业务后端签发的 JWT。

- 类型：`string`（JWT 格式：`xxx.yyy.zzz`）
- 含义：协同连接鉴权令牌
- 用途：直接传给 HocuspocusProvider 作为协同连接的 `token`
- 约束：必须由业务后端持 `UMO_API_KEY` 调引擎 `/oes/api/token` 签发

```url
?token=eyJhbGciOiJIUzI1NiJ9.eyJuYW1lIjoi...
```

> ⚠️ JWT 会被放进 URL，注意浏览器历史记录泄露风险。生产环境建议配合 HTTPS。

### `mode`（可选）

编辑模式。

- 类型：`string`
- 可选值：`edit`（默认）/ `view`
- 含义：
  - `edit`：可编辑
  - `view`：只读，引擎服务端强制拒绝编辑（即使前端绕过，协同服务端也会拒绝 viewer 的写入）

```url
?mode=view
```

### `lang`（可选）

编辑器 UI 语言。

- 类型：`string`
- 可选值：`zh-CN`（默认）/ `en-US`
- 含义：控制编辑器界面语言

```url
?lang=en-US
```

### `title`（可选）

文档标题。

- 类型：`string`
- 含义：显示在编辑器内标题位（工具栏左侧标题区、导出文件名等）。不传则编辑器内显示为「未命名」
- 用途：让编辑器内部呈现业务系统的文档名称，提升一致性

```url
?title=我的文档
```

> 标题需 URL 编码。构造时建议用 `URLSearchParams`（会自动编码）。

---

## 完整示例

```url
http://editor-host:9999/oes/embed?doc=doc-123&token=eyJhbGciOiJIUzI1NiJ9...&mode=edit&lang=zh-CN&title=我的文档
```

---

## 构造辅助函数

仓库 `demo/src/utils/engine-config.js` 提供了构造函数：

```js
import { getEmbedUrl, getEngineUrl } from '@/utils/engine-config'

// 获取引擎根地址（带 /oes 前缀）
const engineUrl = getEngineUrl()  // 默认 http://localhost:9999/oes

// 构造 embed URL
const url = getEmbedUrl('doc-123', '<jwt>', 'edit', 'zh-CN', '我的文档')
// → "http://localhost:9999/oes/embed?doc=doc-123&token=...&mode=edit&lang=zh-CN&title=我的文档"
```

`getEmbedUrl` 签名：

```ts
function getEmbedUrl(
  doc: string,        // 文档 id（必填）
  token: string,      // JWT（必填）
  mode?: string,      // 'edit' | 'view'，默认 'edit'
  lang?: string,      // 'zh-CN' | 'en-US'，默认 'zh-CN'
  title?: string,     // 文档标题（可选，显示在编辑器内标题位）
): string
```

引擎地址解析规则（优先级从高到低）：

| 设置方式 | 结果 |
| --- | --- |
| `window.__UMO_CONFIG__.engineUrl = 'http://editor-host:9999/oes'` | 用该地址（部署时由 `config.js` 注入，推荐） |
| `window.__UMO_ENGINE_URL__ = 'http://editor-host:9999/oes'` | 用该地址（兼容旧用法） |
| `window.__UMO_ENGINE_URL__ = '/oes'` | 反代同源前缀（iframe 与父页面同域） |
| 未设置 | 兜底 `http://localhost:9999/oes` |

---

## 下一步

- [同源直调 API](./same-origin-api.md)
- [postMessage 协议](./postmessage-protocol.md)
