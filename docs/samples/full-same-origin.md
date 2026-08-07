# 强交互集成（同源）

> 配置 nginx 反代走同源直调，获得引擎最强的交互能力：同步调用、可传对象、可拿 Tiptap 底层实例。

---

## 适用场景

- 业务系统有自己的域名和 nginx，可配置反代
- 需要深度交互（自定义扩展、直接操作 ProseMirror transaction）
- 追求最佳开发体验（同步 API）

---

## 1. 配置 nginx 反代

在业务系统的 nginx 中添加（详见 [nginx 同域反代配置](../api-reference/nginx-reverse-proxy.md)）：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name biz.your-domain.com;

    location /editor/ {
        proxy_pass http://editor-host:9999/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        client_max_body_size 20m;
    }
}
```

---

## 2. 业务后端

与跨域方案完全相同，见 [最小可用集成 - 业务后端](./minimal-cross-domain.md#1-业务后端签发-jwt)。

---

## 3. 业务前端：完整页面

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>文档编辑</title>
</head>
<body>
  <iframe id="editor" width="100%" height="800"
         allow="clipboard-read; clipboard-write; fullscreen"></iframe>
  <button onclick="getHTML()">取 HTML</button>
  <button onclick="insertContent()">插入内容</button>
  <button onclick="exportDocx()">导出 Word</button>

  <script>
  const iframe = document.getElementById('editor')
  let editorReady = false

  // ============ 1. 打开文档（同源，无需指定引擎域名） ============
  async function openDoc(docId) {
    const { token, role } = await fetch(`/my-doc-token?doc=${docId}`).then(r => r.json())
    const mode = role === 'viewer' ? 'view' : 'edit'
    // 同源：用相对路径
    iframe.src = `/editor/embed?doc=${docId}&token=${token}&mode=${mode}`
  }

  // ============ 2. 监听编辑器就绪 ============
  window.addEventListener('message', (e) => {
    if (e.data.type === 'ready') {
      editorReady = true
      console.log('编辑器就绪，文档：', e.data.doc)
    }
  })

  // ============ 3. 同源直调（同步！） ============
  function getEditor() {
    return iframe.contentWindow.__UMO_EDITOR__
  }

  function getHTML() {
    const editor = getEditor()
    if (!editor) return alert('编辑器未就绪')
    // 同步调用，直接拿返回值
    console.log(editor.getHTML())
  }

  function getJSON() {
    const editor = getEditor()
    console.log(editor.getJSON())
  }

  function getText() {
    const editor = getEditor()
    console.log(editor.getText())
  }

  function insertContent() {
    const editor = getEditor()
    // 同步插入
    editor.insertContent('<p>同步插入的段落</p>')
  }

  function setContent() {
    const editor = getEditor()
    editor.setContent('<h1>新标题</h1><p>新内容</p>')
  }

  async function getImage() {
    const editor = getEditor()
    // 截图（返回 Promise<Blob>）
    const blob = await editor.getImage('png')
    const url = URL.createObjectURL(blob)
    window.open(url)
  }

  function setReadOnly(ro) {
    const editor = getEditor()
    editor.setReadOnly(ro)
  }

  // 书签
  function setBookmark(name) {
    const editor = getEditor()
    editor.setBookmark(name)
  }
  function focusBookmark(name) {
    const editor = getEditor()
    editor.focusBookmark(name)
  }

  function print() {
    const editor = getEditor()
    editor.print()
  }

  // ============ 4. 高级：拿 Tiptap 底层实例 ============
  function advancedDemo() {
    const editor = getEditor()
    // 获取 Tiptap Editor 实例（仅同源可用）
    const tiptap = editor.useEditor()

    // 直接调用 Tiptap/ProseMirror 命令
    tiptap.chain().focus().toggleBold().run()
    tiptap.chain().focus().setTextAlign('center').run()

    // 直接 dispatch transaction
    // tiptap.state.tr.insertText('hello')
    // tiptap.view.dispatch(tr)

    // 注册自定义扩展（需在编辑器初始化时注入，这里仅演示能力边界）
  }

  // ============ 5. 导出 Word（方案 B3） ============
  async function exportDocx() {
    const editor = getEditor()

    // 同源可自走导出链路，或仍用 postMessage
    // 这里演示自走链路（更可控）

    // 1. 取高保真 HTML
    const html = await editor.getVanillaHTML()

    // 2. 调 convert-server 转 docx（同源，相对路径）
    const res = await fetch('/editor/api/convert/docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, title: '我的文档' })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return alert('转换失败：' + (err.error || res.status))
    }
    const blob = await res.blob()

    // 3. POST 给业务后端
    const formData = new FormData()
    formData.append('file', blob, '我的文档.docx')
    const cbRes = await fetch('/api/receive-doc', {
      method: 'POST',
      body: formData,
      headers: { 'x-api-key': 'my-biz-key' }
    })
    const { url } = await cbRes.json()
    alert('导出成功，下载链接：' + url)
    window.open(url)
  }

  // ============ 启动 ============
  openDoc('doc-123')
  </script>
</body>
</html>
```

---

## 能力清单

同源集成在跨域方案基础上，额外解锁：

| 能力 | 方式 |
| --- | --- |
| 同步取内容 | `editor.getHTML()`（无需 Promise） |
| 同步插入/替换 | `editor.setContent()` / `editor.insertContent()` |
| 配置类方法 | `setOptions` / `setToolbar` / `setLocale` / `setTheme` 等 |
| 拿 Tiptap 底层实例 | `editor.useEditor()` → 直接操作 ProseMirror |
| 注册自定义扩展 | 在编辑器初始化时注入 Tiptap extension |
| 自走导出链路 | 自行调 `getVanillaHTML` + convert-server |

---

## 下一步

- [同源直调 API](../api-reference/same-origin-api.md) —— 全部方法参考
- [瘦客户端示例项目](./demo-project.md) —— 仓库 `demo/` 目录的完整可运行示例
