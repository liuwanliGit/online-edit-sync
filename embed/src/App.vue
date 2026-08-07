<template>
  <div class="embed-page">
    <!-- 鉴权/连接错误 -->
    <div v-if="errorMsg" class="embed-state embed-state-error">
      <p>{{ errorMsg }}</p>
    </div>
    <!-- 连接中 -->
    <div v-else-if="!editorReady" class="embed-state embed-state-loading">
      <p>{{ loadingText }}</p>
    </div>
    <!-- 编辑器（协同 synced 后挂载） -->
    <umo-editor
      v-else
      ref="editorRef"
      v-bind="editorOptions"
      @created="onEditorCreated"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'

// 协同运行时（embed 唯一模式就是协同，直接静态 import；dedupe 保证与编辑器内部用同一实例）
import { HocuspocusProvider } from '@hocuspocus/provider'
import { Collaboration } from '@tiptap/extension-collaboration'
import { Extension } from '@tiptap/core'
import { yCursorPlugin } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

// ============ URL 参数契约 ============
// GET /embed?doc=<docId>&token=<jwt>&mode=<edit|view>&lang=<zh-CN|en-US>&title=<文档标题>
const urlParams = new URLSearchParams(window.location.search)
const docId = urlParams.get('doc')
const token = urlParams.get('token') || ''
const mode = urlParams.get('mode') === 'view' ? 'view' : 'edit'
const lang = urlParams.get('lang') === 'en-US' ? 'en-US' : 'zh-CN'
const docTitle = urlParams.get('title') || ''

// ============ 状态 ============
const editorRef = ref(null)
const editorReady = ref(false)
const errorMsg = ref('')
const loadingText = ref('正在连接协同服务…')

// 用 shallowRef 持有 Yjs/Hocuspocus 实例，避免被 Vue 深度代理
const ydocRef = shallowRef(null)
const providerRef = shallowRef(null)
const collabExtensions = ref([])

// ============ 暴露编辑器到 window（同源父页面可同步直调） ============
// 同源场景：父页面 iframe.contentWindow.__UMO_EDITOR__.getHTML() 同步取值
// 跨域场景：走 postMessage 协议（见下方 handleMessage）
watch(
  () => editorRef.value,
  (e) => {
    if (e) {
      window.__UMO_EDITOR__ = e
    }
  },
  { immediate: true },
)

// ============ 协同服务地址（embed 由引擎 nginx 提供服务，同源） ============
function getCollabWsUrl() {
  // 引擎 nginx 把 /collab 反代到 collab-server(:4000)，WS 与 HTTP token 共用此前缀
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/collab`
}

// ============ 协作者光标颜色池 ============
const COLLAB_COLORS = [
  '#e06c75', '#56b6c2', '#c678dd', '#61afef',
  '#98c379', '#e5c07b', '#d19a66', '#ff6b6b',
]

// ============ 从 JWT 解析用户信息（服务端已校验，这里只读 claims 用于 awareness 显示） ============
function decodeJwtPayload(jwt) {
  try {
    const part = jwt.split('.')[1]
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return {}
  }
}

// ============ 编辑器配置 ============
const editorOptions = computed(() => ({
  editorKey: `embed-${docId}`,
  locale: lang,
  height: '100%',
  document: {
    // 协同模式内容来自 Y.Doc，不要用本地内容覆盖
    content: '',
    title: docTitle,
    readOnly: mode === 'view',
    autofocus: mode !== 'view',
    enableMarkdown: true,
    autoSave: { enabled: true, interval: 30000 },
  },
  toolbar: {
    defaultMode: 'ribbon',
    showSaveLabel: true,
  },
  page: {
    layouts: ['page', 'web'],
  },
  // 协同模式：内容由 Yjs 驱动，禁用 UndoRedo（改用 Yjs 撤销栈），注入协同扩展
  disableExtensions: ['undoRedo'],
  extensions: collabExtensions.value,
  // 协同模式内容由服务端持久化，点保存给个提示即可
  onSave: async () => '已由服务端实时保存',
  // 工具栏「导出 Word」按钮：调 convert-server 转 docx 后直接触发浏览器下载
  // （区别于 postMessage export 协议：后者把文件 POST 推给业务后端 callbackUrl）
  onExportDocx: async (html, name) => {
    const convertRes = await fetch('/api/convert/docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, title: name || '文档' }),
    })
    if (!convertRes.ok) {
      const errData = await convertRes.json().catch(() => ({}))
      throw new Error(errData.error || `转换失败 (${convertRes.status})`)
    }
    const blob = await convertRes.blob()
    // 触发浏览器下载
    const safeName = (name || '文档').replace(/[\\/:*?"<>|]/g, '_')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}.docx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
  // 文件上传：转 base64 写入 Yjs 文档（不依赖外部上传服务）
  onFileUpload: async (file) => {
    if (!file) throw new Error('没有找到要上传的文件')
    const base64 = await fileToBase64(file)
    return {
      id: `file-${Date.now()}`,
      url: base64,
      name: file.name,
      type: file.type,
      size: file.size,
    }
  },
  onFileDelete: () => {},
}))

function onEditorCreated() {
  if (mode === 'view') {
    editorRef.value?.setReadOnly?.(true)
  }
  // 强制设置文档标题：document 状态会被 localStorage 缓存（useStorage），
  // 首次写入后 title 不再随 options 更新，所以每次创建后主动覆盖为 URL 传入的标题
  if (docTitle) {
    editorRef.value?.setDocument?.({ title: docTitle })
  }
  // 通知父页面编辑器已就绪（跨域场景父页面据此知道可发 postMessage）
  postToParent({ type: 'ready', doc: docId })
}

// ============ 协同模式：建立 Yjs + HocuspocusProvider ============
async function setupCollab() {
  if (!docId) {
    errorMsg.value = '缺少 doc 参数'
    return
  }
  if (!token) {
    errorMsg.value = '缺少 token 参数（应由业务后端签发后放进 iframe URL）'
    return
  }

  // 建立 Yjs 文档（协同运行时已在顶部静态 import）
  const ydoc = new Y.Doc()
  ydocRef.value = ydoc

  // 从 JWT 取用户名（业务后端签发时写入 name claim）
  const payload = decodeJwtPayload(token)
  const userName = payload.name || `用户-${Math.floor(Math.random() * 1000)}`
  const collabUser = {
    name: userName,
    color: COLLAB_COLORS[Math.floor(Math.random() * COLLAB_COLORS.length)],
  }

  const provider = new HocuspocusProvider({
    url: getCollabWsUrl(),
    name: String(docId), // documentName = 业务系统文档 id
    document: ydoc,
    flushDelay: 80,
    // token 直接从 URL 取（业务后端已签好），不再 fetch /api/token
    token,
    onSynced() {
      editorReady.value = true
    },
    onAuthenticationFailed({ reason }) {
      errorMsg.value = `协同鉴权失败：${reason || '未知原因'}`
    },
    onAwarenessChange({ states }) {
      // 可选：把协作者列表暴露给父页面
      postToParent({
        type: 'awareness',
        collaborators: states.map((s) => s?.user).filter(Boolean),
      })
    },
    onAwarenessUpdate({ states }) {
      postToParent({
        type: 'awareness',
        collaborators: states.map((s) => s?.user).filter(Boolean),
      })
    },
  })
  providerRef.value = provider
  provider.setAwarenessField('user', collabUser)

  // 兜底：连接已同步过（onSynced 在极端情况下可能错过）
  if (provider.synced) {
    editorReady.value = true
  }

  // 预填空段落，修复 y-prosemirror 初始竞争（Umo schema 是 block+）
  const fragment = ydoc.getXmlFragment('default')
  if (fragment.length === 0) {
    const para = new Y.XmlElement('paragraph')
    fragment.push([para])
  }

  collabExtensions.value = [
    Collaboration.configure({ document: ydoc }),
    Extension.create({
      name: 'collaborationCursor',
      addProseMirrorPlugins() {
        return [yCursorPlugin(provider.awareness)]
      },
    }),
  ]
}

// ============ postMessage 交互协议（跨域场景） ============
// 请求（父页面 → iframe）：{ type, id, ...args }
// 响应（iframe → 父页面）：{ type: '<type>:result', id, ok, data }
function postToParent(msg) {
  // 用 * 兜底：dev 环境父页面可能是任意源；生产建议父页面配 nginx 反代走同源直调
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(msg, '*')
  }
}

function respond(source, origin, msg) {
  // 响应只发给请求来源，targetOrigin 用请求方的 origin（更安全）
  if (source) {
    try {
      source.postMessage(msg, origin)
    } catch {
      // origin 非法时兜底（极少数情况）
      source.postMessage(msg, '*')
    }
  }
}

// 标准方法分发（同步返回或返回 Promise）
function dispatchMethod(type, args) {
  const editor = editorRef.value
  if (!editor) {
    throw new Error('editor is not ready')
  }
  switch (type) {
    case 'getContent':
      return editor.getContent(args.format)
    case 'setContent':
      editor.setContent(args.content)
      return { ok: true }
    case 'insertContent':
      editor.insertContent(args.content)
      return { ok: true }
    case 'getHTML':
      return editor.getHTML()
    case 'getJSON':
      return editor.getJSON()
    case 'getText':
      return editor.getText()
    case 'getImage':
      return editor.getImage(args.format) // Promise<Blob>
    case 'setReadOnly':
      editor.setReadOnly(args.readOnly)
      return { ok: true }
    case 'focusBookmark':
      return { ok: !!editor.focusBookmark(args.name) }
    case 'setBookmark':
      return { ok: !!editor.setBookmark(args.name) }
    case 'getAllBookmarks':
      return editor.getAllBookmarks()
    case 'print':
      editor.print()
      return { ok: true }
    case 'focus':
      editor.focus()
      return { ok: true }
    case 'blur':
      editor.blur()
      return { ok: true }
    default:
      return null // 未知方法
  }
}

function handleMessage(event) {
  const { data, source, origin } = event
  if (!data || typeof data.type !== 'string') return

  // export 是异步的特殊流程（方案 B3：文件回传业务后端）
  if (data.type === 'export') {
    handleExport(data, source, origin)
    return
  }

  const requestId = data.id
  try {
    const result = dispatchMethod(data.type, data)
    if (result === null) {
      // 未知方法，不响应
      return
    }
    // 兼容同步/Promise 返回值
    Promise.resolve(result).then(
      (value) => {
        respond(source, origin, {
          type: `${data.type}:result`,
          id: requestId,
          ok: true,
          data: value,
        })
      },
      (err) => {
        respond(source, origin, {
          type: `${data.type}:result`,
          id: requestId,
          ok: false,
          error: err?.message || String(err),
        })
      },
    )
  } catch (err) {
    respond(source, origin, {
      type: `${data.type}:result`,
      id: requestId,
      ok: false,
      error: err?.message || String(err),
    })
  }
}

// ============ 方案 B3：导出 docx 并直接推给业务后端 callbackUrl ============
async function handleExport(data, source, origin) {
  const requestId = data.id
  const editor = editorRef.value
  try {
    if (!editor) throw new Error('editor is not ready')

    // 1. 取处理后的高保真 HTML（前端已渲染，图表/公式/视频都在 DOM）
    const html = await editor.getVanillaHTML()

    // 2. 调 convert-server 转 docx（embed 与引擎同源，走相对路径 /api/convert/docx）
    const convertRes = await fetch('/api/convert/docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, title: data.title || '文档' }),
    })
    if (!convertRes.ok) {
      const errData = await convertRes.json().catch(() => ({}))
      throw new Error(errData.error || `转换失败 (${convertRes.status})`)
    }
    const blob = await convertRes.blob()

    // 3. 把 docx 文件直接 POST 推给业务后端 callbackUrl（方案 B3 核心）
    const formData = new FormData()
    formData.append(
      'file',
      blob,
      `${(data.title || 'document').replace(/[\\/:*?"<>|]/g, '_')}.docx`,
    )
    // 透传业务后端鉴权头（如 x-biz-key），由父页面在请求里指定
    const headers = {}
    if (data.apiKey) headers['x-api-key'] = data.apiKey
    if (data.headers && typeof data.headers === 'object') {
      Object.assign(headers, data.headers)
    }
    // 注意：FormData 请求不要手动设 Content-Type，浏览器自动带 boundary
    const cbRes = await fetch(data.callbackUrl, {
      method: 'POST',
      body: formData,
      headers,
    })
    const cbData = await cbRes.json().catch(() => ({}))
    if (!cbRes.ok) {
      throw new Error(cbData.error || `回传失败 (${cbRes.status})`)
    }

    // 4. postMessage 回业务前端：业务后端返回的存储 URL
    respond(source, origin, {
      type: 'export:result',
      id: requestId,
      ok: true,
      url: cbData.url,
      data: cbData,
    })
  } catch (err) {
    respond(source, origin, {
      type: 'export:result',
      id: requestId,
      ok: false,
      error: err?.message || String(err),
    })
  }
}

// ============ 工具：File → base64 Data URL ============
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

// ============ 生命周期 ============
onMounted(() => {
  setupCollab()
  window.addEventListener('message', handleMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', handleMessage)
  if (providerRef.value) providerRef.value.destroy()
  if (ydocRef.value) ydocRef.value.destroy()
  if (window.__UMO_EDITOR__ === editorRef.value) {
    delete window.__UMO_EDITOR__
  }
})
</script>

<style>
html,
body {
  margin: 0;
  padding: 0;
  height: 100vh;
  overflow: hidden;
}
.embed-page {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
.embed-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 14px;
  text-align: center;
  padding: 24px;
}
.embed-state-loading {
  color: #86909c;
}
.embed-state-error {
  color: #ef3f35;
  flex-direction: column;
  gap: 8px;
}
</style>
