# 导出与文件回传（方案 B3）

> 用户在业务系统点「导出 Word」时，业务后端需要拿到导出的 docx 文件。本页说明引擎的导出方案 B3：iframe 把文件**直接 POST 推给业务后端**。

---

## 场景

用户在业务系统点「导出 Word」，需要：

1. 编辑器把当前文档转为 docx
2. 业务后端拿到 docx 文件（存对象存储 / 转存 / 打包等）
3. 业务前端拿到文件下载链接展示给用户

---

## 为什么是「推」不是「取」

前端 iframe 生成的 docx 是 **Blob**（浏览器内存对象），**没有网络地址**。`URL.createObjectURL(blob)` 生成的是 `blob:http://...` 伪 URL，**只在生成它的浏览器进程内有效**，业务后端（服务器上）访问不到。

所以不能让业务后端「凭地址去取」，必须由 iframe **直接把文件 POST 推给业务后端**。

这与 OnlyOffice 的 `callbackUrl` 机制本质一致。

```
❌ 错误：业务后端凭 URL 去取
   iframe 生成 blob:url → 业务后端 fetch(blob:url) → 失败（blob:url 只在浏览器有效）

✅ 正确：iframe 直接 POST 推给业务后端（方案 B3）
   iframe 生成 docx Blob → POST 到 callbackUrl → 业务后端收到文件
```

---

## 方案 B3 流程

```
① 业务前端 → iframe:
   { type:'export', format:'docx', title:'文档标题',
     callbackUrl:'https://biz/api/receive-doc', apiKey:'<key>', id:'r1' }

② iframe 内:
   - html = editor.getVanillaHTML()        // 高保真（前端已渲染）
   - blob = await /api/convert/docx 转 docx
   - POST blob 到 callbackUrl              // 直接推给业务后端（header: x-api-key）
   - postMessage 回前端: { type:'export:result', id:'r1', ok:true, url:'<URL>' }

③ 业务后端 /api/receive-doc:
   - 收到文件，存对象存储
   - 返回 { url: 'https://biz/files/xxx.docx' }

④ 业务前端拿到 url，展示下载链接
```

---

## 高保真保证

方案 B3 走「路径①」：用户已打开编辑器，文档已渲染成 DOM（图表/公式/视频都在），`getVanillaHTML()` 处理后转 docx，**所见即所得**，保真度极高。

| 节点类型 | 保真度 |
| --- | --- |
| 段落、标题、表格、列表 | ✅ 完整 |
| 图片（base64 / 外链） | ✅ 完整 |
| Echarts 图表、视频、音频 | ✅ 完整（DOM 已渲染） |
| 数学公式 | ✅ 完整 |
| 代码块高亮 | ✅ 完整 |

> 对比：后端无头导出（read-server）在无 DOM 环境下渲染，复杂节点会降级。高保真导出必须走本方案。

---

## 业务前端代码

### 跨域 postMessage 方式

```js
async function exportDocx(docId, title) {
  const reqId = 'export-' + Date.now()

  iframe.contentWindow.postMessage({
    type: 'export',
    format: 'docx',
    title,                                              // 文档标题
    callbackUrl: 'https://biz.your-domain.com/api/receive-doc',  // 业务后端接收接口
    apiKey: process.env.BIZ_RECEIVE_KEY,                // 可选：业务后端鉴权 key（iframe 以 x-api-key 透传）
    id: reqId
  }, 'http://editor-host:9999')                         // 引擎域名

  // 监听结果
  return new Promise((resolve) => {
    const handler = (e) => {
      if (e.data.type === 'export:result' && e.data.id === reqId) {
        window.removeEventListener('message', handler)
        resolve(e.data)   // { ok:true, url:'...' } 或 { ok:false, error:'...' }
      }
    }
    window.addEventListener('message', handler)
  })
}

// 使用
const result = await exportDocx('doc-123', '我的文档')
if (result.ok) {
  alert('导出成功，下载链接：' + result.url)
} else {
  alert('导出失败：' + result.error)
}
```

### 同源直调方式

同源场景下，可以自己调 `getVanillaHTML()` 并手动 POST，或仍然用 postMessage（导出走的是跨进程回传，两种方式都可）：

```js
iframe.onload = async () => {
  const editor = iframe.contentWindow.__UMO_EDITOR__

  // 1. 取高保真 HTML
  const html = await editor.getVanillaHTML()

  // 2. 调 convert-server 转 docx（同源，相对路径）
  const res = await fetch('/editor/api/convert/docx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, title: '我的文档' })
  })
  const blob = await res.blob()

  // 3. 自己 POST 给业务后端
  const formData = new FormData()
  formData.append('file', blob, '我的文档.docx')
  const cbRes = await fetch('/api/receive-doc', {
    method: 'POST',
    body: formData
  })
  const { url } = await cbRes.json()
  console.log('下载链接：', url)
}
```

---

## export 消息参数

| 字段 | 必填 | 说明 |
| --- | :---: | --- |
| `type` | ✅ | 固定 `'export'` |
| `id` | ✅ | 请求 id，用于匹配 `export:result` 响应 |
| `format` | ❌ | 固定 `'docx'`（目前仅支持 docx） |
| `title` | ❌ | 文档标题，用于生成的 docx 文件名 |
| `callbackUrl` | ✅ | 业务后端接收接口地址 |
| `apiKey` | ❌ | 业务后端鉴权 key，iframe 以 `x-api-key` header 透传给 callbackUrl |
| `headers` | ❌ | 自定义透传 header（对象），如 `{ 'Authorization': 'Bearer xxx' }` |

---

## export:result 响应

```ts
// 成功
{
  type: 'export:result',
  id: '<reqId>',
  ok: true,
  url: string,       // 业务后端返回的文件 URL
  data: any          // 业务后端返回的完整响应体
}

// 失败
{
  type: 'export:result',
  id: '<reqId>',
  ok: false,
  error: string      // 错误信息
}
```

---

## 业务后端接收接口

业务后端需实现一个文件接收接口（如 `/api/receive-doc`）：

```js
// Node.js (Express + multer)
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage() })

app.post('/api/receive-doc', upload.single('file'), async (req, res) => {
  // 1. 校验（建议带 API Key，防止伪造；iframe 会以 x-api-key header 透传 apiKey 参数）
  if (req.headers['x-api-key'] !== process.env.BIZ_RECEIVE_KEY) {
    return res.status(401).json({ error: '未授权' })
  }

  // 2. 存对象存储（OSS/S3/MinIO/本地）
  const file = req.file   // multer 接收的文件（{ buffer, originalname, mimetype, size }）
  const url = await uploadToOss(file)

  // 3. 返回文件 URL（会回传给前端展示下载链接）
  res.json({ url })
})
```

> 业务后端必须返回 `{ url: '<文件下载地址>' }`，`url` 会通过 `export:result` 消息回传给业务前端。

### Java (Spring Boot)

```java
@RestController
public class ReceiveDocController {

    @Value("${biz.receive-key}")
    private String receiveKey;

    @PostMapping("/api/receive-doc")
    public Map<String, String> receive(
            @RequestHeader(value = "x-api-key", required = false) String apiKey,
            @RequestParam("file") MultipartFile file) {

        // 1. 校验
        if (!receiveKey.equals(apiKey)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }

        // 2. 存对象存储
        String url = ossService.upload(file);

        // 3. 返回 URL
        return Map.of("url", url);
    }
}
```

---

## 完整端到端示例

### 业务前端

```html
<iframe id="editor" src="/editor/embed?doc=123&token=xxx"></iframe>
<button onclick="exportDocx()">导出 Word</button>

<script>
const iframe = document.getElementById('editor')

async function exportDocx() {
  const reqId = 'exp-' + Date.now()
  iframe.contentWindow.postMessage({
    type: 'export',
    format: 'docx',
    title: '我的文档',
    callbackUrl: 'https://biz.your-domain.com/api/receive-doc',
    apiKey: 'my-biz-key',
    id: reqId
  }, 'http://editor-host:9999')
}

window.addEventListener('message', (e) => {
  if (e.data.type === 'export:result') {
    if (e.data.ok) {
      alert('导出成功，下载链接：' + e.data.url)
      // 可选：触发下载
      window.open(e.data.url)
    } else {
      alert('导出失败：' + e.data.error)
    }
  }
})
</script>
```

### 业务后端

```js
app.post('/api/receive-doc', upload.single('file'), async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.BIZ_RECEIVE_KEY) {
    return res.status(401).json({ error: '未授权' })
  }
  const url = await uploadToOss(req.file)
  res.json({ url })
})
```

---

## 下一步

- [服务端接口](./server-api.md) —— `/api/convert/docx` 详情
- [postMessage 协议](./postmessage-protocol.md) —— export 消息在协议中的位置
- [完整示例（跨域）](../samples/minimal-cross-domain.md)
