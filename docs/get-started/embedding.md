# 前端 iframe 嵌入

> 本页说明业务前端如何获取 token、构造 iframe URL，并把编辑器嵌入业务页面。

---

## 嵌入流程

```
① 业务前端调业务后端拿 token
   ↓
② 用 doc + token + mode 构造 /oes/embed URL
   ↓
③ 把 URL 赋给 iframe.src
   ↓
④ embed 加载 → postMessage 请求业务配置（request-config）→ 父页面回传 config
   ↓
⑤ 建立协同连接 → 编辑器就绪 → postMessage('ready')
   ↓
⑥ 与编辑器交互（同源直调 window.__UMO_EDITOR__ 或 postMessage）
```

---

## 最小示例

```js
// 业务前端：用户打开文档时
async function openDocument(docId) {
  // 1. 调业务后端拿 token（见 鉴权对接 一节）
  const { token, role } = await fetch(`/my-doc-token?doc=${docId}`).then(r => r.json())

  // 2. 构造 iframe URL（注意：引擎地址带 /oes 前缀，自动拼 /embed）
  const mode = role === 'viewer' ? 'view' : 'edit'
  const editorUrl = `http://editor-host:9999/oes/embed?doc=${docId}&token=${token}&mode=${mode}`

  // 3. 嵌入 iframe
  document.querySelector('#editor-frame').src = editorUrl
}
```

```html
<iframe
  id="editor-frame"
  width="100%"
  height="800"
  allow="clipboard-read; clipboard-write; fullscreen"
></iframe>
```

> `allow="clipboard-read; clipboard-write; fullscreen"` 建议带上，否则复制粘贴和全屏可能受浏览器策略限制。

---

## iframe URL 参数

| 参数 | 必填 | 默认值 | 说明 |
| --- | :---: | --- | --- |
| `doc` | ✅ | — | 文档唯一 id（业务系统自己的文档主键）。协同服务端用此作为 Yjs documentName |
| `token` | ✅ | — | 业务后端签发的 JWT |
| `mode` | ❌ | `edit` | `edit`（可编辑）/ `view`（只读）。只读模式下引擎服务端强制拒绝编辑 |
| `lang` | ❌ | `zh-CN` | `zh-CN`（中文）/ `en-US`（英文）。控制编辑器 UI 语言 |
| `title` | ❌ | — | 文档标题。显示在编辑器内标题位（工具栏左侧、导出文件名），不传则显示「未命名」 |

完整契约见 [iframe URL 参数](../api-reference/url-params.md)。

---

## 业务配置下发（request-config / config 协议）

embed 挂载时会主动向父页面发送 `{ type: 'request-config' }`，**父页面应回传** `{ type: 'config', payload }`，下发业务系统可控制的编辑器配置。若 3 秒内父页面未响应，embed 使用默认配置继续加载（不阻塞）。

```js
// 父页面监听
window.addEventListener('message', (e) => {
  if (e.data.type === 'request-config') {
    iframe.contentWindow.postMessage({
      type: 'config',
      payload: {
        // 模板：编辑器「模板」工具插入的内容
        templates: [
          { title: '工作任务', description: '工作任务模板', content: '<h1>工作任务</h1>...' },
        ],
        // @提及用户目录（输入 @ 触发本地过滤）
        users: [{ id: 'alice', label: 'Alice', color: '#e06c75' }],
        // 页面配置（可覆盖 showBookmark 等）
        page: { showBookmark: true },
        // 分享地址 / CDN 地址（可选，覆盖编辑器默认值）
        shareUrl: 'https://share.example.com/s/xxx',
        cdnUrl: 'https://cdn.example.com',
      },
    }, '*')
  }
})
```

| payload 字段 | 类型 | 说明 |
| --- | --- | --- |
| `templates` | `Array` | 模板列表（`{ title, description, content }`），编辑器「模板」工具使用 |
| `users` | `Array` | @提及用户目录（`{ id, label, bio?, color? }`），embed 本地过滤 |
| `page.showBookmark` | `boolean` | 是否显示书签（默认 `true`） |
| `shareUrl` | `string` | 分享地址（可选） |
| `cdnUrl` | `string` | CDN 地址（可选） |

> 用 postMessage 下发配置而不是 URL 参数，是为了不受 URL 长度限制、且配置随业务运行态变化。

---

## 感知编辑器就绪

iframe 加载完成不等于编辑器就绪——引擎还需要建立协同连接、同步文档。有两种方式感知就绪：

### 方式一：监听 postMessage（跨域 & 同源通用）

```js
window.addEventListener('message', (e) => {
  // 建议：校验 e.origin 为引擎域名
  if (e.data.type === 'ready') {
    console.log('编辑器已就绪，文档 id:', e.data.doc)
  }
})
```

引擎在编辑器创建后会向父页面发送 `{ type: 'ready', doc: '<docId>' }`。

### 方式二：同源直调检查（仅同源）

```js
iframe.onload = () => {
  // 同源时可直接访问
  const editor = iframe.contentWindow.__UMO_EDITOR__
  if (editor) {
    console.log('编辑器实例已就绪')
  }
}
```

> ⚠️ 同源场景下 `iframe.onload` 触发时，协同可能还在连接中（`__UMO_EDITOR__` 尚未挂载）。引擎的加载流程是：先建立协同连接 → 同步成功 → 才挂载编辑器组件并暴露 `__UMO_EDITOR__`。所以更可靠的做法是监听 `ready` 消息。

---

## 加载状态处理

引擎在协同连接建立前会显示加载态（"正在连接协同服务…"）。鉴权失败时显示错误态。业务前端无需额外处理，但如果想在父页面展示 loading 遮罩，可以：

- iframe `onload` 时隐藏父页面 loading（iframe 内部可能还在连协同）
- 收到 `ready` 消息时确认编辑器真正可用

---

## 运行时指定引擎地址

业务前端可通过全局变量在运行时指定引擎地址，**无需重新构建**。读取优先级（高 → 低）：

1. `window.__UMO_CONFIG__.engineUrl` —— 来自部署时生成的 `config.js`（Docker 部署由 entrypoint 注入，推荐）
2. `window.__UMO_ENGINE_URL__` —— 全局变量覆盖（兼容旧用法）
3. 兜底 `http://localhost:9999/oes`（本地开发）

```js
// 方式一：config.js（部署后可改，无需重新构建前端）
window.__UMO_CONFIG__ = { engineUrl: 'http://editor-host:9999/oes' }

// 方式二：全局变量
window.__UMO_ENGINE_URL__ = 'http://editor-host:9999/oes'

// 反代同源时（业务系统 nginx 把引擎反代到 /oes 子路径，iframe 与父页面同域）
window.__UMO_ENGINE_URL__ = '/oes'
```

> ⚠️ 引擎地址必须带 **`/oes` 前缀**（业务系统部署目录），且**不要**带 `/embed`（前端会自动拼 `/embed`）。

> 仓库 `demo/src/utils/engine-config.js` 提供了 `getEngineUrl()` 和 `getEmbedUrl(doc, token, mode, lang, title)` 两个辅助函数，可直接复用：

```js
import { getEmbedUrl } from '@/utils/engine-config'

const url = getEmbedUrl(docId, token, 'edit', 'zh-CN', '我的文档')
// → "http://editor-host:9999/oes/embed?doc=...&token=...&mode=edit&lang=zh-CN&title=..."
```

---

## token 过期处理

JWT 默认 24h 过期。建议在 iframe 加载前检查剩余有效期，临近过期重新换 token：

```js
async function ensureFreshToken(docId) {
  const { token, exp } = await fetch(`/my-doc-token?doc=${docId}`).then(r => r.json())
  const now = Math.floor(Date.now() / 1000)
  if (exp - now < 3600) {
    // 剩余不足 1 小时：重新签发
    return (await fetch(`/my-doc-token?doc=${docId}`).then(r => r.json())).token
  }
  return token
}
```

详见 [鉴权对接 - token 过期处理](./authentication.md#token-过期处理)。

---

## 下一步

编辑器嵌入后，下一步是 [与编辑器交互](../api-reference/same-origin-api.md) —— 同源直调或 postMessage。
