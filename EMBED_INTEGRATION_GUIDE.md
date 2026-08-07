# Umo Editor 企业接入指南

> 本文档面向**接入方(企业业务系统)**,说明如何把 Umo Editor 协同编辑能力集成到自己的业务系统。
>
> Umo Editor 引擎以**私有化镜像**形式交付,部署在企业自己的服务器上。业务系统通过 **iframe** 嵌入编辑器,通过 **同源直调** 或 **跨域 postMessage** 两种方式与编辑器交互。
>
> 对标的商业产品形态:OnlyOffice Document Server(自部署版)。区别:Umo Editor 前端是 Vue3 组件库,iframe 内是完整编辑器;交互协议同时支持同源同步调用和跨域消息通信。
>
> 最后更新:2026-08-06

---

## 目录

1. [架构总览](#一架构总览)
2. [第一步:部署引擎镜像](#二第一步部署引擎镜像)
3. [第二步:鉴权对接](#三第二步鉴权对接企业后端代理签发-jwt)
4. [第三步:前端 iframe 嵌入](#四第三步前端-iframe-嵌入)
5. [第四步:与编辑器交互](#五第四步与编辑器交互)
6. [第五步:导出与文件回传](#六第五步导出与文件回传方案-b3)
7. [可选:nginx 同域反代(强交互)](#七可选nginx-同域反代强交互)
8. [可选:后端读文档(列表摘要/检索)](#八可选后端读文档列表摘要检索二阶段)
9. [完整接入示例](#九完整接入示例)
10. [FAQ](#十faq)

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────────────┐
│ 企业业务系统(你的项目)                                       │
│                                                             │
│  业务前端                    业务后端                         │
│  ┌───────────┐              ┌──────────────┐               │
│  │ 业务页面   │ ──REST──→   │ 业务后端      │               │
│  │ <iframe>  │             │ 持有 UMO_API_KEY              │ │
│  └─────┬─────┘              └──────┬───────┘               │
│        │                           │                        │
│        │ iframe src                │ GET /api/token          │
│        │ /embed?doc=&token=        │ (header: x-api-key)     │
│        ▼                           ▼                        │
└────────┼───────────────────────────┼────────────────────────┘
         │                           │
         │      HTTP/WS              │
         ▼                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Umo Editor 引擎镜像(企业自部署)                              │
│  nginx(:9999)                                               │
│   ├─ /embed          → 纯编辑器页(iframe 着陆页)            │
│   ├─ /collab (WS)    → collab-server(:4000) Yjs 协同        │
│   ├─ /api/token      → collab-server JWT 签发(需 API Key)   │
│   ├─ /api/convert    → convert-server(:4002) HTML→docx      │
│   └─ /api/doc/:id    → read-server(:4003,二阶段) Yjs→HTML   │
└─────────────────────────────────────────────────────────────┘
```

**关键点**:
- 业务系统**不直接**调 `/api/token`,而是由**业务后端**代签 JWT(API Key 不暴露给前端)
- 前端通过 iframe 嵌入 `/embed`,把 token 放进 URL
- 交互方式:同源直调(强)或跨域 postMessage(通用),二选一,见第四节
- 导出:编辑器把文件**直接 POST 到业务后端**(方案 B3),见第五节

---

## 二、第一步:部署引擎镜像

### 2.1 拿到镜像

企业从交付方获取 `umo-editor-engine:latest` 镜像(或 Dockerfile 自行构建)。

### 2.2 启动容器

```bash
docker run -d \
  --name umo-editor \
  -p 9999:9999 \
  -e JWT_SECRET='<你的强随机密钥,用于签发JWT>' \
  -e UMO_API_KEY='<你的强随机密钥,业务后端调用token接口时带这个>' \
  -e JWT_EXPIRES_IN=24h \
  -v umo-collab-data:/app/collab-server/data \
  --restart unless-stopped \
  umo-editor-engine:latest
```

> 也可用 docker compose 启动（仓库自带 `docker/docker-compose.yml`）：
> ```bash
> docker compose -f docker/docker-compose.yml up -d --build
> ```
> 或用一键脚本：`bash docker/build.sh up`（Linux/macOS）/ `docker\build.bat`（Windows）。

**环境变量说明**:

| 变量 | 必填 | 说明 |
|---|---|---|
| `JWT_SECRET` | 是 | JWT 签名密钥(HS256)。务必设为强随机值,不对外公开 |
| `UMO_API_KEY` | 是 | 业务后端调用 `/api/token` 时的凭据。务必设为强随机值 |
| `JWT_EXPIRES_IN` | 否 | JWT 过期时间,默认 `24h` |

> 端口：容器内 nginx 固定监听 `9999`，通过 `-p <宿主机端口>:9999` 映射。如需改对外端口，改 `-p 8080:9999` 即可。

**数据持久化**:`-v umo-collab-data:/app/collab-server/data` 挂载协同文档存储卷,容器重建不丢数据。

### 2.3 验证启动

```bash
# 健康检查
curl http://localhost:9999/api/health

# 访问 embed 页(应返回纯编辑器页,不是登录页)
curl http://localhost:9999/embed?doc=test&token=xxx
```

---

## 三、第二步:鉴权对接(企业后端代理签发 JWT)

### 3.1 为什么要业务后端代理

引擎的 `/api/token` 需要 `UMO_API_KEY`。这个 Key **绝不能暴露给前端**(否则任何人都能签 JWT)。所以由业务后端持有 Key,代为签发。

### 3.2 业务后端实现

业务后端新增一个接口,给前端用。这个接口:
1. 校验业务系统自己的登录态(原有鉴权逻辑)
2. 决定用户对该文档的角色(editor/viewer)—— 业务原有权限逻辑
3. 调引擎 `/api/token` 签发 JWT,返回给前端

**Node.js 示例**:
```js
// 业务后端
app.get('/my-doc-token', authMiddleware, async (req, res) => {
  const docId = req.query.doc
  const userId = req.user.id
  const userName = req.user.name

  // 1. 校验用户能否访问该文档(业务原有逻辑)
  const role = await checkUserPermission(userId, docId)  // 'editor' 或 'viewer'

  // 2. 调引擎签 JWT(带上 UMO_API_KEY)
  const r = await fetch(
    `http://editor-host:9999/api/token?name=${encodeURIComponent(userName)}&doc=${encodeURIComponent(docId)}&role=${role}`,
    { headers: { 'x-api-key': process.env.UMO_API_KEY } }
  )
  const { token } = await r.json()

  // 3. 返回给前端
  res.json({ token, doc: docId, role })
})
```

**Java/Python/Go 等同理**:核心是业务后端持 `UMO_API_KEY`,代调 `/api/token`,前端拿到的只是短时 JWT。

### 3.3 JWT claims 说明

引擎签发的 JWT 包含:
- `name`:用户名(用于协同光标显示)
- `doc`:文档 id(必须与 iframe 的 `doc` 参数一致,引擎会校验)
- `role`:`editor`(可编辑)或 `viewer`(只读,引擎服务端强制拒绝其编辑)
- `exp`:过期时间

**角色由业务后端决定**,前端不能篡改(篡改需持 API Key)。

---

## 四、第三步:前端 iframe 嵌入

### 4.1 获取 token 并构造 iframe URL

```js
// 业务前端:用户打开文档时
async function openDocument(docId) {
  // 1. 调业务后端拿 token
  const { token, role } = await fetch(`/my-doc-token?doc=${docId}`).then(r => r.json())

  // 2. 构造 iframe URL
  const mode = role === 'viewer' ? 'view' : 'edit'
  const editorUrl = `http://editor-host:9999/embed?doc=${docId}&token=${token}&mode=${mode}`

  // 3. 嵌入 iframe
  document.querySelector('#editor-frame').src = editorUrl
}
```

### 4.2 iframe URL 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `doc` | 是 | 文档唯一 id(业务系统自己的文档主键) |
| `token` | 是 | 业务后端签发的 JWT |
| `mode` | 否 | `edit`(默认可编辑)/ `view`(只读) |
| `lang` | 否 | `zh-CN`(默认)/ `en-US` |

### 4.3 token 过期处理

JWT 默认 24h 过期。建议:
- 业务前端在 iframe 加载前检查 token 剩余有效期,临近过期重新调业务后端换 token
- 或协同连接断开时(`onAuthenticationFailed`),重新走「换 token → 重设 iframe src」流程

---

## 五、第四步:与编辑器交互

### 交互方式选择

| 方式 | 适用场景 | 能力 |
|---|---|---|
| **同源直调** | 业务前端配了 nginx 反代,iframe 与父页面同域 | **最强**:同步调用,可直接传对象/拿函数返回值 |
| **跨域 postMessage** | iframe 与父页面不同域,或不配反代 | **通用**:异步请求/响应,不能传函数 |

**推荐**:条件允许就配 nginx 反代走同源直调(见第六节);不支持反代的环境用 postMessage。

### 5.1 同源直调(推荐)

配 nginx 反代后(`/editor/` → 引擎),iframe 与父页面同域,可直接访问 iframe 内的编辑器实例:

```js
const iframe = document.querySelector('#editor-frame')
iframe.onload = () => {
  const editor = iframe.contentWindow.__UMO_EDITOR__

  // 同步调用,直接拿返回值
  const html = editor.getHTML()
  const json = editor.getJSON()
  const text = editor.getText()

  // 同步设置
  editor.setContent('<p>新内容</p>')
  editor.insertContent('<p>插入段落</p>')

  // 截图导出(返回 Promise<Blob>)
  const blob = await editor.getImage('png')

  // 只读切换
  editor.setReadOnly(true)

  // 书签
  editor.focusBookmark('chapter1')
}
```

**可用方法全集**(对照编辑器 `defineExpose`):
- 内容:`getHTML` / `getJSON` / `getText` / `getContent(format)` / `setContent` / `insertContent`
- 截图:`getImage(format)` (format: 'blob'|'png'|'jpeg')
- 导出 docx:`getVanillaHTML()` 拿处理后的 HTML,再 POST 给 convert-server
- 只读:`setReadOnly(bool)`
- 书签:`focusBookmark(name)` / `setBookmark(name)` / `getAllBookmarks()` / `deleteBookmark(name)`
- 其他:`focus()` / `blur()` / `print()` / `toggleFullscreen()` / `destroy()`

### 5.2 跨域 postMessage(通用)

不配反代时用 postMessage。协议格式:

**请求(业务前端 → iframe)**:
```js
iframe.contentWindow.postMessage({
  type: '<method>',
  id: '<reqId>',       // 用于匹配响应
  ...args
}, 'http://editor-host:9999')   // 引擎域名,dev 可用 '*'
```

**响应(iframe → 业务前端)**:
```js
window.addEventListener('message', (e) => {
  // 建议:e.origin 校验为引擎域名
  if (e.data.type === '<method>:result' && e.data.id === '<reqId>') {
    console.log('结果:', e.data.data)
  }
})
```

**标准方法列表**:

| type | 参数 | 响应 data | 说明 |
|---|---|---|---|
| `getContent` | `{format:'html'\|'text'\|'json'}` | 内容 | 取文档 |
| `setContent` | `{content}` | `{ok:true}` | 替换内容 |
| `insertContent` | `{content}` | `{ok:true}` | 插入 |
| `getHTML` / `getJSON` / `getText` | 无 | 内容 | 快捷取 |
| `getImage` | `{format:'blob'\|'png'\|'jpeg'}` | ArrayBuffer | 截图 |
| `setReadOnly` | `{readOnly}` | `{ok:true}` | 切只读 |
| `focusBookmark` | `{name}` | `{ok:true}` | 定位书签 |
| `print` | 无 | 无 | 打印 |
| `focus` / `blur` | 无 | `{ok:true}` | 焦点 |

**示例:跨域取内容**:
```js
const reqId = 'r1'
iframe.contentWindow.postMessage(
  { type: 'getContent', format: 'html', id: reqId },
  'http://editor-host:9999'
)
window.addEventListener('message', (e) => {
  if (e.data.type === 'getContent:result' && e.data.id === reqId) {
    console.log('文档 HTML:', e.data.data)
  }
})
```

### 5.3 跨域硬限制(必须知晓)

- **拿不到 Tiptap/ProseMirror 底层实例**:跨域不可克隆函数引用,只能用封装好的方法。深度定制(自定义扩展、直接 dispatch transaction)需走同源直调
- **拖拽跨域**:从父页面拖元素进 iframe,drop 事件不跨 frame。需父页面拦截 drop → 提取数据 → postMessage → iframe内 insertContent
- **高频事件**:`changed`(每次按键)等事件可由 iframe 推出,但需节流(建议 100ms)

---

## 六、第五步:导出与文件回传(方案 B3)

### 6.1 场景

用户在业务系统点「导出 Word」,业务后端需要拿到导出的 docx 文件(存对象存储 / 转存 / 打包等)。

### 6.2 方案 B3:编辑器直接把文件推给业务后端

**流程**:
```
1. 业务前端 → iframe: { type:'export', format:'docx', title:'文档标题', callbackUrl:'https://biz/api/receive-doc', apiKey:'<业务后端鉴权key>', id:'r1' }

2. iframe 内:
   - html = editor.getVanillaHTML()        // 高保真(前端已渲染)
   - blob = await convert-server 转 docx
   - POST blob 到 callbackUrl              // 直接推给业务后端（header: x-api-key）
   - postMessage 回前端: { type:'export:result', id:'r1', ok:true, url:'<业务后端返回的URL>' }

3. 业务后端 /api/receive-doc:
   - 收到文件,存对象存储
   - 返回 { url: 'https://biz/files/xxx.docx' }

4. 业务前端拿到 url,展示下载链接
```

### 6.3 业务前端代码

```js
// 触发导出
async function exportDocx(docId, title) {
  const reqId = 'export-' + Date.now()

  iframe.contentWindow.postMessage({
    type: 'export',
    format: 'docx',
    title,
    callbackUrl: `https://biz.your-domain.com/api/receive-doc`,  // 业务后端接收接口
    apiKey: process.env.BIZ_RECEIVE_KEY,                          // 可选：业务后端鉴权 key（iframe 会以 x-api-key header 透传）
    id: reqId
  }, 'http://editor-host:9999')

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
```

### 6.4 业务后端接收接口

```js
// 业务后端:接收导出的 docx
app.post('/api/receive-doc', upload.single('file'), async (req, res) => {
  // 1. 校验(建议带 API Key,防止伪造；iframe 会以 x-api-key header 透传 apiKey 参数)
  if (req.headers['x-api-key'] !== process.env.BIZ_RECEIVE_KEY) {
    return res.status(401).json({ error: '未授权' })
  }

  // 2. 存对象存储(OSS/S3/MinIO/本地)
  const file = req.file   // multer 接收的文件
  const url = await uploadToOss(file)

  // 3. 返回文件 URL(会回传给前端展示下载链接)
  res.json({ url })
})
```

### 6.5 为什么是「推」不是「取」

前端 iframe 生成的 docx 是 Blob(浏览器内存对象),**没有网络地址**。`URL.createObjectURL(blob)` 生成的是 `blob:http://...` 伪 URL,**只在生成它的浏览器进程内有效**,业务后端(服务器上)访问不到。

所以不能让业务后端「凭地址去取」,必须由 iframe **直接把文件 POST 推给业务后端**。这与 OnlyOffice 的 callbackUrl 机制本质一致。

### 6.6 高保真保证

方案 B3 走「路径①」:用户已打开编辑器,文档已渲染成 DOM(图表/公式/视频都在),`getVanillaHTML()` 处理后转 docx,**所见即所得**,保真度极高。

---

## 七、可选:nginx 同域反代(强交互)

### 7.1 为什么要反代

同源直调能力最强(同步、可传对象、可拿 Tiptap 实例)。通过 nginx 把引擎反代到业务系统的同域子路径,iframe 与父页面同源,即可走直调。

### 7.2 nginx 配置(业务系统侧)

```nginx
# 业务系统 nginx
# WebSocket 升级映射(协同是长连接,必须)
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
        proxy_pass http://editor-host:9999/;    # 注意末尾 /,去掉前缀
        proxy_http_version 1.1;

        # WebSocket 必需(协同长连接)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;

        # 长连接超时调大(默认 60s 会断开空闲 WS)
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        # 文件导出可能较大
        client_max_body_size 20m;
    }
}
```

反代后:
- iframe URL 变成 `/editor/embed?doc=xxx&token=xxx`(同域)
- 协同 WS、convert、token 接口都走 `/editor/` 前缀,引擎会自动感知

### 7.3 反代后的用法

```js
// iframe 用同域地址
iframe.src = `/editor/embed?doc=${docId}&token=${token}`

iframe.onload = () => {
  const editor = iframe.contentWindow.__UMO_EDITOR__   // 同源,直接拿
  const html = editor.getHTML()                        // 同步
}
```

---

## 八、可选:后端读文档(列表摘要/检索,二阶段)

### 8.1 场景

业务系统需要在**用户未打开编辑器**时读取文档内容:
- 文档列表显示每篇的前 100 字摘要
- 全文检索建索引
- 后台批量统计字数

### 8.2 read-server 接口(引擎二阶段提供)

```bash
# 纯文本摘要
curl http://editor-host:9999/api/doc/<docId>/excerpt?limit=100

# 完整 HTML(基础节点)
curl http://editor-host:9999/api/doc/<docId>/html

# ProseMirror JSON
curl http://editor-host:9999/api/doc/<docId>/json

# 纯文本
curl http://editor-host:9999/api/doc/<docId>/text
```

业务后端直接调,不需要 JWT(建议加内网/API Key 校验)。

### 8.3 保真度边界(重要)

read-server 在 Node 无 DOM 环境下渲染,**复杂节点会降级**:
- ✅ 基础节点(段落/标题/表格/列表):正常渲染
- ⚠️ Echarts 图表、视频、音频、代码块高亮、数学公式:占位或空壳
- ⚠️ 图片:base64 和外链保留,样式可能丢

**所以 read-server 只用于「够用就行」的离线读取(摘要/检索/统计),不用于高保真导出。高保真导出必须走第五节的前端路径(用户在线时)。**

---

## 九、完整接入示例

### 9.1 最小可用集成(跨域 + postMessage)

```html
<!-- 业务前端页面 -->
<iframe id="editor" width="100%" height="800"></iframe>
<button onclick="exportDocx()">导出 Word</button>

<script>
const iframe = document.getElementById('editor')

// 1. 打开文档:先拿 token,再设 iframe src
async function openDoc(docId) {
  const { token, role } = await fetch(`/my-doc-token?doc=${docId}`).then(r => r.json())
  const mode = role === 'viewer' ? 'view' : 'edit'
  iframe.src = `http://editor-host:9999/embed?doc=${docId}&token=${token}&mode=${mode}`
}

// 2. 导出:postMessage 触发,文件推给业务后端
async function exportDocx() {
  const reqId = 'exp-' + Date.now()
  iframe.contentWindow.postMessage({
    type: 'export',
    format: 'docx',
    title: '我的文档',
    callbackUrl: 'https://biz.your-domain.com/api/receive-doc',
    id: reqId
  }, 'http://editor-host:9999')
}

// 3. 监听导出结果
window.addEventListener('message', (e) => {
  if (e.data.type === 'export:result') {
    if (e.data.ok) alert('导出成功,下载链接:' + e.data.url)
    else alert('导出失败:' + e.data.error)
  }
})

openDoc('doc-123')
</script>
```

### 9.2 强交互集成(同源 + 直调)

```html
<iframe id="editor" src="/editor/embed?doc=123&token=xxx" width="100%" height="800"></iframe>
<script>
const iframe = document.getElementById('editor')
iframe.onload = () => {
  const editor = iframe.contentWindow.__UMO_EDITOR__

  // 同步拿内容
  console.log(editor.getHTML())

  // 同步插入
  editor.setContent('<p>hello</p>')

  // 导出(仍走方案 B3,因为是跨进程回传)
  // ...或直接调 editor.getVanillaHTML() 自己 POST 给业务后端
}
</script>
```

---

## 十、FAQ

### Q1: iframe 跨域了,还能和编辑器交互吗?
能。跨域用 postMessage(异步请求/响应),能力覆盖大部分操作(取内容/插入/导出/只读切换/书签)。限制:拿不到 Tiptap 底层实例、拖拽体验打折。条件允许建议配 nginx 反代走同源直调。

### Q2: 为什么导出不能让后端直接凭地址下载?
前端生成的 docx 是 Blob(浏览器内存),`URL.createObjectURL` 生成的是伪 URL,只在浏览器进程内有效,后端访问不到。必须由 iframe 把文件 POST 推给业务后端(方案 B3)。

### Q3: token 过期了怎么办?
JWT 默认 24h 过期。业务前端在 iframe 加载前检查有效期,临近过期重新调业务后端换 token。协同断开时(`onAuthenticationFailed`)重新走「换 token → 重设 src」。

### Q4: 能不能不用 iframe,直接把编辑器组件嵌入我的 Vue 项目?
可以,但那是「组件库集成」模式(引 npm 包 + 自己编排 Yjs provider),不是本指南的「私有化引擎」模式。前者集成成本高(要装 yjs/@hocuspocus/provider 等 + 处理版本对齐),适合技术栈一致且愿意维护协同运行时的项目。本指南的 iframe 模式适合跨技术栈、低耦合集成。详见 `COLLAB_HANDOFF.md` 的 client-example。

### Q5: 协同的 WebSocket 总是断开?
通常是 nginx 的 `proxy_read_timeout` 默认 60s 断开了空闲长连接。按第七节的 nginx 配置设 `proxy_read_timeout 86400s`。

### Q6: 如何做高保真导出?
**必须走前端路径**(用户打开文档时)。编辑器已渲染好 DOM,`getImage()` 截图或 `getVanillaHTML()→docx` 都是所见即所得。后端无头导出(read-server)只适合批量/离线场景,保真度低。

### Q7: 引擎镜像里为什么没有文档列表/登录页?哪里有完整示例?
因为文档列表、登录、权限管理是**业务系统自己的职责**,引擎只管「编辑这一篇文档时的实时协同」。引擎默认入口是 `/embed`(纯编辑器)。

完整示例在仓库的 `demo/` 目录,是一个**瘦客户端源码**(不打包镜像):演示业务系统如何用 iframe 接引擎,含登录/列表/编辑器页 + 四类交互演示(同源直调、postMessage、导出回传、鉴权对接)。先启动引擎镜像,再启动示例后端 + 前端(`npm install && npm run dev`),即可看到完整接入流程,示例代码可直接照抄。详见 `demo/README.md` 与 `EMBED_DEPLOYMENT_PLAN.md` 第九节。

---

## 接入决策树

```
你的业务系统技术栈是 Vue3,且愿意维护协同运行时?
├─ 是 → 考虑组件库集成(npm 包模式,见 COLLAB_HANDOFF.md)
└─ 否 → 用本指南的 iframe 集成
        │
        能配 nginx 反代吗?
        ├─ 能 → 同源直调(强交互,推荐)
        └─ 不能 → 跨域 postMessage(通用)
                 │
                 需要后端读文档(列表/检索)?
                 ├─ 需要 → 启用 read-server(二阶段)
                 └─ 不需要 → 仅前端交互即可
```
