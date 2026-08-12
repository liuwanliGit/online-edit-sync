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
    <!-- 配置加载中（等待父页面 postMessage 下发业务配置） -->
    <div v-else-if="!configReady" class="embed-state embed-state-loading">
      <p>正在加载编辑器配置…</p>
    </div>
    <!-- 编辑器（协同 synced + 配置就绪后挂载） -->
    <div v-else class="embed-editor-wrap">
      <umo-editor
        ref="editorRef"
        v-bind="editorOptions"
        @created="onEditorCreated"
      >
      </umo-editor>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, provide, ref, shallowRef, watch } from 'vue'

// 协同运行时（embed 唯一模式就是协同，直接静态 import；dedupe 保证与编辑器内部用同一实例）
import { HocuspocusProvider } from '@hocuspocus/provider'
import { Collaboration } from '@tiptap/extension-collaboration'
import { Extension } from '@tiptap/core'
import { yCursorPlugin } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

// 子路径前缀推导：引擎被外层 nginx 反代到子路径时，WS/convert 请求需带前缀
import { withBasePath } from './utils/base-path'

// ============ URL 参数契约 ============
// GET /embed?doc=<docId>&token=<jwt>&mode=<edit|view|comment>&lang=<zh-CN|en-US>&title=<文档标题>
//   mode=edit     编辑者（可改文档内容 + 评论）
//   mode=view     纯只读（不可评论）
//   mode=comment  评论者（不可改文档内容，但可评论；评论的 comment mark 由服务端代写）
const urlParams = new URLSearchParams(window.location.search)
const docId = urlParams.get('doc')
const token = urlParams.get('token') || ''
const modeParam = urlParams.get('mode')
const mode = ['edit', 'view', 'comment'].includes(modeParam) ? modeParam : 'edit'
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

// 父页面通过 postMessage 下发的业务配置（模板/用户目录/书签显示/分享与 CDN 地址等）。
// embed 挂载时向父页面 request-config，父页面回传 { type:'config', payload } 后再挂载编辑器，
// 使这些功能由业务系统控制，URL 不承载配置（无长度限制）。
const parentConfig = ref({})
const configReady = ref(false)

// 在线协作者列表（由 awareness 变化填充），provide 给状态栏头像组消费
// （与 src/app.vue 一致：statusbar 通过 inject('collaborators') 取值）
const collaborators = ref([])
provide('collaborators', collaborators)

// 当前用户信息（由 JWT 解析，供 awareness 推入）
const collabUserRef = ref({ name: '', color: '#888', role: 'editor', id: '' })

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
  // 引擎 nginx 把 /collab 反代到 collab-server(:4000)，WS 与 HTTP token 共用此前缀。
  // 引擎被外层 nginx 反代到子路径（如 /editor/）时，withBasePath 自动补上子路径前缀。
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${withBasePath('/collab')}`
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
// 业务系统可控项（templates/users/page.showBookmark/shareUrl/cdnUrl）来自父页面
// postMessage 下发的 parentConfig；未下发时用合理默认值，保证功能不被阉割。
const editorOptions = computed(() => {
  const cfg = parentConfig.value
  const opts = {
    editorKey: `embed-${docId}`,
    locale: lang,
    height: '100%',
    document: {
      // 协同模式内容来自 Y.Doc，不要用本地内容覆盖
      content: '',
      title: docTitle,
      // view 和 comment 都禁止编辑文档内容（commenter 的评论能力走单独通道）
      readOnly: mode === 'view' || mode === 'comment',
      autofocus: mode === 'edit',
      enableMarkdown: true,
      autoSave: { enabled: true, interval: 30000 },
      enableBubbleMenu: true,
      // 文档 ID（供引擎内置评论功能使用，与协同 documentName 一致）
      docId,
    },
    toolbar: {
      defaultMode: 'ribbon',
      showSaveLabel: true,
    },
    page: {
      layouts: ['page', 'web'],
      // 书签默认显示（demo 之前漏配导致不可见）；父页面可覆盖
      showBookmark: cfg.page?.showBookmark ?? true,
    },
    // 模板：业务系统维护内容，编辑器只负责插入
    templates: cfg.templates ?? [],
    // @提及用户目录：embed 本地过滤（onMentionSearch 留空，由 users 驱动）
    users: cfg.users ?? [],
    // 协同模式：内容由 Yjs 驱动，禁用 UndoRedo（改用 Yjs 撤销栈），注入协同扩展
    disableExtensions: ['undoRedo'],
    extensions: collabExtensions.value,
    // 当前用户信息（供引擎内置评论功能作为 author 使用；role 供引擎判断 commenter 走代写通道）
    user: {
      id: collabUserRef.value.id,
      name: collabUserRef.value.name,
      color: collabUserRef.value.color,
      role: collabUserRef.value.role,
    },
    // 协同模式内容由服务端持久化，点保存给个提示即可
    onSave: async () => '已由服务端实时保存',
  // 工具栏「导出 Word」按钮：调 convert-server 转 docx 后直接触发浏览器下载
  // （区别于 postMessage export 协议：后者把文件 POST 推给业务后端 callbackUrl）
  onExportDocx: async (html, name) => {
    const convertRes = await fetch(withBasePath('/api/convert/docx'), {
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
  }
  // shareUrl / cdnUrl 仅在父页面显式提供时覆盖编辑器默认值
  if (cfg.shareUrl) opts.shareUrl = cfg.shareUrl
  if (cfg.cdnUrl) opts.cdnUrl = cfg.cdnUrl
  return opts
})

function onEditorCreated() {
  if (mode === 'view' || mode === 'comment') {
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

  // 从 JWT 取用户名与角色（业务后端签发时写入 name / role claim）
  const payload = decodeJwtPayload(token)
  const userName = payload.name || `用户-${Math.floor(Math.random() * 1000)}`
  // role 写进 awareness，供状态栏协作者头像组的角色徽章显示
  // （editor→编辑，commenter→评论，viewer→只读）
  // 优先用 JWT claim 的 role，兜底用 URL mode 推导
  const roleFromClaim = ['editor', 'commenter', 'viewer'].includes(payload.role)
    ? payload.role
    : (mode === 'view' ? 'viewer' : mode === 'comment' ? 'commenter' : 'editor')
  const userRole = roleFromClaim
  collabUserRef.value = {
    id: payload.id || payload.sub || '',
    name: userName,
    color: COLLAB_COLORS[Math.floor(Math.random() * COLLAB_COLORS.length)],
    role: userRole,
  }

  const provider = new HocuspocusProvider({
    url: getCollabWsUrl(),
    name: String(docId), // documentName = 业务系统文档 id
    document: ydoc,
    flushDelay: 80,
    // token 直接从 URL 取（业务后端已签好），不再 fetch /api/token
    token,
    onSynced() {
      // 预填空段落，修复 y-prosemirror 初始竞争（Umo schema 是 block+，ProseMirror 会
      // 强制创建默认空段落，而 Yjs 初始为空，导致 ySyncPlugin 认为"两边一致"不同步）。
      //
      // ⚠️ 必须在 Yjs 首次同步【之后】、编辑器挂载【之前】执行，且仅在同步后的文档确实
      //    为空时才预填。如果在同步前就 push，每次刷新（新 clientID）都会往 Yjs 文档
      //    追加一个空段落，这些段落经 CRDT 合并后永久累积在服务端文档里，导致评论的
      //    {from,to} 偏移、范围塌缩 → 刷新后评论全部显示"原文已删除"。
      //    onSynced 保证此时已拿到服务端权威状态，fragment 为空 = 真正的新文档。
      const frag = ydoc.getXmlFragment('default')
      if (frag.length === 0) {
        const para = new Y.XmlElement('paragraph')
        frag.push([para])
      }
      editorReady.value = true
    },
    onAuthenticationFailed({ reason }) {
      errorMsg.value = `协同鉴权失败：${reason || '未知原因'}`
    },
    // onAwarenessChange / onAwarenessUpdate 二者只留其一（事件语义重叠，重复注册会导致
    // 每次变化触发两次）。awareness states 内部挂着 Yjs 引用，不能直接塞进 postMessage
    // （结构化克隆会抛 DataCloneError）。这里把每个 state 规整成纯对象再使用：
    //   · 保留 clientId（状态栏头像组用它做 :key）和 user 嵌套结构（c.user.name/color/role）
    //   · user 只取基本字段，避免克隆 Yjs/响应式引用
    onAwarenessChange({ states }) {
      const list = states
        .map((s) => {
          const u = s?.user
          if (!u) return null
          return {
            clientId: s.clientId,
            user: {
              id: u.id || '',
              name: u.name || '',
              color: u.color || '',
              role: u.role || 'editor',
            },
          }
        })
        .filter(Boolean)
      // 供状态栏头像组 inject('collaborators') 消费（结构：[{ clientId, user:{...} }]）
      collaborators.value = list
      // 推送给父页面（纯对象，可被 postMessage 结构化克隆）
      postToParent({ type: 'awareness', collaborators: list })
    },
  })
  providerRef.value = provider
  provider.setAwarenessField('user', collabUserRef.value)

  // 兜底：连接已同步过（onSynced 在极端情况下可能错过）
  if (provider.synced) {
    editorReady.value = true
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

  // 父页面下发业务配置（响应 request-config）：合并后置 configReady，放行编辑器挂载
  if (data.type === 'config') {
    parentConfig.value = data.payload || {}
    configReady.value = true
    return
  }

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

    // 2. 调 convert-server 转 docx（embed 与引擎同源，走相对路径，子路径反代自动带前缀）
    const convertRes = await fetch(withBasePath('/api/convert/docx'), {
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
  // 向父页面请求业务配置（模板/用户目录/书签显示/分享/CDN 等）。
  // 父页面回传 { type:'config', payload }，合并进 editorOptions 后挂载编辑器。
  postToParent({ type: 'request-config' })
  // 兜底：父页面未响应（旧版父页面或独立打开 embed）时，3s 后用默认配置放行，避免卡死
  setTimeout(() => {
    if (!configReady.value) configReady.value = true
  }, 3000)
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
.embed-editor-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}
</style>
