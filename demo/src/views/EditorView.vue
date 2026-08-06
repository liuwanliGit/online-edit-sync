<template>
  <div class="editor-page">
    <!-- 顶部细栏（文档标题已移至编辑器工具栏标题行，这里只留返回按钮 + 角色标签） -->
    <header class="topbar">
      <div class="topbar-left">
        <t-button theme="default" variant="text" shape="square" @click="goBack">
          <template #icon><t-icon name="arrow-left" /></template>
        </t-button>
        <t-divider layout="vertical" />
        <span class="topbar-back-label">返回文档列表</span>
      </div>
      <div class="topbar-right">
        <t-tag
          :theme="isCollab() ? 'warning' : 'success'"
          variant="light"
          shape="round"
          size="small"
        >
          <template #icon>
            <t-icon :name="isCollab() ? 'user-group' : 'desktop'" />
          </template>
          {{ isCollab() ? '协同' : '单机' }}
        </t-tag>
        <t-tag
          :theme="isViewer() ? 'default' : 'primary'"
          variant="light"
          shape="round"
          size="small"
        >
          <template #icon>
            <t-icon :name="isViewer() ? 'lock-on' : 'edit-2'" />
          </template>
          {{ isViewer() ? '只读' : '可编辑' }}
        </t-tag>
        <t-tag theme="default" variant="outline" shape="round" size="small">
          <template #icon><t-icon name="user" /></template>
          {{ auth.user?.name }}
        </t-tag>
      </div>
    </header>

    <!-- 只读提示条 -->
    <div v-if="isViewer()" class="readonly-banner">
      <t-icon name="info-circle-filled" />
      你正在以「只读」模式查看该文档，如需编辑请重新以「编辑者」角色登录。
    </div>

    <!-- 文档不存在 -->
    <div v-if="notFound" class="missing">
      <div class="missing-illu"><t-icon name="file-unknown" /></div>
      <h3>文档不存在</h3>
      <p>这篇文档可能已被删除，或链接有误。</p>
      <t-button theme="primary" variant="outline" @click="goBack">
        <template #icon><t-icon name="list" /></template>
        返回文档列表
      </t-button>
    </div>

    <!-- 协同模式：连接中 -->
    <div v-else-if="showCollabConnecting" class="collab-loading">
      <div class="collab-spinner"><t-icon name="loading" /></div>
      <p>{{ collabError ? collabError : '正在连接协同服务…' }}</p>
      <p v-if="!collabError" class="collab-tip">首次连接可能需要几秒钟</p>
      <t-button v-else theme="primary" variant="outline" @click="goBack">返回列表</t-button>
    </div>

    <!-- 编辑器（单机模式：doc 就绪即挂载；协同模式：synced 后挂载） -->
    <div v-else-if="doc && editorReady" class="editor-wrap">
      <umo-editor
        ref="editorRef"
        v-bind="editorOptions"
        @created="onEditorCreated"
        @changed:toolbar="scheduleReinject"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Button as TButton,
  Tag as TTag,
  Icon as TIcon,
  Divider as TDivider,
} from 'tdesign-vue-next'

import { useToast } from '@/composables/useToast'
import { auth, isViewer, isCollab } from '@/store/auth'
import { get, update } from '@/store/documents'
import { exportDocx } from '@/utils/api'
import { saveAs } from 'file-saver'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const docId = computed(() => route.params.id)
const doc = ref(null)
const notFound = ref(false)
const editorRef = ref(null)
const theme = ref('light')

// 协同模式专用状态
const editorReady = ref(false) // 协同模式：synced 后置 true；单机模式：doc 就绪即 true
const collabError = ref('')
// 用 shallowRef 持有 Yjs/Hocuspocus 实例，避免被 Vue 深度代理（它们自带内部状态）
const ydocRef = shallowRef(null)
const providerRef = shallowRef(null)
// 在线协作者列表（协同模式由 awareness 填充；单机模式空数组）
const collaborators = ref([])

const mode = () => auth.user?.mode || 'standalone'

// 把 File 转成 base64 Data URL，无需配置上传地址。
// 返回的 dataURL 会直接写入文档：单机模式随 HTML 存进 localStorage，
// 协同模式随 Yjs 文档同步给所有协作者，刷新/多端都不会失效。
const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })

// 协作者光标颜色池（#RRGGBB，yCursorPlugin 要求 6 位 hex）
const COLLAB_COLORS = [
  '#e06c75', '#56b6c2', '#c678dd', '#61afef',
  '#98c379', '#e5c07b', '#d19a66', '#ff6b6b',
]

// 工具栏信息区渲染用：单机=[自己]；协同=所有在线协作者（去重 + 兜底自己）
// 每项含 { name, color, role }，role 用于浮框里展示「编辑/查看」
const displayUsers = computed(() => {
  const self = {
    name: auth.user?.name || '我',
    color: '#4d8cf2',
    role: isViewer() ? 'viewer' : 'editor',
  }
  if (!isCollab()) return [self]
  const seen = new Set()
  const list = []
  for (const s of collaborators.value) {
    const u = s?.user
    if (!u || !u.name || seen.has(u.name)) continue
    seen.add(u.name)
    list.push({
      name: u.name,
      color: u.color || '#61afef',
      role: u.role === 'viewer' ? 'viewer' : 'editor',
    })
  }
  // awareness 回填前可能为空，兜底把自己加进去
  if (!seen.has(self.name)) list.unshift(self)
  return list
})

// ============ 编辑器配置 ============
const editorOptions = computed(() => {
  if (!doc.value) return {}
  const base = {
    editorKey: `doc-${doc.value.id}`,
    theme: theme.value,
    locale: 'zh-CN',
    height: '100%',
    document: {
      title: doc.value.title,
      readOnly: isViewer(),
      autofocus: !isViewer(),
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
    user: {
      id: auth.user?.name || 'guest',
      label: auth.user?.name || '访客',
    },
  }

  if (isCollab()) {
    // 协同模式：内容由 Yjs 驱动，禁用 UndoRedo（改用 Yjs 撤销栈），注入协同扩展
    base.document.content = ''
    base.disableExtensions = ['undoRedo']
    base.extensions = collabExtensions.value
    // 协同模式内容由服务端持久化，点保存给个提示即可
    base.onSave = async () => '协同模式：内容由服务端实时保存'
    base.onFileUpload = async (file) => {
      if (!file) throw new Error('没有找到要上传的文件')
      const base64 = await fileToBase64(file)
      return {
        id: `file-${Date.now()}`,
        url: base64,
        name: file.name,
        type: file.type,
        size: file.size,
      }
    }
    base.onFileDelete = () => {}
  } else {
    // 单机模式：内容来自 localStorage，保存写回
    base.document.content = doc.value.content || ''
    base.onSave = async (content, page, document) => {
      update(docId.value, {
        title: document.title,
        content: content.html,
      })
      return '文档保存成功'
    }
    base.onFileUpload = async (file) => {
      if (!file) throw new Error('没有找到要上传的文件')
      const base64 = await fileToBase64(file)
      return {
        id: `file-${Date.now()}`,
        url: base64,
        name: file.name,
        type: file.type,
        size: file.size,
      }
    }
    base.onFileDelete = () => {}
  }
  // Word 导出：两种模式共用，把 HTML 发给 convert-server 转 .docx 后下载
  base.onExportDocx = async (html, title) => {
    const blob = await exportDocx(html, title)
    saveAs(blob, `${title || 'document'}.docx`)
  }
  return base
})

// 协同扩展（Collaboration + 远程光标），在 setupCollab 时填充
const collabExtensions = ref([])

// 是否显示"连接中"态：仅协同模式且编辑器未就绪
const showCollabConnecting = computed(
  () => isCollab() && !notFound.value && !editorReady.value,
)

function onEditorCreated() {
  if (isViewer()) {
    editorRef.value?.setReadOnly?.(true)
  }
  // 工具栏渲染后注入信息区（ribbon↔classic 切换由模板 @changed:toolbar 重注入）
  injectToolbarInfo()
}

// ============ 工具栏信息区注入（头像组 + 模式/角色 tag） ============
// 编辑器的 .umo-toolbar-actions 不暴露 slot，只能挂载后 DOM 注入。
const INFO_HOST_CLASS = 'umo-demo-toolbar-info'
let infoHostEl = null
let reinjectTimer = null

// 找到编辑器容器内的工具栏 actions 区（ribbon 或 classic）
// editorRef.value 是 defineExpose 的方法集合（无 $el），故从 document 查询。
// 本 demo 每个标签页一个 document，querySelector 只会命中当前页的编辑器。
function findActionsContainer() {
  return (
    document.querySelector('.umo-toolbar-actions-ribbon') ||
    document.querySelector('.umo-toolbar-actions-classic') ||
    document.querySelector('.umo-toolbar-actions') ||
    null
  )
}

function injectToolbarInfo() {
  nextTick(() => {
    const container = findActionsContainer()
    if (!container) {
      // 工具栏还没渲染，稍后重试
      scheduleReinject()
      return
    }
    // 每次都从容器内重新查找宿主：编辑器工具栏可能在模式切换/重渲时
    // 重建 DOM，导致旧的 infoHostEl 引用变成游离节点，绑定的事件失效。
    let host = container.querySelector('.' + INFO_HOST_CLASS)
    if (!host) {
      host = document.createElement('div')
      host.className = INFO_HOST_CLASS
      container.appendChild(host)
    }
    infoHostEl = host
    renderInfoBar(host)
  })
}

function scheduleReinject() {
  clearTimeout(reinjectTimer)
  reinjectTimer = setTimeout(injectToolbarInfo, 80)
}

function togglePopover() {
  const pop = document.querySelector('.umo-demo-popover')
  if (pop && pop.isConnected) {
    hidePopover()
  } else {
    showPopover()
  }
}

function showPopover() {
  hidePopover()
  const users = displayUsers.value
  const total = users.length
  const items = users
    .map((u) => {
      const isViewerRole = u.role === 'viewer'
      const roleText = isViewerRole ? '查看' : '编辑'
      const roleClass = isViewerRole ? 'umo-demo-popover-role-viewer' : 'umo-demo-popover-role-editor'
      const roleIcon = isViewerRole
        ? '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M5 7V5a3 3 0 0 1 6 0v2h1a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1zm1 0h4V5a2 2 0 0 0-4 0v2z"/></svg>'
        : '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M11.5 2.5a1.5 1.5 0 0 1 1.5 1.5v1.585A1.5 1.5 0 0 1 13 7v6.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1.5 1.5 0 0 1 0-2.415V4a1.5 1.5 0 0 1 1.5-1.5h7zM10 9H6v1h4V9z"/></svg>'
      return `
        <li class="umo-demo-popover-item">
          <span class="umo-demo-popover-avatar" style="background:${u.color}">${escapeHtml((u.name || '?').slice(0, 1))}</span>
          <span class="umo-demo-popover-name">${escapeHtml(u.name)}</span>
          <span class="umo-demo-popover-role ${roleClass}">${roleIcon}${roleText}</span>
        </li>`
    })
    .join('')

  const title = isCollab() ? `在线协作者（${total}）` : '当前用户'
  const pop = document.createElement('div')
  pop.className = 'umo-demo-popover'
  pop.innerHTML = `
    <div class="umo-demo-popover-header">${escapeHtml(title)}</div>
    <ul class="umo-demo-popover-list">${items}</ul>
  `
  // 挂到 body，避免被编辑器容器裁剪/定位干扰
  document.body.appendChild(pop)
  // 定位到头像组下方
  positionPopover(pop)
  // 点击浮框内部不触发关闭（阻止冒泡到 host）
  pop.addEventListener('click', (ev) => ev.stopPropagation())
  // 滚动/外部点击关闭
  document.addEventListener('click', onDocClickHide, true)
  window.addEventListener('scroll', hidePopover, true)
  window.addEventListener('resize', hidePopover)
}

function positionPopover(pop) {
  const avatarsEl = infoHostEl?.querySelector('.umo-demo-avatars')
  if (!avatarsEl) return
  const rect = avatarsEl.getBoundingClientRect()
  const popRect = pop.getBoundingClientRect()
  // 默认左对齐头像组、下方；右侧溢出则右对齐
  let left = rect.left
  if (left + popRect.width > window.innerWidth - 12) {
    left = rect.right - popRect.width
  }
  left = Math.max(12, left)
  pop.style.left = `${left}px`
  pop.style.top = `${rect.bottom + 8}px`
}

function hidePopover() {
  const pop = document.querySelector('.umo-demo-popover')
  if (pop && pop.isConnected) pop.remove()
  document.removeEventListener('click', onDocClickHide, true)
  window.removeEventListener('scroll', hidePopover, true)
  window.removeEventListener('resize', hidePopover)
}

// 捕获阶段：点击页面任何位置（除浮框自身）都关闭浮框
function onDocClickHide(e) {
  if (!e.target.closest('.umo-demo-popover') && !e.target.closest('.umo-demo-avatars')) {
    hidePopover()
  }
}

// 把头像组 + tag 渲染进宿主 div（手动 DOM，避免再开一个 Vue app）
function renderInfoBar(el) {
  const users = displayUsers.value
  const maxShow = 5
  const shown = users.slice(0, maxShow)
  const overflow = users.length - shown.length

  // 头像组 HTML（可点击，role=button，有标题提示）
  const avatars = shown
    .map(
      (u, i) =>
        `<span class="umo-demo-avatar" style="background:${u.color};z-index:${10 - i}" title="${escapeHtml(u.name)}">${escapeHtml((u.name || '?').slice(0, 1))}</span>`,
    )
    .join('')
  const overflowHtml = overflow > 0 ? `<span class="umo-demo-avatar umo-demo-avatar-more">+${overflow}</span>` : ''

  const roleTag = isViewer()
    ? `<span class="umo-demo-tag umo-demo-tag-default"><svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M5 7V5a3 3 0 0 1 6 0v2h1a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1zm1 0h4V5a2 2 0 0 0-4 0v2z"/></svg>只读</span>`
    : `<span class="umo-demo-tag umo-demo-tag-primary"><svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M11.5 2.5a1.5 1.5 0 0 1 1.5 1.5v1.585A1.5 1.5 0 0 1 13 7v6.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1.5 1.5 0 0 1 0-2.415V4a1.5 1.5 0 0 1 1.5-1.5h7zM10 9H6v1h4V9z"/></svg>编辑</span>`
  const modeTag = isCollab()
    ? `<span class="umo-demo-tag umo-demo-tag-warning"><svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M7 2a3 3 0 0 0-2.83 4A3 3 0 0 0 5 11.83V13a1 1 0 0 0 2 0v-1h2v1a1 1 0 0 0 2 0v-1.17A3 3 0 0 0 11 6a3 3 0 0 0-4-4z"/></svg>协同</span>`
    : `<span class="umo-demo-tag umo-demo-tag-success"><svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9zm2 1v1h8v-1H4zm0 3v1h8V7.5H4z"/></svg>单机</span>`

  el.innerHTML = `
    <span class="umo-demo-avatars" role="button" tabindex="0" title="点击查看人员列表">
      ${avatars}${overflowHtml}
    </span>
    <span class="umo-demo-tags">${roleTag}${modeTag}</span>
  `
  // 直接给头像组绑定点击（每次重渲重新绑）。
  // 用 { capture: false } 冒泡阶段处理，并在 showPopover 里用捕获阶段判断外部点击关闭。
  const avatarsEl = el.querySelector('.umo-demo-avatars')
  if (avatarsEl) {
    avatarsEl.addEventListener('click', (e) => {
      e.stopPropagation()
      togglePopover()
    })
    avatarsEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        togglePopover()
      }
    })
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c])
}

// 协作者变化 → 刷新头像组；若浮框开着则同步刷新浮框
watch(displayUsers, () => {
  // 走 injectToolbarInfo：它会重新查找当前 DOM 里的宿主再渲染，
  // 避免用可能已游离的 infoHostEl 旧引用。
  injectToolbarInfo()
  if (document.querySelector('.umo-demo-popover')) {
    hidePopover()
    showPopover()
  }
})

// ============ 协同模式：建立 Yjs + HocuspocusProvider ============
async function setupCollab() {
  // 动态 import：避免单机模式也加载协同包（减小单机首屏体积）
  const { HocuspocusProvider } = await import('@hocuspocus/provider')
  const { Collaboration } = await import('@tiptap/extension-collaboration')
  const { Extension } = await import('@tiptap/core')
  const { yCursorPlugin } = await import('@tiptap/y-tiptap')
  const Y = await import('yjs')

  const { getCollabWsUrl, getCollabTokenUrl } = await import('@/utils/collab-config')

  const ydoc = new Y.Doc()
  ydocRef.value = ydoc

  // 协作者信息：用当前登录用户名 + 随机颜色
  const collabUser = {
    name: auth.user?.name || `用户-${Math.floor(Math.random() * 1000)}`,
    color: COLLAB_COLORS[Math.floor(Math.random() * COLLAB_COLORS.length)],
    role: isViewer() ? 'viewer' : 'editor',
  }

  const provider = new HocuspocusProvider({
    url: getCollabWsUrl(),
    name: String(docId.value), // documentName = 文档 uuid，与 demo 后端主键一致
    document: ydoc,
    flushDelay: 80,
    // 用构造函数回调（在内部建立连接前注册，避免事件早于监听器的竞争）
    onSynced() {
      editorReady.value = true
    },
    onAuthenticationFailed({ reason }) {
      collabError.value = `协同鉴权失败：${reason || '未知原因'}`
    },
    // 协作者上线/离线 → 刷新工具栏头像组
    onAwarenessChange({ states }) {
      collaborators.value = states
    },
    onAwarenessUpdate({ states }) {
      collaborators.value = states
    },
    token: async () => {
      const res = await fetch(
        `${getCollabTokenUrl()}?name=${encodeURIComponent(collabUser.name)}&doc=${encodeURIComponent(String(docId.value))}&role=${collabUser.role}`,
      )
      const data = await res.json()
      return data.token
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

// ============ 生命周期 ============
onMounted(async () => {
  const m = mode()
  if (m === 'collab') {
    try {
      // 协同模式：先从 demo 后端取文档元数据（标题等）
      doc.value = await get(m, docId.value)
      if (!doc.value) {
        notFound.value = true
        return
      }
      // 再建立协同连接，synced 后 editorReady=true 才挂载编辑器
      await setupCollab()
    } catch (e) {
      collabError.value = `加载失败：${e.message || e}`
      editorReady.value = false
    }
  } else {
    // 单机模式：同步取本地文档
    doc.value = get(m, docId.value)
    if (!doc.value) {
      notFound.value = true
      return
    }
    editorReady.value = true
  }
})

onUnmounted(() => {
  // 单机模式：离开前保存一次最新内容
  if (mode() !== 'collab' && doc.value && !isViewer() && editorRef.value) {
    try {
      const html = editorRef.value.getHTML()
      const currentTitle =
        editorRef.value.options?.document?.title || doc.value.title
      update(docId.value, { title: currentTitle, content: html })
    } catch {
      // 忽略卸载时的异常
    }
  }
  // 协同模式：销毁连接，避免热更新泄漏
  if (providerRef.value) providerRef.value.destroy()
  if (ydocRef.value) ydocRef.value.destroy()
  // 清理注入到工具栏的信息区节点 + 浮框
  clearTimeout(reinjectTimer)
  hidePopover()
  if (infoHostEl && infoHostEl.isConnected) {
    infoHostEl.remove()
  }
  infoHostEl = null
})

function goBack() {
  router.push({ name: 'documents' })
}
</script>

<style scoped>
.editor-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--demo-bg);
}

/* ===== 顶部栏 ===== */
.topbar {
  flex-shrink: 0;
  height: 52px;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid var(--demo-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.topbar-back-label {
  font-size: 13px;
  color: var(--demo-text-secondary);
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 只读提示条 */
.readonly-banner {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  background: #fff7e8;
  color: #d48806;
  font-size: 13px;
  border-bottom: 1px solid #ffe7ba;
}

/* 协同连接中 */
.collab-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--demo-text-tertiary);
}
.collab-spinner {
  font-size: 40px;
  color: var(--demo-primary);
  animation: demo-spin 1s linear infinite;
  margin-bottom: 20px;
}
.collab-loading p {
  margin: 4px 0;
  font-size: 14px;
}
.collab-tip {
  font-size: 12px !important;
  color: var(--demo-text-tertiary);
}
@keyframes demo-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 编辑器容器 */
.editor-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 文档不存在 */
.missing {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--demo-text-tertiary);
}
.missing-illu {
  width: 96px;
  height: 96px;
  border-radius: 24px;
  background: linear-gradient(135deg, #fff1f0, #fff7e8);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 44px;
  color: #ffccc7;
  margin-bottom: 24px;
}
.missing h3 {
  margin: 0 0 8px;
  font-size: 18px;
  color: var(--demo-text-secondary);
}
.missing p {
  margin: 0 0 24px;
  font-size: 14px;
}
</style>

<!-- 全局样式：注入到编辑器工具栏内的信息区（scoped 无法作用于注入的 DOM） -->
<style>
.umo-demo-toolbar-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px 0 4px;
  margin-left: 4px;
  border-left: 1px solid var(--umo-border-color-light, #e5e6eb);
  height: 28px;
}
.umo-demo-avatars {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 12px;
  outline: none;
  transition: background 0.15s ease;
}
.umo-demo-avatars:hover,
.umo-demo-avatars:focus-visible {
  background: rgba(77, 140, 242, 0.1);
}
.umo-demo-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06);
  box-sizing: border-box;
  user-select: none;
}
.umo-demo-avatar + .umo-demo-avatar {
  margin-left: -8px;
}
.umo-demo-avatar-more {
  background: #86909c !important;
  font-size: 10px;
}
.umo-demo-tags {
  display: flex;
  align-items: center;
  gap: 4px;
}
.umo-demo-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.umo-demo-tag svg {
  flex-shrink: 0;
}
.umo-demo-tag-primary {
  color: #4d8cf2;
  background: #eaf2fe;
}
.umo-demo-tag-default {
  color: #86909c;
  background: #f2f3f5;
}
.umo-demo-tag-warning {
  color: #d48806;
  background: #fff7e8;
}
.umo-demo-tag-success {
  color: #389e0d;
  background: #f0fff0;
}
/* 工具栏紧凑模式（窄屏）下隐藏 tag 文字，只留图标 */
@media screen and (max-width: 900px) {
  .umo-demo-tag {
    padding: 0 6px;
  }
}

/* ===== 头像组点击浮框（人员列表） ===== */
.umo-demo-popover {
  position: fixed;
  z-index: 10000;
  min-width: 200px;
  max-width: 280px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 6px 30px rgba(0, 0, 0, 0.15);
  border: 1px solid var(--umo-border-color-light, #e5e6eb);
  overflow: hidden;
  animation: umo-demo-popover-in 0.14s ease;
}
@keyframes umo-demo-popover-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.umo-demo-popover-header {
  padding: 10px 14px 8px;
  font-size: 12px;
  color: var(--umo-text-secondary, #4e5969);
  border-bottom: 1px solid var(--umo-border-color-light, #f0f1f2);
  font-weight: 500;
}
.umo-demo-popover-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  max-height: 280px;
  overflow-y: auto;
}
.umo-demo-popover-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 6px;
}
.umo-demo-popover-item:hover {
  background: var(--umo-background-color-primary-hover, #f5f7fa);
}
.umo-demo-popover-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}
.umo-demo-popover-name {
  flex: 1;
  font-size: 13px;
  color: var(--umo-text-primary, #1d2129);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.umo-demo-popover-role {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  flex-shrink: 0;
}
.umo-demo-popover-role svg {
  flex-shrink: 0;
}
.umo-demo-popover-role-editor {
  color: #4d8cf2;
  background: #eaf2fe;
}
.umo-demo-popover-role-viewer {
  color: #86909c;
  background: #f2f3f5;
}
</style>
