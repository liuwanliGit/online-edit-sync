# 最小可用集成（跨域）

> 不配 nginx 反代，纯 postMessage 完成嵌入 + 导出。适合快速验证或技术栈受限的场景。

---

## 适用场景

- 业务系统无法配置 nginx 反代
- 跨技术栈集成（Java/Python/Go 后端 + 非 Vue 前端）
- 快速 POC 验证

---

## 完整代码

### 1. 业务后端：签发 JWT

```js
// Node.js (Express)
const express = require('express')
const app = express()

// 代理签发 JWT（业务后端持 UMO_API_KEY）
app.get('/my-doc-token', authMiddleware, async (req, res) => {
  const docId = req.query.doc
  const userId = req.user.id
  const userName = req.user.name

  // 校验用户权限，决定角色
  const role = await checkUserPermission(userId, docId)  // 'editor' / 'commenter' / 'viewer'

  // 调引擎签 JWT（注意路径带 /oes 前缀）
  const r = await fetch(
    `http://editor-host:9999/oes/api/token?name=${encodeURIComponent(userName)}&doc=${encodeURIComponent(docId)}&role=${role}`,
    { headers: { 'x-api-key': process.env.UMO_API_KEY } }
  )
  const { token } = await r.json()

  res.json({ token, doc: docId, role })
})

// 接收导出的 docx
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage() })

app.post('/api/receive-doc', upload.single('file'), async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.BIZ_RECEIVE_KEY) {
    return res.status(401).json({ error: '未授权' })
  }
  const file = req.file
  const url = await uploadToOss(file)
  res.json({ url })
})
```

### 2. 业务前端：完整页面

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
  <button onclick="exportDocx()">导出 Word</button>

  <script>
  const ENGINE_URL = 'http://editor-host:9999/oes'   // 引擎地址（带 /oes 前缀）
  const iframe = document.getElementById('editor')
  let editorReady = false

  // ============ 1. 打开文档 ============
  async function openDoc(docId) {
    // 调业务后端拿 token
    const { token, role } = await fetch(`/my-doc-token?doc=${docId}`).then(r => r.json())
    const mode = role === 'viewer' ? 'view' : role === 'commenter' ? 'comment' : 'edit'
    // getEmbedUrl 等价写法：ENGINE_URL + '/embed'（引擎着陆页固定为 /oes/embed）
    iframe.src = `${ENGINE_URL}/embed?doc=${docId}&token=${token}&mode=${mode}`
  }

  // ============ 1.5 响应业务配置请求（可选但推荐） ============
  // embed 挂载时发 { type:'request-config' }，父页面回传 { type:'config', payload }，
  // 用于下发模板 / @提及用户 / 书签显示 / 分享地址等；3s 内不响应则用默认配置。
  window.addEventListener('message', (e) => {
    if (e.data.type === 'request-config') {
      iframe.contentWindow.postMessage({
        type: 'config',
        payload: { users: [], templates: [], page: { showBookmark: true } },
      }, '*')
    }
  })

  // ============ 2. 监听编辑器就绪 ============
  window.addEventListener('message', (e) => {
    if (e.data.type === 'ready') {
      editorReady = true
      console.log('编辑器就绪，文档：', e.data.doc)
    }
    if (e.data.type === 'awareness') {
      console.log('在线协作者：', e.data.collaborators)
    }
  })

  // ============ 3. postMessage 封装 ============
  function callEditor(type, args = {}) {
    const id = 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    return new Promise((resolve, reject) => {
      const handler = (e) => {
        if (e.data.type === `${type}:result` && e.data.id === id) {
          window.removeEventListener('message', handler)
          if (e.data.ok) resolve(e.data.data)
          else reject(new Error(e.data.error))
        }
      }
      window.addEventListener('message', handler)
      iframe.contentWindow.postMessage({ type, id, ...args }, ENGINE_URL)
      // 超时兜底
      setTimeout(() => {
        window.removeEventListener('message', handler)
        reject(new Error('请求超时'))
      }, 10000)
    })
  }

  // ============ 4. 便捷方法 ============
  async function getHTML() { return callEditor('getHTML') }
  async function getJSON() { return callEditor('getJSON') }
  async function getText() { return callEditor('getText') }
  async function setContent(html) { return callEditor('setContent', { content: html }) }
  async function insertContent(html) { return callEditor('insertContent', { content: html }) }
  async function setReadOnly(ro) { return callEditor('setReadOnly', { readOnly: ro }) }

  // ============ 5. 导出 Word ============
  async function exportDocx() {
    const reqId = 'export-' + Date.now()
    iframe.contentWindow.postMessage({
      type: 'export',
      format: 'docx',
      title: '我的文档',
      callbackUrl: 'https://biz.your-domain.com/api/receive-doc',
      apiKey: 'my-biz-key',
      id: reqId
    }, ENGINE_URL)

    // 监听导出结果
    const result = await new Promise((resolve) => {
      const handler = (e) => {
        if (e.data.type === 'export:result' && e.data.id === reqId) {
          window.removeEventListener('message', handler)
          resolve(e.data)
        }
      }
      window.addEventListener('message', handler)
    })

    if (result.ok) {
      alert('导出成功，下载链接：' + result.url)
      window.open(result.url)
    } else {
      alert('导出失败：' + result.error)
    }
  }

  // ============ 启动 ============
  openDoc('doc-123')
  </script>
</body>
</html>
```

---

## 能力清单

这套最小集成已覆盖：

| 能力 | 方式 |
| --- | --- |
| 打开文档 + 实时协同 | iframe `/oes/embed` |
| 业务配置下发 | `request-config` / `config` 消息 |
| 编辑器就绪感知 | `ready` 消息 |
| 取内容（HTML/JSON/Text） | postMessage `getHTML` 等 |
| 替换/插入内容 | postMessage `setContent` / `insertContent` |
| 切换只读 | postMessage `setReadOnly` |
| 导出 Word | postMessage `export` + 业务后端 `/api/receive-doc` |
| 协作者列表 | `awareness` 消息 |
| 评论（引擎内置） | 引擎左侧面板 / 状态栏，无需业务后端 |

---

## 局限

跨域 postMessage 有以下固有限制（详见 [postMessage 协议 - 跨域硬限制](../api-reference/postmessage-protocol.md#跨域硬限制)）：

- 拿不到 Tiptap/ProseMirror 底层实例
- 拖拽跨域体验受限
- 高频事件需节流

如需更强交互，请参考 [强交互集成（同源）](./full-same-origin.md)。

---

## 下一步

- [强交互集成（同源）](./full-same-origin.md) —— 配 nginx 反代走同源直调
- [瘦客户端示例项目](./demo-project.md) —— 仓库 `demo/` 目录的完整可运行示例
