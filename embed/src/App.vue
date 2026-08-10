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
    <!-- 编辑器 + 评论侧栏（协同 synced + 配置就绪后挂载） -->
    <div v-else class="embed-editor-wrap">
      <umo-editor
        ref="editorRef"
        v-bind="editorOptions"
        @created="onEditorCreated"
      >
        <template #bubble_menu>
          <BubbleButton
            :get-editor="safeBubbleGetEditor"
            @add="onBubbleAdd"
          />
        </template>
      </umo-editor>
      <CommentSidebar
        v-if="showCommentSidebar"
        :comments="comments"
        :active-comment-id="activeCommentId"
        :pending-add="pendingAdd"
        :busy="addBusy"
        :current-user-id="currentUserId"
        @add="onAddComment"
        @cancel-add="onCancelAdd"
        @reply="onReply"
        @resolve="onResolve"
        @delete="onDelete"
        @focus-comment="onFocusComment"
        @close="showCommentSidebar = false"
      />
      <!-- 常驻入口：浮动评论按钮（不依赖选中文本，可随时打开侧栏查看/管理评论） -->
      <button
        v-if="!showCommentSidebar"
        class="embed-comment-fab"
        type="button"
        title="打开评论"
        @click="showCommentSidebar = true"
      >
        <span class="embed-comment-fab-icon">💬</span>
        <span v-if="comments.length" class="embed-comment-fab-badge">{{ comments.length }}</span>
      </button>
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

// 评论功能
import { useComments } from './composables/useComments.js'
import CommentSidebar from './components/comment/CommentSidebar.vue'
import BubbleButton from './components/comment/BubbleButton.vue'
import { Comment } from './extensions/comment-mark.js'
import { CommentHighlight } from './extensions/comment-highlight.js'

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

// 父页面通过 postMessage 下发的业务配置（模板/用户目录/书签显示/分享与 CDN 地址等）。
// embed 挂载时向父页面 request-config，父页面回传 { type:'config', payload } 后再挂载编辑器，
// 使这些功能由业务系统控制，URL 不承载配置（无长度限制）。
const parentConfig = ref({})
const configReady = ref(false)

// 在线协作者列表（由 awareness 变化填充），provide 给状态栏头像组消费
// （与 src/app.vue 一致：statusbar 通过 inject('collaborators') 取值）
const collaborators = ref([])
provide('collaborators', collaborators)

// 评论状态
const showCommentSidebar = ref(false)
const pendingAdd = ref(null) // { from, to, selectedText }
const addBusy = ref(false)
const currentUserId = ref('')

// 当前用户信息（由 JWT 解析，供评论 author 使用 + awareness 推入）
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
      readOnly: mode === 'view',
      autofocus: mode !== 'view',
      enableMarkdown: true,
      autoSave: { enabled: true, interval: 30000 },
      enableBubbleMenu: true,
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

// BubbleButton 取编辑器实例的安全包装：
// bubble_menu 插槽会被 Umo Editor 在显示/隐藏时反复挂载卸载，挂载瞬间 editorRef.value
// 可能为 null（编辑器组件未就绪）或 useEditor 方法尚未挂载。原内联箭头函数
// `() => editorRef.value?.useEditor?.()` 在极端时序下仍可能让 watcher getter 抛错
// （"Cannot read properties of null (reading 'value')"），这里显式 try/catch 兜底。
function safeBubbleGetEditor() {
  try {
    return editorRef.value?.useEditor?.() || null
  } catch {
    return null
  }
}

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

  // 点击编辑器正文取消高亮（失焦行为）
  const editor = editorRef.value?.useEditor?.()
  if (editor) {
    editor.view.dom.addEventListener('mousedown', clearActive)
  }

  // 加载评论 + 连接 SSE（协同连接就绪后才请求，确保后端能正确识别文档）
  loadComments()
  connectSSE()
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
  // role 写进 awareness，供状态栏协作者头像组的角色徽章显示（viewer→只读，否则编辑）
  const userRole = payload.role === 'viewer' ? 'viewer' : 'editor'
  collabUserRef.value = {
    id: payload.id || payload.sub || '',
    name: userName,
    color: COLLAB_COLORS[Math.floor(Math.random() * COLLAB_COLORS.length)],
    role: userRole,
  }
  currentUserId.value = collabUserRef.value.id

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
    // Comment mark：选中文字时 setMark('comment', { commentId })，位置随 Yjs 自动同步
    Comment,
    // active 高亮：点击侧栏评论时高亮对应 mark 文字
    CommentHighlight.configure({
      getActiveComment: () => activeCommentId.value,
    }),
  ]
}

// ============ 评论功能 ============
const {
  comments,
  activeCommentId,
  loadComments,
  connectSSE,
  addComment,
  replyComment,
  deleteComment,
  resolveComment,
  setActive,
  clearActive,
  dispose: disposeComments,
} = useComments({
  docId,
  getAuthor: () => collabUserRef.value,
  getCommentApiBase: () => parentConfig.value.commentApiBase,
})

// activeCommentId 变化 → 触发 ProseMirror decorations 重算（高亮对应 mark）
watch(activeCommentId, () => {
  const editor = editorRef.value?.useEditor?.()
  if (editor?.view) {
    // dispatch 空 tr 让 CommentHighlight 的 decorations 重算
    editor.view.dispatch(editor.state.tr)
  }
})

// 气泡菜单"评论"按钮：记录选区 + commentId，打开侧栏
// from/to 仅用于 apply mark 时定位，不持久化到后端
function onBubbleAdd({ commentId, from, to, selectedText }) {
  pendingAdd.value = { commentId, from, to, selectedText }
  showCommentSidebar.value = true
}

// 发表评论：先给选区文字打上 comment mark（commentId），再 POST 持久化
async function onAddComment(content) {
  if (!pendingAdd.value) return
  addBusy.value = true
  try {
    const { commentId, from, to, selectedText } = pendingAdd.value
    // 1. apply comment mark 到选区（通过 Yjs 协同同步给所有客户端）
    const editor = editorRef.value?.useEditor?.()
    if (editor) {
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setMark('comment', { commentId })
        .run()
    }
    // 2. POST 持久化（id = commentId，后端直接用作主键）
    await addComment({ id: commentId, selectedText, content })
    pendingAdd.value = null
  } catch (e) {
    console.error('[comments] 发表评论失败', e?.message || e)
    throw e
  } finally {
    addBusy.value = false
  }
}

function onCancelAdd() {
  pendingAdd.value = null
}

async function onReply({ id, content }) {
  await replyComment(id, content)
}

// 标记解决/取消解决：同时更新 mark 的 resolved 属性（变灰/恢复）
async function onResolve({ id, resolved }) {
  await resolveComment(id, resolved)
  updateCommentMark(id, { resolved })
}

// 删除评论：同时从文档中移除对应 comment mark
async function onDelete(id) {
  await deleteComment(id)
  removeCommentMark(id)
}

// ============ Comment Mark 操作工具 ============
// 遍历文档，找到 commentId 对应的 mark range，执行回调（setMark 更新属性 / removeMark 删除）
function withCommentMark(commentId, fn) {
  const editor = editorRef.value?.useEditor?.()
  if (!editor) return
  const { state } = editor
  let found = false
  state.doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isText) return
    const mark = node.marks.find(
      (m) => m.type.name === 'comment' && m.attrs.commentId === commentId,
    )
    if (mark) {
      // 链式操作：选中该 range，然后 setMark 更新属性或 removeMark 删除
      const chain = editor.chain().setTextSelection({ from: pos, to: pos + node.nodeSize })
      fn(chain, mark)
      found = true
      return false
    }
  })
}

// 更新 mark 属性（如 resolved）
function updateCommentMark(commentId, attrs) {
  withCommentMark(commentId, (chain) => {
    chain.setMark('comment', { commentId, ...attrs }).run()
  })
}

// 移除 mark
function removeCommentMark(commentId) {
  withCommentMark(commentId, (chain) => {
    chain.unsetMark('comment').run()
  })
}

// 滚动定位到评论对应的 mark（侧栏点击评论时调用）
function scrollToComment(commentId) {
  const editorDom = editorRef.value?.useEditor?.()?.view?.dom
  if (!editorDom) return
  const el = editorDom.querySelector(`[data-comment-id="${commentId}"]`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

// 点击侧栏评论卡片：设 active 高亮 + 滚动定位
function onFocusComment(id) {
  setActive(id)
  scrollToComment(id)
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
  disposeComments()
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
/* 评论侧栏：在编辑器右侧以绝对定位叠加 */
/* z-index > Umo Editor .umo-main-floating-actions(200)，避免右下角浮动操作遮挡侧栏 */
/* 注意：App.vue 用的是 <style>（非 scoped），不能写 :deep()——:deep 只在 scoped 中生效。
   这里直接用全局选择器 .umo-cmt-sidebar 即可覆盖到 CommentSidebar 组件根元素。 */
.embed-editor-wrap .umo-cmt-sidebar {
  position: absolute;
  top: 0;
  right: 0;
  width: 320px;
  height: 100%;
  z-index: 300;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.08);
}
/* 常驻浮动评论入口按钮 */
/* z-index 必须 > Umo Editor 的 .umo-main-floating-actions（z-index:200），否则会被
   那个右下角浮动操作容器遮挡导致点击不到。放在左侧底部避开 floating-actions 区域。 */
.embed-comment-fab {
  position: absolute;
  left: 16px;
  bottom: 48px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: var(--umo-primary-color, #4d8ee0);
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
  z-index: 300;
  padding: 0;
  transition: transform 0.15s, box-shadow 0.15s;
}
.embed-comment-fab:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.24);
}
.embed-comment-fab-icon {
  font-size: 18px;
  line-height: 1;
}
.embed-comment-fab-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #e5403a;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  font-weight: 600;
}
/* ============ 评论 Mark 样式 ============ */
/* App.vue 用 <style>（非 scoped），直接写全局选择器，不能用 :deep() */

/* 评论 mark：始终可见的淡色底色 */
.umo-comment-mark {
  background: rgba(77, 142, 224, 0.12);
  border-radius: 2px;
  cursor: pointer;
  transition: background 0.15s;
}
/* 已解决的评论：灰色 + 删除线 */
.umo-comment-mark.resolved {
  background: rgba(0, 0, 0, 0.05);
  color: #999;
  text-decoration: line-through;
}
/* active 高亮（点击侧栏评论时，decoration 叠加） */
.umo-comment-mark.umo-comment-active,
.umo-comment-active {
  background: rgba(77, 142, 224, 0.28) !important;
  box-shadow: 0 0 0 1px rgba(77, 142, 224, 0.4);
}
</style>
