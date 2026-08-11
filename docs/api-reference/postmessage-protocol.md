# postMessage 协议

> 当 iframe 与父页面不同域（未配 nginx 反代）时，通过 `window.postMessage` 进行异步请求/响应通信。本页说明完整的消息协议。

---

## 协议概览

```
父页面（业务前端）                          iframe（引擎 /oes/embed）
     │                                            │
     │  ① postMessage({ type, id, ...args })       │
     │ ─────────────────────────────────────────→  │
     │                                            │ dispatchMethod()
     │                                            │
     │  ② postMessage({ type: '<type>:result',     │
     │       id, ok, data | error })               │
     │ ←─────────────────────────────────────────  │
     │                                            │
```

- **请求**（父页面 → iframe）：`{ type: '<method>', id: '<reqId>', ...args }`
- **响应**（iframe → 父页面）：`{ type: '<method>:result', id: '<reqId>', ok: true|false, data | error }`

`id` 用于匹配请求与响应。

> 除了请求/响应，还有两类「配置」消息：embed 挂载时发 `request-config` 请求业务配置，父页面回传 `config`。详见下文 [引擎主动推送的消息](#引擎主动推送的消息)。

---

## 发送请求

```js
const iframe = document.querySelector('#editor-frame')
const engineOrigin = 'http://editor-host:9999'  // 引擎域名

const reqId = 'req-' + Date.now()

iframe.contentWindow.postMessage({
  type: 'getContent',       // 方法名
  id: reqId,                // 请求 id（用于匹配响应）
  format: 'html',           // 方法参数
}, engineOrigin)            // targetOrigin：引擎域名（dev 可用 '*'）
```

> ⚠️ 生产环境 `targetOrigin` 必须填引擎域名，不要用 `'*'`，避免消息被其他页面截获。

---

## 接收响应

```js
window.addEventListener('message', (e) => {
  // 建议：校验 e.origin 为引擎域名
  // if (e.origin !== engineOrigin) return

  if (e.data.type === 'getContent:result' && e.data.id === reqId) {
    if (e.data.ok) {
      console.log('文档 HTML:', e.data.data)
    } else {
      console.error('请求失败:', e.data.error)
    }
  }
})
```

响应结构：

```ts
// 成功
{
  type: '<method>:result',
  id: '<reqId>',
  ok: true,
  data: any              // 方法返回值
}

// 失败
{
  type: '<method>:result',
  id: '<reqId>',
  ok: false,
  error: string          // 错误信息
}
```

---

## 标准方法列表

以下方法通过 postMessage 可调用（引擎 `dispatchMethod` 支持）：

### 内容操作

| `type` | 参数 | 响应 `data` | 说明 |
| --- | --- | --- | --- |
| `getContent` | `{ format: 'html'\|'text'\|'json' }` | 内容 | 取文档内容 |
| `setContent` | `{ content: string }` | `{ ok: true }` | 替换文档内容 |
| `insertContent` | `{ content: string }` | `{ ok: true }` | 在光标处插入内容 |
| `getHTML` | 无 | `string` | 取 HTML |
| `getJSON` | 无 | `Object` | 取 ProseMirror JSON |
| `getText` | 无 | `string` | 取纯文本 |

### 截图

| `type` | 参数 | 响应 `data` | 说明 |
| --- | --- | --- | --- |
| `getImage` | `{ format: 'blob'\|'png'\|'jpeg' }` | `ArrayBuffer` | 截图导出 |

> `getImage` 返回的 Blob 在 postMessage 序列化时会变成 ArrayBuffer。

### 只读控制

| `type` | 参数 | 响应 `data` | 说明 |
| --- | --- | --- | --- |
| `setReadOnly` | `{ readOnly: boolean }` | `{ ok: true }` | 切换只读 |

### 书签

| `type` | 参数 | 响应 `data` | 说明 |
| --- | --- | --- | --- |
| `setBookmark` | `{ name: string }` | `{ ok: boolean }` | 设置书签 |
| `focusBookmark` | `{ name: string }` | `{ ok: boolean }` | 定位书签 |
| `getAllBookmarks` | 无 | 书签数组 | 获取全部书签 |

> 删除书签 `deleteBookmark` 仅同源直调可用（未加入 postMessage 分发），跨域场景可改为同源直调或忽略。

### 其他

| `type` | 参数 | 响应 `data` | 说明 |
| --- | --- | --- | --- |
| `print` | 无 | `{ ok: true }` | 打印 |
| `focus` | 无 | `{ ok: true }` | 聚焦 |
| `blur` | 无 | `{ ok: true }` | 失焦 |

### 导出（特殊流程）

`export` 是异步的特殊流程（方案 B3），不走 `dispatchMethod`，详见 [导出与文件回传](./export.md)。

---

## 引擎主动推送的消息

除了请求-响应，引擎还会主动向父页面推送以下消息：

### `request-config`

embed 挂载时向父页面请求业务配置。父页面应回传 `{ type: 'config', payload }`（见下）。若 3 秒内未响应，embed 使用默认配置继续加载。

```js
{ type: 'request-config' }
```

### `config`

父页面回传给 embed 的业务配置（模板 / @提及用户 / 书签显示 / 分享与 CDN 地址），由业务系统控制：

```js
{
  type: 'config',
  payload: {
    templates: [{ title: '工作任务', description: '工作任务模板', content: '<h1>...</h1>' }],
    users: [{ id: 'alice', label: 'Alice', color: '#e06c75' }],
    page: { showBookmark: true },
    shareUrl: 'https://share.example.com/s/xxx',   // 可选
    cdnUrl: 'https://cdn.example.com',              // 可选
  }
}
```

### `ready`

编辑器创建完成，可以开始交互。

```js
{ type: 'ready', doc: '<docId>' }
```

### `awareness`

协作者列表变化。

```js
{
  type: 'awareness',
  collaborators: [
    { clientId: 123, user: { id: 'u1', name: '张三', color: '#e06c75', role: 'editor' } },
    { clientId: 456, user: { id: 'u2', name: '李四', color: '#56b6c2', role: 'viewer' } },
  ]
}
```

业务前端可据此展示在线协作者列表（头像 / 名字 / 角色徽章）。

### `export:result`

导出结果（响应 `export` 请求），详见 [导出与文件回传](./export.md)。

```js
// 成功
{ type: 'export:result', id, ok: true, url: '<业务后端返回的URL>', data: {...} }
// 失败
{ type: 'export:result', id, ok: false, error: '...' }
```

---

## 封装辅助函数

为简化 postMessage 调用，可封装一个 Promise 化的请求函数：

```js
class EditorBridge {
  constructor(iframe, engineOrigin) {
    this.iframe = iframe
    this.origin = engineOrigin
    this.counter = 0
    this.pending = new Map()

    window.addEventListener('message', (e) => {
      // 建议：校验 e.origin
      const data = e.data
      if (!data?.type?.endsWith(':result') && data?.type !== 'export:result') return

      const handler = this.pending.get(data.id)
      if (!handler) return

      this.pending.delete(data.id)
      if (data.ok) {
        handler.resolve(data)
      } else {
        handler.reject(new Error(data.error))
      }
    })
  }

  call(type, args = {}, timeout = 10000) {
    const id = `req-${++this.counter}`
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.iframe.contentWindow.postMessage({ type, id, ...args }, this.origin)

      // 超时兜底
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`请求超时: ${type}`))
        }
      }, timeout)
    })
  }

  // 便捷方法
  getHTML() { return this.call('getHTML') }
  getJSON() { return this.call('getJSON') }
  getText() { return this.call('getText') }
  getContent(format) { return this.call('getContent', { format }) }
  setContent(content) { return this.call('setContent', { content }) }
  insertContent(content) { return this.call('insertContent', { content }) }
  setReadOnly(readOnly) { return this.call('setReadOnly', { readOnly }) }
  print() { return this.call('print') }
}

// 使用
const bridge = new EditorBridge(iframe, 'http://editor-host:9999')
const result = await bridge.getHTML()
console.log(result.data)  // HTML 字符串
```

---

## 跨域硬限制

postMessage 有以下固有限制（同源直调无此限制）：

### 拿不到 Tiptap/ProseMirror 底层实例

函数引用不可跨域克隆（structured clone 不支持函数）。深度定制（自定义 Tiptap 扩展、直接 dispatch ProseMirror transaction）必须走 [同源直调](./same-origin-api.md)。

### 拖拽跨域

从父页面拖元素进 iframe，`drop` 事件不跨 frame。解决：父页面拦截 `drop` → 提取数据 → postMessage → iframe 内 `insertContent`。

### 高频事件

`changed`（每次按键）等事件可由 iframe 推出，但需节流（建议 100ms），避免 postMessage 风暴。

---

## 下一步

- [同源直调 API](./same-origin-api.md) —— 更强的交互方式
- [导出与文件回传](./export.md) —— export 消息的特殊流程
- [完整示例（跨域）](../samples/minimal-cross-domain.md)
