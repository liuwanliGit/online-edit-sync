# Umo Editor 私有化交付改造方案

> 本文档是基于架构讨论得出的最终改造方案。目标:把当前的「demo 应用 + 协同引擎焊死的单镜像」改造为「可被任意业务系统通过 iframe 集成的私有化部署引擎」,对标 OnlyOffice Document Server 的交付形态,但保留企业自部署的定位。
>
> 决策来源(已确认):
> - 交付形态:**卖给企业自部署**(非 SaaS 多租户)
> - 引擎镜像:**单镜像**,只含引擎能力(collab/convert/read + /embed 前端),不含 demo
> - 示例(demo):**降级为瘦客户端源码**(不打包镜像),用 iframe 引用引擎 /embed,演示接入方真实要做的事
> - 交互方式:**同源直调 + 跨域 postMessage 两者都支持**
> - 鉴权:**企业后端代理签发 JWT**(`/api/token` 加 API Key 收口)
> - 后端读文档:**是刚需**,新建 read-server(Yjs→HTML 服务端渲染),但可延后到第二阶段
> - 导出回传:**方案 B3**(编辑器直接把导出文件 POST 到业务后端 callbackUrl)
>
> 最后更新:2026-08-06

---

## 一、现状与问题

### 1.1 当前架构(单镜像四进程)

```
docker/ (单镜像, supervisor 托管 4 进程)
├─ nginx           (:9999 入口,反代 + 静态资源)
├─ collab-server   (:4000  Yjs 协同 + JWT + SQLite 持久化)
├─ demo-server     (:4001  文档元数据 REST + 自己的 SQLite)
├─ convert-server  (:4002  HTML→docx)
└─ demo 前端       (静态资源,含登录页/文档列表/编辑器)
```

### 1.2 核心问题:应用与平台焊死

当前镜像把**编辑器引擎能力**(collab-server / convert-server)和**一个具体的业务示例**(demo 前端 + demo-server)物理焊死,导致:

1. **企业接入困惑**:接入协同编辑,被迫装一套文档管理 + 登录页,与自身业务系统重复
2. **数据归属错乱**:demo-server 的 SQLite 存的是示例应用的文档元数据,不是企业业务数据
3. **无嵌入入口**:镜像根路径返回的是 demo 登录页,没有面向 iframe 的纯编辑器视图
4. **鉴权裸奔**:`/api/token` 无任何凭据门槛,谁都能签 JWT(见 `collab-server/server.js` 第 44-63 行)
5. **无后端读文档能力**:collab-server 只搬 Yjs 字节,不解析文档;企业无法在「用户未打开编辑器」时取内容(列表摘要/检索)

### 1.3 决定性约束(必须先认知)

Umo 编辑器的 schema 由 **Tiptap3 + 几十个 Vue 扩展**构建(`src/extensions/index.js`),其中 Echarts/视频/代码块高亮/数学公式等扩展带 `addNodeView`,需要 Vue 运行时 + DOM。这导致:

- **前端导出路径**(用户已打开编辑器):高保真,所见即所得,API 现成
- **后端无头渲染路径**(用户未打开编辑器):只能解析纯数据节点,复杂节点(Echarts/公式)渲染不出真实形态

**这两条路径的能力天差地别,所有方案设计必须区分对待。** 详见第五节。

---

## 二、目标架构(改造后)

### 2.1 引擎镜像(卖给企业的核心产品)

```
umo-editor-engine:latest
├─ nginx           (入口:提供 /embed + 反代 collab/convert/read)
├─ collab-server   (:4000  Yjs 协同 + JWT(API Key 收口) + SQLite)
├─ convert-server  (:4002  HTML→docx + 新增 docId→docx 无头导出[二阶段])
├─ read-server     (:4003  新增:Yjs→HTML 服务端渲染[二阶段])
└─ embed 前端      (/embed 纯编辑器页,无登录/列表外壳)
```

**不含**:demo 前端、demo-server、登录页、文档列表。

### 2.2 示例(瘦客户端源码,不打包镜像)

示例**不再独立打包镜像**,改为一份纯源码(含 README),放在仓库 `demo/` 下。示例的核心特征:

- **示例是「瘦客户端」**:演示「业务系统如何用 iframe 接引擎」,自己**绝不重复实现引擎能力**
- **编辑器页用 iframe 引用引擎的 `/embed`**:示例的编辑器页是 `<iframe src="引擎/embed?doc=&token=">`,**不再自己拼装协同**(删掉 `setupCollab()` 那一整坨 Yjs/Hocuspocus 代码)
- **示例自带一个极轻的文档元数据后端**(几十行 Node + SQLite),只为让示例能跑通「登录→列表→打开文档」,与引擎无关
- **依赖极轻**:删掉后,示例的 `package.json` 不再需要 `@tiptap/*`、`yjs`、`@hocuspocus/provider`、`@umoteam/editor` 这一整套协同运行时(当前 demo 装了 40+ 个这类依赖,全是为 `setupCollab` 服务),体积和心智负担数量级下降

接入方使用方式:`npm install && npm run dev`,配置引擎地址后即可看到完整的接入演示。详见第九节「示例改造」。

### 2.3 Dockerfile 策略(单镜像,只产引擎)

不再产出双镜像。Dockerfile 只构建**引擎镜像**一个产物:

```dockerfile
# 公共阶段:构建编辑器库 + embed 前端
FROM ... AS editor-builder   # 现有,构建编辑器库 dist/
FROM ... AS embed-builder    # 新增:构建 /embed 纯编辑器页(引用上层 dist)

# 唯一产物:引擎镜像
FROM ... AS engine
COPY collab-server convert-server read-server   # 引擎能力
COPY --from=embed-builder /dist /app/public     # embed 前端
# supervisor 管 nginx + collab + convert + read(不再有 demo-server)
```

构建命令:
```bash
docker build -t umo-editor-engine:latest .    # 唯一产物:引擎
```

示例(demo/)作为仓库源码保留,不进 Dockerfile,不产镜像。

---

## 三、改造清单(按阶段与优先级)

### 第一阶段(企业可完整接入 + 编辑 + 导出)

| # | 改造项 | 优先级 | 说明 |
|---|---|---|---|
| 1 | Dockerfile 改为单镜像(引擎),剥离 demo | 高 | 见 2.3 |
| 2 | 新建 `/embed` 入口 + `window.__UMO_EDITOR__` 暴露 | 高 | 见第四节 |
| 3 | postMessage 交互协议(getContent/insertContent/export 等) | 高 | 见第六节 |
| 4 | `/api/token` 加 API Key 收口 | 高 | 见第七节 |
| 5 | demo 改造为瘦客户端示例(iframe 引用 /embed,删协同运行时) | 高 | 见第九节 |
| 6 | 接入文档 | 高 | 见 EMBED_INTEGRATION_GUIDE.md |

**第一阶段完成后,企业就能跑通:部署引擎 → iframe 嵌入 → 编辑 → 高保真导出(方案 B3 回传业务后端)的完整闭环。**

### 第二阶段(文档管理类能力)

| # | 改造项 | 优先级 | 说明 |
|---|---|---|---|
| 7 | read-server(Yjs→HTML 服务端渲染) | 中 | 见第八节,服务列表摘要/检索/离线统计 |
| 8 | convert-server 加 docId 入口(无头导出) | 中 | 依赖 #7 |

**第二阶段服务「不依赖用户在线」的场景:列表摘要、全文检索、后台批量统计。导出等高保真需求已在第一阶段由前端路径覆盖,不依赖第二阶段。**

---

## 四、`/embed` 入口设计

### 4.1 职责

提供一个**面向 iframe 的纯编辑器视图**,不含 demo 外壳(无登录、无文档列表、无 topbar)。这是企业业务系统 iframe 的着陆页。

### 4.2 URL 契约

```
GET /embed?doc=<docId>&token=<jwt>&mode=<edit|view>&lang=<zh-CN|en-US>
```

- `doc`:HocuspocusProvider 的 documentName(企业业务系统的文档唯一 id)
- `token`:由企业后端签发的 JWT(不再前端调 /api/token)
- `mode`:`view` → `setReadOnly(true)`
- `lang`:界面语言

### 4.3 页面内容(基于现有代码改造)

参照 `demo/src/views/EditorView.vue` 的 `setupCollab()`(443-515 行)成熟实现,**剥离** demo 特有的:
- topbar、只读 banner、文档不存在态、工具栏人员信息注入(`injectToolbarInfo` 那一坨)

**保留**:
- `setupCollab()` 的核心:Y.Doc + HocuspocusProvider + 预填空段落(修 y-prosemirror 初始竞争)+ Collaboration 扩展 + 远程光标扩展 + `disableExtensions:['undoRedo']`
- 构造函数回调注册事件(`onSynced`/`onAuthenticationFailed`/`onAwarenessChange`)
- `v-if="editorReady"` 等同步后挂载

### 4.4 关键胶水层:暴露编辑器到 window

```js
// /embed 页面
const editorRef = ref(null)
watch(() => editorRef.value, (e) => {
  if (e) window.__UMO_EDITOR__ = e   // 同源父页面可直接 iframe.contentWindow.__UMO_EDITOR__
}, { immediate: true })
```

`defineExpose` 出的方法全集见 `src/components/index.vue` 第 1375-1435 行(getHTML/getJSON/setContent/insertContent/getImage/getVanillaHTML/setReadOnly/focusBookmark 等)。同源场景下父页面可同步直接调这些方法。

### 4.5 与 demo 的差异

| 项 | /embed(新) | demo EditorView(现有) |
|---|---|---|
| 登录态 | 无,token 从 URL 参数取 | 走 demo 自己的 auth store(localStorage) |
| 文档元数据 | 不取,标题由 URL 或 token 传 | 调 demo-server REST |
| 外壳 | 纯编辑器,全屏 | topbar + 只读 banner + 文档不存在态 |
| 工具栏人员注入 | 不做(demo 特有的 DOM 注入逻辑) | 做(injectToolbarInfo) |
| onSave | 由 postMessage 协议决定 | demo localStorage 或协同跳过 |

---

## 五、导出的两条路径(核心认知,务必区分)

### 5.1 路径①:前端已渲染 → 业务系统通过前端发起导出(高保真,第一阶段)

```
用户在业务系统打开文档 → iframe 内编辑器把文档渲染好(图表/视频/公式都在 DOM)
  ↓ 业务前端调 iframe.contentWindow.__UMO_EDITOR__.getImage() / getVanillaHTML()
  ↓ getVanillaHTML 处理后的 HTML → convert-server 转 docx
拿到 PNG / docx,通过方案 B3 回传业务后端
```

**特点**:
- 走 `src/components/index.vue` 现成的 `getImage()`(第 906 行)和 `getVanillaHTML()`(第 931 行)
- 保真度极高:所有 `addNodeView` 的复杂节点已渲染成真实 DOM
- **不碰 read-server 的 schema 边界**
- 依赖用户在线(文档必须已打开)

**结论:导出这种高保真需求,永远走路径①,第一阶段即可覆盖。**

### 5.2 路径②:后端不打开编辑器 → 直接读文档(低保真,第二阶段)

```
用户没打开文档(文档列表页/后台任务/搜索框)
  ↓ 业务后端调 read-server: GET /api/doc/:id/excerpt
  ↓ read-server 直读 SQLite → applyUpdate → 渲 HTML/文本
```

**特点**:
- 服务「够用就行」的离线读取:列表摘要、全文检索、批量统计
- 复杂节点(Echarts/公式)渲染不出真实形态,但纯文本足够
- 不依赖用户在线

**结论:路径②只服务文档管理类功能,不服务导出。导出走路径①。**

---

## 六、postMessage 交互协议(跨域场景)

### 6.1 协议格式

请求(业务前端 → iframe):
```js
iframe.contentWindow.postMessage({
  type: '<method>',     // getContent / setContent / export / setReadOnly / ...
  id: '<reqId>',        // 用于匹配响应
  ...args               // 方法参数
}, targetOrigin)
```

响应(iframe → 业务前端):
```js
window.addEventListener('message', (e) => {
  if (e.data.type === '<method>:result' && e.data.id === '<reqId>') {
    // e.data.data 是结果
  }
})
```

### 6.2 标准方法(对照 `defineExpose` 清单)

| 方法 | 请求参数 | 响应 data | 说明 |
|---|---|---|---|
| `getContent` | `{format:'html'\|'text'\|'json'}` | 字符串/对象 | 取文档内容 |
| `setContent` | `{content:'<html>'}` | `{ok:true}` | 替换内容 |
| `insertContent` | `{content:'<html>'}` | `{ok:true}` | 在光标处插入 |
| `getImage` | `{format:'blob'\|'png'\|'jpeg'}` | ArrayBuffer(postMessage 可传) | 截图导出 |
| `export` | `{format:'docx', title, callbackUrl}` | 见 6.3(异步回调) | Word 导出 + 回传 |
| `setReadOnly` | `{readOnly:true}` | `{ok:true}` | 切只读 |
| `getHTML` / `getJSON` / `getText` | 无 | 字符串/对象 | 内容快捷取 |
| `focusBookmark` | `{name:'xxx'}` | `{ok:true}` | 书签定位 |
| `setBookmark` | `{name:'xxx'}` | `{ok:true}` | 加书签 |
| `print` | 无 | (触发打印) | |
| `focus` / `blur` | 无 | `{ok:true}` | |

### 6.3 `export` 方法的回传设计(方案 B3)

`export` 是异步的,因为要把生成文件推给业务后端。流程:

```
业务前端 → iframe: { type:'export', format:'docx', title:'文档', callbackUrl:'https://biz/api/receive-doc', id:'r1' }

iframe 内:
  1. html = editorRef.value.getVanillaHTML()
  2. blob = await exportDocx(html, title)        // 调 convert-server
  3. await fetch(callbackUrl, {                   // 直接把文件推给业务后端
       method:'POST',
       body: formData(blob),
       headers:{ 'x-api-key': '<业务后端校验头>' }
     })
  4. postMessage 回业务前端: { type:'export:result', id:'r1', ok:true, url:'<业务后端返回的存储URL>' }
```

**方案 B3 的本质**:不让业务后端「凭地址去取」前端内存里的 Blob(取不到),而是**直接把文件推给业务后端**。业务后端收到文件后自己存对象存储,生成永久 URL,既可直接用也可回传给前端展示「下载链接」。

**为什么不走「回传下载地址让后端取」**:前端 `URL.createObjectURL(blob)` 生成的是 `blob:https://editor-host/xxxx` 伪 URL,**只在生成它的浏览器进程内有效**,业务后端(服务器上)访问不到。这是 postMessage 跨 frame 与「服务端去取」之间的根本矛盾。OnlyOffice 的 callbackUrl 机制本质也是方案 B3 的变体。

### 6.4 高频事件订阅

`@changed`(每次按键)、`@changed:selection` 等事件可由 iframe postMessage 出来,但:
- 高频事件需节流(如 `changed:transaction` 每键触发,跨域 postMessage 开销大)
- 单向通知,业务前端需自己维护状态镜像

### 6.5 跨域硬限制(必须知晓)

- **不能传函数/Tiptap editor 实例**:`getEditor()` 返回的对象带方法和内部状态,结构化克隆会丢方法。跨域只能用 `defineExpose` 封装好的方法
- **拖拽跨域**:从父页面拖元素进 iframe,drop 事件不跨 frame 传递(除非同源)。需父页面拦截 drop → 提取数据 → postMessage → iframe 内 insertContent
- **精确选区同步**:跨域拿不到对方 DOM Range(不可克隆),远程选区靠 awareness 协议在协同层内部跑

---

## 七、鉴权收口:企业后端代理签发

### 7.1 现状问题

`collab-server/server.js` 第 44-63 行的 `/api/token` 无任何凭据校验,任何人传 name/doc/role 就能换 JWT。

### 7.2 改造:加 API Key

```js
// collab-server/server.js onRequest 改造
async onRequest({ request, response }) {
  if (pathname === '/api/token' && request.method === 'GET') {
    // 新增:API Key 校验
    const apiKey = request.headers['x-api-key']
    if (!apiKey || apiKey !== process.env.UMO_API_KEY) {
      response.writeHead(401, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' })
      response.end(JSON.stringify({ error: 'API Key 无效' }))
      throw null
    }
    // 校验通过才签 JWT,claims 的 name/doc/role 由企业后端传
    ...
  }
}
```

镜像启动时配 `UMO_API_KEY=<企业自定义强随机>`,不对外公开。

### 7.3 数据流(改造后)

```
企业业务前端 → 企业业务后端(持有 UMO_API_KEY)
                  ↓ GET /api/token (header: x-api-key, query: name/doc/role)
              collab-server 验 key + 签 JWT
                  ↓ 返回 JWT
企业业务前端 ← 企业业务后端
  ↓ 把 JWT 放进 iframe URL: /embed?doc=xxx&token=<jwt>
```

**企业后端在此决定**:每个用户的角色(editor/viewer)、能否访问该 doc。这是企业业务系统原有的鉴权逻辑,编辑器引擎只「信企业的判断」。

### 7.4 /embed 页面的 token 使用变化

当前 `EditorView.vue` 的 `token: async () => fetch(...)` 逻辑要去掉,改为从 URL 参数读 token,HocuspocusProvider 直接用:

```js
const urlParams = new URLSearchParams(location.search)
const token = urlParams.get('token')   // 企业后端已签好,直接用

const provider = new HocuspocusProvider({
  url: getCollabWsUrl(),
  name: urlParams.get('doc'),
  document: ydoc,
  token,                              // 不再 fetch
  ...
})
```

---

## 八、read-server(Yjs→HTML 服务端渲染,第二阶段)

### 8.1 职责

让企业业务后端在「不打开编辑器」的情况下读取文档内容,服务:
- 文档列表摘要(前 N 字)
- 全文检索建索引
- 后台批量统计/备份

### 8.2 接口设计

```
read-server (:4003)
  GET /api/doc/:id/html     → 基础节点 HTML(纯数据节点)
  GET /api/doc/:id/text     → 纯文本
  GET /api/doc/:id/json     → ProseMirror JSON
  GET /api/doc/:id/excerpt?limit=100  → 前 N 字摘要
```

直读 collab-server 的 SQLite(`loadDoc(id)`),在 Node 里 `new Y.Doc()` + `applyUpdate`,用精简 schema 渲染。

### 8.3 技术边界(重要,必须认知)

Umo schema 由 Tiptap3 + Vue 扩展构建,带 `addNodeView` 的扩展(Echarts/视频/代码块高亮/数学公式)在纯 Node 无 DOM 环境下**渲染不出真实形态**:

- ✅ 能做:paragraph/heading/table/list 等基础节点的 HTML/JSON/文本
- ⚠️ 降级:Echarts 图表、视频、音频、代码块高亮、KaTeX 公式 → 空壳或占位
- ⚠️ 图片:base64 内联和外链 URL 能保留,但 CSS/JS 样式会丢

**结论:read-server 产出的 HTML 不能与编辑器所见 100% 一致,只适用于「够用就行」的离线读取,不适用于高保真导出(高保真导出走路径①)。**

### 8.4 schema 复用策略(实现时第一个要定的点)

两种方案,二选一:
- **精简 schema 副本**:从 `src/extensions/index.js` 抽一个「纯数据 schema」子集(剥离带 addNodeView 的扩展)。保真度高,但要随 Umo 版本维护
- **y-prosemirror 默认遍历**:直接用 y-prosemirror 的 fragment 遍历手写简化渲染器。工作量小,保真度低

**长期维护成本预警**:Umo schema 随版本演进,read-server 的 schema 要同步,否则出现「编辑器能编辑的节点,后端读不出来」偏差。这是私有化交付里长期维护成本最高的一块。

---

## 九、示例改造(demo 降级为瘦客户端源码)

### 9.1 改造目标

当前 `demo/` 是一个**自己拼装协同的全栈应用**(前端装了 40+ 个 @tiptap/yjs/@hocuspocus 依赖,`setupCollab()` 自己实现 Yjs provider)。这与「示例应演示如何接入引擎」的定位相悖——示例展示的是「引擎内部如何实现协同」,而不是「接入方如何使用引擎」。

改造后,示例成为一个**瘦客户端**:演示业务系统如何用 iframe 接引擎,自己**绝不重复实现引擎能力**。

### 9.2 改造前后对比

| 维度 | 改造前(当前 demo) | 改造后(瘦客户端示例) |
|---|---|---|
| 编辑器页实现 | `setupCollab()` 自己拼 Yjs + Hocuspocus + Collaboration 扩展 | `<iframe src="引擎/embed?doc=&token=">`,零协同代码 |
| 协同运行时依赖 | `@tiptap/*`、`yjs`、`@hocuspocus/provider`、`@umoteam/editor` 等 40+ 包 | **全部删除**,只留 Vue + 业务 UI 库 |
| 交互演示 | 无(自己实现编辑) | 同源直调 + postMessage + 导出回传 + 鉴权对接 全套示例 |
| demo-server | 含,且耦合协同 uuid | 保留作轻量元数据示例(与引擎无关) |
| 打包 | 进 Dockerfile 成镜像 | **不打包**,仅源码 + README |
| 定位 | 另一个独立应用 | 接入方参考的瘦客户端 |

### 9.3 具体改造点

**前端(`demo/src/`)**:

1. **`EditorView.vue` 重写**:
   - **删除** `setupCollab()` 整个函数(443-515 行的 Yjs/Hocuspocus 编排)
   - **删除** `collabExtensions`、`ydocRef`、`providerRef`、`collaborators`、`displayUsers`、工具栏人员信息注入(`injectToolbarInfo` 那一坨)
   - **替换为**:一个 `<iframe>`,src 由「调业务后端拿 token → 拼接引擎 /embed URL」得到
   - 新增交互演示区:按钮触发 `iframe.contentWindow.__UMO_EDITOR__.getHTML()`(同源)或 postMessage(跨域),展示结果
   - 新增导出演示:按钮触发 `export` postMessage,文件回传到 demo 的轻后端

2. **`utils/collab-config.js` 保留但改用途**:从「拼 WS/token 地址给 HocuspocusProvider」改为「拼引擎 `/embed` URL 和反代地址」,供 iframe 使用

3. **`utils/api.js` 调整**:导出走引擎 convert-server(经反代或跨域),文档元数据仍走 demo-server

4. **`package.json` 大瘦身**:删除所有 `@tiptap/*`、`yjs`、`@hocuspocus/provider`、`@umoteam/editor`、`@umoteam/editor-external`、`prosemirror-*` 等协同运行时依赖。保留 Vue + TDesign + vue-router + file-saver 等业务 UI 依赖。**依赖数量从 60+ 降到 10 左右**

5. **`vite.config.js` 简化**:删除 `optimizeDeps.exclude`、`resolve.dedupe`(那些是为修协同包双实例问题,iframe 模式下不需要)

**后端(`demo/server/`)**:
- 保留(轻量文档元数据 REST + SQLite),作为「业务系统文档管理」的合理示例
- 新增一个 `/api/receive-doc` 接口,接收方案 B3 的导出文件回传(演示业务后端如何收文件)
- 新增一个 `/api/doc-token` 接口,演示业务后端代理签 JWT(持 `UMO_API_KEY` 调引擎 `/api/token`)

**`demo/README.md` 重写**:说明这是瘦客户端示例,启动步骤含「先启动引擎镜像,再启动示例,配置引擎地址」

### 9.4 示例的引擎地址配置

示例需要一个指向引擎的方式。沿用现有的运行时全局变量模式:

```js
// 示例前端读取引擎地址(不重新构建即可改)
window.__UMO_ENGINE_URL__ = 'http://editor-host:9999'   // 引擎地址
// 反代同源时:window.__UMO_ENGINE_URL__ = '/editor'(走 nginx 子路径)
```

示例的 iframe URL、token 代理调用、导出回传都基于这个地址。

### 9.5 示例的交互演示(对照接入方真实需求)

示例的编辑器页应演示四个核心场景,每个都有可点的按钮 + 结果展示:

1. **同源直调**:演示 `iframe.contentWindow.__UMO_EDITOR__.getHTML()` 同步取内容(需配 nginx 反代,README 说明)
2. **postMessage**:演示跨域 `getContent`/`setContent` 请求/响应
3. **导出回传**:演示方案 B3,点按钮 → 文件推到 demo-server `/api/receive-doc` → 返回下载链接
4. **鉴权对接**:演示 demo-server `/api/doc-token` 代理签 JWT,前端从 demo-server 拿 token(不直接调引擎 `/api/token`)

这四个场景就是 `EMBED_INTEGRATION_GUIDE.md` 里「第五节/第六节」的活样本,接入方照着抄即可。

---

## 十、convert-server 扩展(第二阶段,依赖 read-server)

### 10.1 新增 docId 入口(无头导出)

当前 convert-server 只接受 `{html, title}`(需前端传 HTML)。新增:

```
POST /api/convert/docx-by-id  { docId, title }
  → 内部调 read-server 取 HTML → html-to-docx 转换 → 返回 docx Blob
```

**适用场景**:业务后端定时批量导出、用户未在线时的离线导出。

**保真度警告**:走 read-server 的 HTML,受 8.3 边界限制(复杂节点降级)。若要高保真,必须走路径①(用户在线时前端发起)。所以这个接口主要用于「批量/离线」场景,单文档高保真导出仍由前端路径①覆盖。

---

## 十一、验证清单(改造完成后逐项验证)

### 11.1 第一阶段验证

- [ ] 引擎镜像启动后,根路径返回 /embed(非 demo 登录页)
- [ ] `/embed?doc=test&token=<jwt>&mode=edit` 能挂载编辑器,内容实时同步
- [ ] `/embed?mode=view` 编辑器只读
- [ ] 同源(配 nginx 反代):`iframe.contentWindow.__UMO_EDITOR__.getHTML()` 同步取到内容
- [ ] 跨域:postMessage `getContent` 收到 `getContent:result`
- [ ] 跨域:postMessage `export` 触发方案 B3,业务后端 callbackUrl 收到文件
- [ ] `/api/token` 无 `x-api-key` 返回 401,有正确 key 才签 JWT
- [ ] 示例(瘦客户端)能跑通:启动引擎 → 启动示例 → 登录→列表→iframe 打开编辑器→四类交互演示

### 11.2 第二阶段验证

- [ ] `GET /api/doc/:id/excerpt` 返回纯文本摘要(不依赖用户在线)
- [ ] `POST /api/convert/docx-by-id` 批量导出 docx(基础节点保真)
- [ ] 复杂节点(Echarts/公式)在 read-server 输出里为占位(预期行为,非 bug)

---

## 十二、风险与边界

| 风险 | 影响 | 缓解 |
|---|---|---|
| read-server schema 滞后于 Umo 版本 | 后端读不出新节点 | 纳入版本发布流程,schema 同步检查 |
| 跨域 postMessage 高频事件性能 | `changed:transaction` 每键触发 | 协议层节流(如 100ms 合并) |
| 方案 B3 大文件回调 | 业务后端收大文件压力大 | 限制 docx 大小上限;或切方案 B1(引擎临时存 + 返回 URL) |
| 跨域拿不到 Tiptap 实例 | 业务系统无法自定义扩展 | 文档明确「封装 API 优先」,底层定制需同源 |
| WebSocket 反代超时 | 协同长连接被 nginx 60s 断 | 文档提供 nginx WS 反代配置(含 `proxy_read_timeout 86400s`) |

---

## 十三、实施顺序建议

1. **#4 `/api/token` API Key 收口**(最小,解锁其它,先改 collab-server)
2. **#2 `/embed` 入口 + window 暴露**(基于现有 setupCollab 逻辑剥离,新建成 embed 入口页)
3. **#3 postMessage 协议**(含方案 B3 的 export)
4. **#1 Dockerfile 改为单镜像**(剥离 demo,引擎镜像成型)
5. **#5 demo 改造为瘦客户端**(iframe 引用 /embed,删协同运行时,加四类交互演示)
6. **#6 接入文档**(EMBED_INTEGRATION_GUIDE.md)
7. *(第二阶段)* **#7 read-server** + **#8 convert-server docId 入口**

第一阶段完成后即可交付企业试用,第二阶段按需追加。
