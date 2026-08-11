# 同源直调 API

> 当业务前端配了 nginx 反代，iframe 与父页面同域时，可直接访问 iframe 内的编辑器实例 `window.__UMO_EDITOR__`，**同步**调用全部方法。这是最强的交互方式。

---

## 使用条件

同源直调要求 iframe 与父页面**同域**（同 protocol + host + port）。通常通过 [nginx 同域反代](./nginx-reverse-proxy.md) 实现：

```js
// 业务系统 nginx 把引擎反代到 /oes/ 子路径
// iframe src: /oes/embed?doc=xxx&token=xxx （与父页面同域）
iframe.src = `/oes/embed?doc=${docId}&token=${token}`

iframe.onload = () => {
  const editor = iframe.contentWindow.__UMO_EDITOR__  // 同源，直接拿
  const html = editor.getHTML()                       // 同步调用
}
```

---

## 等待编辑器就绪

`iframe.onload` 触发时，协同可能还在连接中，`__UMO_EDITOR__` 尚未挂载。引擎的加载顺序是：

```
iframe 加载 → 建立协同连接 → Yjs 同步成功 → 挂载编辑器组件 → 暴露 __UMO_EDITOR__
```

可靠的就绪检测方式：

```js
// 方式一：轮询（简单）
function waitForEditor(iframe, cb, retries = 50) {
  if (iframe.contentWindow.__UMO_EDITOR__) {
    cb(iframe.contentWindow.__UMO_EDITOR__)
  } else if (retries > 0) {
    setTimeout(() => waitForEditor(iframe, cb, retries - 1), 100)
  }
}

iframe.onload = () => waitForEditor(iframe, (editor) => {
  console.log(editor.getHTML())
})

// 方式二：监听 ready 消息（更可靠，同源也能收到）
window.addEventListener('message', (e) => {
  if (e.data.type === 'ready') {
    const editor = iframe.contentWindow.__UMO_EDITOR__
    console.log(editor.getHTML())
  }
})
```

---

## 方法全集

以下方法通过 `iframe.contentWindow.__UMO_EDITOR__.<method>()` 调用。

### 内容操作

#### `getHTML()`

获取文档 HTML。

```js
const html = editor.getHTML()
// → "<h1>标题</h1><p>正文...</p>"
```

- **返回**：`string`（HTML 字符串）

#### `getJSON()`

获取 ProseMirror JSON。

```js
const json = editor.getJSON()
// → { type: 'doc', content: [...] }
```

- **返回**：`Object`（ProseMirror 节点 JSON）

#### `getText()`

获取纯文本。

```js
const text = editor.getText()
// → "标题\n正文..."
```

- **返回**：`string`

#### `getContent(format)`

按指定格式获取内容。

```js
const html = editor.getContent('html')
const json = editor.getContent('json')
const text = editor.getContent('text')
```

- **参数**：`format: 'html' | 'json' | 'text'`
- **返回**：`string | Object`（取决于 format）

#### `setContent(content)`

替换文档全部内容。

```js
editor.setContent('<p>新内容</p>')
```

- **参数**：`content: string`（HTML 字符串）

#### `insertContent(content)`

在当前光标处插入内容。

```js
editor.insertContent('<p>插入的段落</p>')
```

- **参数**：`content: string`（HTML 字符串）

#### `getVanillaHTML()`

获取处理后的高保真 HTML（导出用）。

```js
const html = await editor.getVanillaHTML()
// 转发给 convert-server 转 docx
```

- **返回**：`Promise<string>`
- **用途**：导出 docx 时用，前端已渲染的 DOM（图表/公式/视频都在），保真度极高

#### `saveContent()`

触发保存。

```js
const result = await editor.saveContent()
```

> 协同模式下内容由服务端实时持久化，此方法主要用于触发 `onSave` 回调。

#### `getContentExcerpt()`

获取内容摘要。

```js
const excerpt = editor.getContentExcerpt()
```

### 截图

#### `getImage(format)`

将文档导出为图片。

```js
const blob = await editor.getImage('png')
// 下载
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = 'document.png'
a.click()
```

- **参数**：`format: 'blob' | 'png' | 'jpeg'`
- **返回**：`Promise<Blob>`

### 只读控制

#### `setReadOnly(readOnly)`

切换只读模式。

```js
editor.setReadOnly(true)   // 切到只读
editor.setReadOnly(false)  // 切回可编辑
```

- **参数**：`readOnly: boolean`（默认 `true`）

### 评论（引擎内置）

| 方法 | 说明 |
| --- | --- |
| `getComments()` | 获取当前文档的评论列表（响应式 ref） |
| `toggleCommentPanel()` | 开关左侧评论面板 |

```js
const comments = editor.getComments()
console.log(comments.value)   // 评论数组（reactive ref）
editor.toggleCommentPanel(true)  // 打开评论面板
```

> 评论 UI（气泡按钮 / 左侧面板 / 状态栏入口）由引擎内置，业务系统无需实现评论后端。详见 [服务端接口 - 评论 API](./server-api.md#评论-api)。

### 书签

#### `setBookmark(name)`

在当前光标处设置书签。

```js
editor.setBookmark('chapter1')
```

- **参数**：`name: string`
- **返回**：`boolean`（是否设置成功）

#### `focusBookmark(name)`

定位到指定书签。

```js
editor.focusBookmark('chapter1')
```

- **参数**：`name: string`
- **返回**：`boolean`（是否定位成功）

#### `getAllBookmarks()`

获取全部书签。

```js
const bookmarks = editor.getAllBookmarks()
// → [{ name: 'chapter1', ... }, ...]
```

#### `deleteBookmark(name)`

删除书签。

```js
editor.deleteBookmark('chapter1')
```

### 标签（UI 功能，无专用 API）

引擎支持在文档中插入 / 编辑 / 删除「标签」（inline 节点，形如 `[重要]` 的高亮小标签），**但 `__UMO_EDITOR__` 与 postMessage 均未暴露标签专用方法**（如 `insertTag`），因此方法全集里看不到标签相关操作：

| 操作 | 编辑器 UI 位置 |
| --- | --- |
| 插入 | 工具栏「插入 → 标签」（插入默认样式的标签） |
| 编辑 | 点击标签选中后，气泡菜单支持：改文字 / 内置样式 / 文字颜色 / 背景色 |
| 删除 | 气泡菜单「删除」按钮，或选中后按 Delete / Backspace |

**同源直调可通过 Tiptap 底层实例操作标签**（`useEditor()` 返回 Tiptap Editor）：

```js
const tiptap = editor.useEditor()

// 插入自定义标签（type / text / color / backgroundColor）
tiptap.chain().focus().insertTag({
  text: '重要',
  color: '#ffffff',
  backgroundColor: '#e24b4a',
}).run()

// 点击标签会选中该节点；修改选中标签的属性
tiptap.chain().focus().updateAttributes('tag', { text: '紧急' }).run()

// 删除选中的标签
tiptap.chain().focus().deleteSelection().run()
```

> 标签节点渲染为 `<span data-type="tag">`，随 Yjs 协同自动同步；postMessage（跨域）无法直接操作标签，需走同源直调或由用户在编辑器中操作。

### 编辑器操作

#### `print()`

打印文档。

```js
editor.print()
```

#### `focus()` / `blur()`

聚焦 / 失焦。

```js
editor.focus()
editor.blur()
```

#### `toggleFullscreen()`

切换全屏。

```js
editor.toggleFullscreen()
```

#### `reset()`

重置编辑器。

```js
editor.reset()
```

#### `destroy()`

销毁编辑器。

```js
editor.destroy()
```

> 通常由 iframe 卸载时自动调用，业务前端一般无需手动调。

### 配置类方法

以下方法用于运行时修改编辑器配置（同源直调专属）：

| 方法 | 说明 |
| --- | --- |
| `getOptions()` | 获取当前全部配置 |
| `setOptions(options)` | 修改配置 |
| `setToolbar(options)` | 设置工具栏 |
| `setLayout(layout)` | 设置布局 |
| `setPage(options)` | 设置页面配置 |
| `setWatermark(options)` | 设置水印 |
| `setDocument(options)` | 设置文档配置 |
| `setLocale(locale)` | 设置语言（`zh-CN` / `en-US`） |
| `setTheme(theme)` | 设置主题 |
| `setSkin(skin)` | 设置皮肤 |

### 打字机模式

| 方法 | 说明 |
| --- | --- |
| `startTypewriter()` | 开启打字机模式 |
| `stopTypewriter()` | 关闭打字机模式 |
| `getTypewriterState()` | 获取打字机模式状态 |

### 选区与节点

| 方法 | 说明 |
| --- | --- |
| `getSelectionText()` | 获取选中文本 |
| `getSelectionNode()` | 获取选中节点 |
| `deleteSelectionNode()` | 删除选中节点 |
| `setCurrentNodeSelection()` | 设置当前节点选区 |

### UI 辅助

| 方法 | 说明 |
| --- | --- |
| `useAlert(params)` | 弹出提示框 |
| `useConfirm(params)` | 弹出确认框 |
| `useMessage(type, params)` | 弹出消息提示 |

### 底层访问器

以下方法用于获取底层实例（高级用途）：

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `getEditor()` | Tiptap Editor（ref） | 获取 Tiptap 编辑器实例（响应式 ref） |
| `useEditor()` | Tiptap Editor | 获取 Tiptap 编辑器实例（解包值） |
| `getPage()` | Page 配置 | 获取页面配置 |
| `getTableOfContents()` | 目录数据 | 获取目录 |
| `getLocale()` | string | 获取当前语言 |
| `getI18n()` | i18n 实例 | 获取 i18n 实例 |

> ⚠️ `getEditor()` / `useEditor()` 返回 Tiptap 实例后，可直接操作 ProseMirror transaction、注册自定义扩展等。这是同源直调独有能力，跨域 postMessage 无法实现。

---

## 完整示例

```js
const iframe = document.querySelector('#editor-frame')
iframe.src = '/oes/embed?doc=123&token=xxx'

window.addEventListener('message', (e) => {
  if (e.data.type === 'ready') {
    const editor = iframe.contentWindow.__UMO_EDITOR__

    // 同步拿内容
    console.log(editor.getHTML())
    console.log(editor.getJSON())
    console.log(editor.getText())

    // 同步设置
    editor.setContent('<p>新内容</p>')
    editor.insertContent('<p>插入段落</p>')

    // 截图导出
    editor.getImage('png').then(blob => {
      // 下载或上传
    })

    // 只读切换
    editor.setReadOnly(true)

    // 书签
    editor.setBookmark('chapter1')
    editor.focusBookmark('chapter1')

    // 打印
    editor.print()

    // 评论（引擎内置）
    console.log(editor.getComments().value)
    editor.toggleCommentPanel(true)

    // 拿 Tiptap 底层实例（深度定制）
    const tiptap = editor.useEditor()
    // tiptap.chain().focus().toggleBold().run()
  }
})
```

---

## 下一步

- [postMessage 协议](./postmessage-protocol.md) —— 跨域场景的替代方案
- [nginx 同域反代配置](./nginx-reverse-proxy.md) —— 如何实现同源
- [完整示例（同源）](../samples/full-same-origin.md)
