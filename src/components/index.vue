<template>
  <t-config-provider
    :key="options.editorKey"
    :global-config="{
      ...localeConfig[locale],
      classPrefix: 'umo',
    }"
  >
    <div
      :id="container.substr(1)"
      class="umo-editor-container"
      :class="{
        'toolbar-classic': isRecord($toolbar) && $toolbar.mode === 'classic',
        'toolbar-ribbon': isRecord($toolbar) && $toolbar.mode === 'ribbon',
        'preview-mode': page.preview?.enabled,
        'laser-pointer': page.preview?.enabled && page.preview?.laserPointer,
        'umo-editor-is-fullscreen': fullscreen,
        'umo-editor-is-typerwriter-runing': typeWriterIsRunning,
        'umo-skin-default': options.skin === 'default',
        'umo-skin-modern': options.skin === 'modern',
      }"
      :style="{
        height: options.height,
        zIndex: fullscreen ? options.fullscreenZIndex : 'unset',
      }"
    >
      <header class="umo-toolbar">
        <toolbar
          :key="toolbarKey"
          @menu-change="(event) => emits('changed:menu', event)"
        >
          <template
            v-for="item in options.toolbar?.menus"
            :key="item"
            #[`toolbar_${item}`]="slotProps"
          >
            <slot :name="`toolbar_${item}`" v-bind="slotProps" />
          </template>
        </toolbar>
      </header>
      <main class="umo-main">
        <container-page>
          <template #bubble_menu="slotProps">
            <slot name="bubble_menu" v-bind="slotProps" />
          </template>
        </container-page>
      </main>
      <footer class="umo-footer">
        <statusbar />
      </footer>
    </div>
  </t-config-provider>
</template>

<script setup>
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
} from '@tool-belt/type-predicates'
import { AllSelection } from '@tiptap/pm/state'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import domToImage from 'dom-to-image-more'
import enConfig from 'tdesign-vue-next/esm/locale/en_US'
import cnConfig from 'tdesign-vue-next/esm/locale/zh_CN'

import { getTypewriterRunState } from '@/extensions/type-writer'
import { i18n } from '@/i18n'
import { propsOptions } from '@/options'
import { useComments } from '@/composables/comment'
import { contentTransform } from '@/utils/content-transform'
import { consoleCopyright } from '@/utils/copyright'
import {
  addHistory,
  redoHistoryRecord,
  undoHistoryRecord,
} from '@/utils/history-record'
import { getOptions } from '@/utils/options'
import { getSelectionNode, getSelectionText } from '@/utils/selection'
import { shortId } from '@/utils/short-id'
import { getCurrentInstance } from 'vue'
const { toBlob, toJpeg, toPng } = domToImage

defineOptions({ name: 'UmoEditor' })

// Props and Emits
const props = defineProps(propsOptions)
const emits = defineEmits([
  'beforeCreate',
  'created',
  'changed',
  'changed:selection',
  'changed:transaction',
  'changed:menu',
  'changed:toolbar',
  'changed:pageLayout',
  'changed:pageSize',
  'changed:pageOrientation',
  'changed:pageMargin',
  'changed:pageBackground',
  'changed:pageShowToc',
  'changed:pagePreview',
  'changed:pageZoom',
  'changed:pageWatermark',
  'changed:locale',
  'changed:theme',
  'changed:skin',
  'print',
  'focus',
  'blur',
  'paste',
  'drop',
  'delete',
  'saved',
  'destroy',
])
// 撤销重做的记录步骤
const historyRecords = ref({
  done: [], // 能撤销的记录数组
  undone: [], // 能重做的记录数组
  isUndoRedo: false, // 标记是否正在执行撤销/重做操作
  editorCount: 0,
})
// 协同模式下编辑器撤销/重做能力由 Yjs UndoManager 提供，无法从 historyRecords 队列推断。
// 这里直接持有 undoManager 引用，并监听其栈变化事件刷新 collabCanUndo/Redo
// （undo.vue / redo.vue 据此禁用按钮）。
// 注意：不能用 editor.can().undo() 探测——它走 extension-collaboration 的 undo 命令，
// 该命令在 Tiptap3 下因 preventDispatch 永远不执行 undo(state)（上游 bug），
// 故绕过命令、直接从 plugin state 取 undoManager 并监听事件。
const collabUndoManager = ref(null)
const collabCanUndo = ref(false)
const collabCanRedo = ref(false)

const container = $ref(`#umo-editor-${shortId(4)}`)
const defaultOptions = inject('defaultOptions', {})
const options = ref(getOptions(props, defaultOptions))
const editor = ref(null)
const savedAt = ref(null)
const page = ref({})
const blockMenu = ref(false)
const imageViewer = ref({ visible: false, current: null })
const searchReplace = ref(false)
const printing = ref(false)
const fullscreen = ref(false)
const exportFile = ref({ pdf: false, image: false, word: false })
const uploadFileMap = ref(new Map())
// const bookmark = ref(false)
const destroyed = ref(false)
const typeWriterIsRunning = ref(false)

const $toolbar = useState('toolbar', options)
const $document = useState('document', options)
const $layout = useState('layout', options)

provide('container', container)
provide('options', options)
provide('editor', editor)
provide('savedAt', savedAt)
provide('page', page)
provide('blockMenu', blockMenu)
provide('imageViewer', imageViewer)
provide('searchReplace', searchReplace)
provide('printing', printing)
provide('fullscreen', fullscreen)
provide('exportFile', exportFile)
provide('uploadFileMap', uploadFileMap)
// provide('bookmark', bookmark)
provide('destroyed', destroyed)
provide('historyRecords', historyRecords)
provide('collabUndoManager', collabUndoManager)
provide('collabCanUndo', collabCanUndo)
provide('collabCanRedo', collabCanRedo)
provide('typeWriterIsRunning', typeWriterIsRunning)

// ============ 评论功能（引擎内置） ============
const showCommentPanel = ref(false)
const commentPendingAdd = ref(null) // { commentId, from, to, selectedText }
const commentAddBusy = ref(false)

// 评论 composable（docId/author 从 options 取）
const {
  enabled: commentsEnabled,
  comments,
  activeCommentId,
  loadComments,
  connectSSE,
  addComment: commentsAddComment,
  replyComment: commentsReplyComment,
  resolveComment: commentsResolveComment,
  deleteComment: commentsDeleteComment,
  setActive: commentsSetActive,
  clearActive: commentsClearActive,
  dispose: commentsDispose,
} = useComments({ options })

// 评论数（用于状态栏 badge）
const commentCount = computed(() => comments.value.length)
// 当前用户 ID（用于判断评论删除权限）
const commentCurrentUserId = computed(
  () => options.value.user?.id || options.value.user?.name || '',
)

// 打开评论面板 + 设置 pendingAdd（气泡"评论"按钮触发）
function commentStart({ commentId, from, to, selectedText }) {
  commentPendingAdd.value = { commentId, from, to, selectedText }
  showCommentPanel.value = true
}

// 提交新评论：先在 editor 上 setMark，再调后端
async function commentAdd(content) {
  const pending = commentPendingAdd.value
  if (!pending || !editor.value) return
  commentAddBusy.value = true
  try {
    const { commentId, from, to, selectedText } = pending
    // 在选区上应用 comment mark
    editor.value
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .setMark('comment', { commentId })
      .run()
    // 发送到后端
    await commentsAddComment({ id: commentId, selectedText, content })
    commentPendingAdd.value = null
  } catch (e) {
    console.error('[comments] 添加评论失败', e)
  } finally {
    commentAddBusy.value = false
  }
}

function commentCancelAdd() {
  commentPendingAdd.value = null
}

async function commentReply(id, content) {
  try {
    await commentsReplyComment(id, content)
  } catch (e) {
    console.error('[comments] 回复失败', e)
  }
}

// 标记解决/取消解决：同时更新 comment mark 的 resolved 属性
async function commentResolve(id, resolved) {
  try {
    await commentsResolveComment(id, resolved)
    updateCommentMark(id, { resolved })
  } catch (e) {
    console.error('[comments] 更新失败', e)
  }
}

// 删除评论：同时移除 comment mark
async function commentDelete(id) {
  try {
    await commentsDeleteComment(id)
    removeCommentMark(id)
  } catch (e) {
    console.error('[comments] 删除失败', e)
  }
}

// 聚焦评论：高亮对应文字 + 滚动到位置
function commentFocus(id) {
  commentsSetActive(id)
  // dispatch 空 tr 触发 CommentHighlight decorations 重算
  if (editor.value) {
    editor.value.view.dispatch(editor.value.state.tr)
  }
  // 滚动到评论 mark 位置
  nextTick(() => {
    const el = document.querySelector(
      `${container} [data-comment-id="${id}"]`,
    )
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

// 切换评论面板
function commentTogglePanel() {
  showCommentPanel.value = !showCommentPanel.value
}

// ============ Comment Mark 操作工具 ============
// 遍历文档找含指定 commentId 的 mark 的文本 range
function findCommentMarkRanges(commentId) {
  if (!editor.value) return []
  const ranges = []
  editor.value.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const mark = node.marks.find(
      (m) => m.type.name === 'comment' && m.attrs.commentId === commentId,
    )
    if (mark) {
      ranges.push({ from: pos, to: pos + node.nodeSize })
    }
  })
  return ranges
}

// 更新 comment mark 的属性（如 resolved）
function updateCommentMark(commentId, attrs) {
  if (!editor.value) return
  const ranges = findCommentMarkRanges(commentId)
  if (!ranges.length) return
  const { from, to } = ranges[0]
  editor.value
    .chain()
    .setTextSelection({ from, to })
    .setMark('comment', { commentId, ...attrs })
    .run()
}

// 移除 comment mark
function removeCommentMark(commentId) {
  if (!editor.value) return
  const ranges = findCommentMarkRanges(commentId)
  if (!ranges.length) return
  const { from, to } = ranges[0]
  editor.value
    .chain()
    .setTextSelection({ from, to })
    .unsetMark('comment')
    .run()
}

// ============ Provide 评论状态 ============
provide('commentsEnabled', commentsEnabled)
provide('comments', comments)
provide('activeCommentId', activeCommentId)
provide('showCommentPanel', showCommentPanel)
provide('commentCount', commentCount)
provide('commentCurrentUserId', commentCurrentUserId)
provide('commentPendingAdd', commentPendingAdd)
provide('commentAddBusy', commentAddBusy)
provide('commentStart', commentStart)
provide('commentAdd', commentAdd)
provide('commentCancelAdd', commentCancelAdd)
provide('commentReply', commentReply)
provide('commentResolve', commentResolve)
provide('commentDelete', commentDelete)
provide('commentFocus', commentFocus)
provide('commentTogglePanel', commentTogglePanel)

watch(
  () => options.value.page,
  ({
    layouts,
    defaultBackground,
    defaultMargin,
    defaultOrientation,
    watermark,
    showBreakMarks,
    showBookmark,
    showLineNumber,
    showToc,
  }) => {
    page.value = {
      layout: $layout.value || layouts[0],
      size: options.value.dicts?.pageSizes.find((item) => item.default),
      margin: defaultMargin,
      background: defaultBackground,
      orientation: defaultOrientation,
      watermark,
      showBreakMarks,
      showBookmark,
      showLineNumber,
      showToc,
      zoomLevel: 100,
      autoWidth: false,
      preview: {
        enabled: false,
        scale: 1,
        zoom: 100,
      },
    }
    editor.value?.commands.showInvisibleCharacters(showBreakMarks)
  },
  { immediate: true, deep: true },
)
watch(
  () => options.value.document?.readOnly,
  (val) => {
    editor.value?.setEditable(!val)
  },
)

let toolbarKey = $ref(shortId())
let toolbarActive = ref(null)
provide('toolbarActive', toolbarActive)
watch(
  () => [options.value.document?.readOnly, editor.value?.isEditable],
  async () => {
    await nextTick()
    toolbarKey = shortId()
  },
)

// Lifecycle Hooks
onMounted(() => {
  const theme = useStorage('umo-editor:theme', options.value.theme)
  const skin = useStorage('umo-editor:skin', options.value.skin)
  setTheme(theme.value)
  setSkin(skin.value)
  window.addEventListener('beforeunload', handleBeforeUnload)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  clearAutoSaveInterval()
  destroy()
})

// Watchers
watch(
  () => props,
  () => setOptions(props),
  { deep: true },
)

watch(
  () => options.value.theme,
  (theme) => {
    setTheme(theme)
  },
)

watch(
  () => options.value.document,
  (val) => {
    $document.value = val
  },
)

watch(
  () => getTypewriterRunState(),
  (newValue) => {
    typeWriterIsRunning.value = newValue
    console.log('typeWriterIsRunning', typeWriterIsRunning)
  },
)

// 定时保存
let contentUpdated = $ref(false)
let isFirstUpdate = $ref(true)
let autoSaveInterval = $ref(null)
let isSaving = $ref(false)
const shouldBlockUnload = () => isSaving || contentUpdated
const handleBeforeUnload = (event) => {
  if (!shouldBlockUnload()) {
    return
  }
  event.preventDefault()
  event.returnValue = ''
}
const clearAutoSaveInterval = () => {
  if (autoSaveInterval !== null) {
    clearInterval(autoSaveInterval)
    autoSaveInterval = null
  }
}
watch(
  () => contentUpdated,
  (val) => {
    const { autoSave } = options.value.document
    if (!autoSave?.enabled) {
      return
    }
    if (isFirstUpdate) {
      isFirstUpdate = false
      setTimeout(() => {
        contentUpdated = false
      })
      return
    }
    if (!val) {
      clearAutoSaveInterval()
      return
    }
    autoSaveInterval = setInterval(() => {
      saveContent()
      contentUpdated = false
      clearAutoSaveInterval()
    }, autoSave.interval)
  },
)

watch(
  () => editor.value,
  () => {
    if (!editor.value) {
      return
    }
    editor.value.on('create', ({ editor }) => {
      destroyed.value = false
      emits('created', { editor })
      // 评论功能：加载评论列表 + 连接 SSE
      if (commentsEnabled.value && options.value.document?.docId) {
        loadComments()
        connectSSE()
      }
      // 点击编辑器空白处时清除评论 active 高亮
      editor.view.dom.addEventListener('mousedown', () => {
        if (activeCommentId.value) commentsClearActive()
      })
      // 协同模式：从 yUndoPlugin 的 plugin state 取出 Yjs UndoManager，
      // 绕过 extension-collaboration 坏掉的 undo/redo 命令（Tiptap3 preventDispatch bug），
      // 后续 undoHistory/redoHistory 直接调 undoManager.undo()/redo()。
      // 同时监听栈变化事件，刷新 collabCanUndo/Redo 供按钮 disabled 判断。
      // 必须用 y-tiptap 导出的同一个 yUndoPluginKey 实例取 state——
      // 不能 new PluginKey('y-undo') 重建：createKey 是模块级计数器，
      // 重建会得到 'y-undo$1' 而真正注册的是 'y-undo$'，getState 永远返回 undefined。
      if (options.value.disableExtensions.includes('undoRedo')) {
        const um = yUndoPluginKey.getState(editor.state)?.undoManager
        if (um) {
          collabUndoManager.value = um
          const refresh = () => {
            collabCanUndo.value = um.undoStack.length > 0
            collabCanRedo.value = um.redoStack.length > 0
          }
          refresh()
          um.on('stack-item-added', refresh)
          um.on('stack-item-popped', refresh)
          um.on('stack-item-updated', refresh)
          um.on('stack-cleared', refresh)
        }
        // [Bug A 修复] UndoManager 的 trackedOrigins 里登记的 ySyncPluginKey 实例
        // 与 _prosemirrorChanged 开事务时实际用的 ySyncPluginKey 实例不一致
        // （两者 .key 均为 'y-sync$' 但不是同一对象引用——疑似 Vite 预构建或模块解析
        // 导致 y-tiptap 的 PluginKey 存在两个实例）。Set.has 用引用相等判断，
        // 导致 UndoManager.afterTransactionHandler 的 origin 检查永远 false，操作不进 undo 栈。
        // 修复：在 beforeTransaction（事务执行前）捕获实际 origin 实例，补登记进 trackedOrigins。
        try {
          const ySyncKey = editor.view.state.plugins.find((p) => p.key === 'y-sync$')
          const binding = ySyncKey?.getState(editor.view.state)?.binding
          if (binding?.doc) {
            binding.doc.on('beforeTransaction', (tx) => {
              if (tx.origin?.key === 'y-sync$' && !um.trackedOrigins.has(tx.origin)) {
                um.trackedOrigins.add(tx.origin)
              }
            })
          }
        } catch (e) {
          console.warn('[collab] 注册 trackedOrigins 修复失败:', e)
        }
      }
    })
    editor.value.on('update', ({ editor }) => {
      emits('changed', { editor })
      contentUpdated = true
    })
    editor.value.on('selectionUpdate', ({ editor }) => {
      emits('changed:selection', { editor })
    })
    editor.value.on('transaction', ({ editor, transaction }) => {
      emits('changed:transaction', { editor, transaction })
    })
    editor.value.on('focus', ({ editor, event }) => {
      emits('focus', { editor, event })
    })
    editor.value.on('blur', ({ editor, event }) => {
      emits('blur', { editor, event })
    })
    editor.value.on('paste', ({ event, slice }) => {
      emits('paste', { event, slice })
    })
    editor.value.on('drop', ({ event, slice, moved }) => {
      emits('drop', { event, slice, moved })
    })
    editor.value.on(
      'delete',
      ({
        type,
        deletedRange,
        newRange,
        partial,
        node,
        mark,
        from,
        to,
        newFrom,
        newTo,
      }) => {
        emits('delete', {
          type,
          deletedRange,
          newRange,
          partial,
          node,
          mark,
          from,
          to,
          newFrom,
          newTo,
        })
      },
    )
    editor.value.on('destroy', () => {
      emits('destroy')
      // 评论功能：关闭 SSE 连接
      commentsDispose()
    })
  },
)

watch(
  () => $toolbar.value,
  (toolbar, oldToolbar) => {
    emits('changed:toolbar', { toolbar, oldToolbar })
  },
  { deep: true },
)

watch(
  () => page.value.layout,
  (pageLayout, oldPageLayout) => {
    if (pageLayout === oldPageLayout) {
      return
    }
    emits('changed:pageLayout', { pageLayout, oldPageLayout })
    addHistory(historyRecords, 'page', {
      proType: 'layout',
      newData: pageLayout,
      oldData: oldPageLayout,
    })
    if (pageLayout === 'web') {
      setSkin('default')
    }
    $layout.value = pageLayout
  },
)

watch(
  () => page.value.size,
  (pageSize, oldPageSize) => {
    emits('changed:pageSize', { pageSize, oldPageSize })
    addHistory(historyRecords, 'page', {
      proType: 'size',
      newData: pageSize,
      oldData: oldPageSize,
    })
  },
  { deep: true },
)

watch(
  () => page.value.margin,
  (pageMargin, oldPageMargin) => {
    emits('changed:pageMargin', { pageMargin, oldPageMargin })
    addHistory(historyRecords, 'page', {
      proType: 'margin',
      newData: pageMargin,
      oldData: oldPageMargin,
    })
  },
  { deep: true },
)

watch(
  () => page.value.background,
  (pageBackground, oldPageBackground) => {
    emits('changed:pageBackground', { pageBackground, oldPageBackground })
    addHistory(historyRecords, 'page', {
      proType: 'background',
      newData: pageBackground,
      oldData: oldPageBackground,
    })
  },
)

watch(
  () => page.value.orientation,
  (pageOrientation, oldPageOrientation) => {
    emits('changed:pageOrientation', { pageOrientation, oldPageOrientation })
    addHistory(historyRecords, 'page', {
      proType: 'orientation',
      newData: pageOrientation,
      oldData: oldPageOrientation,
    })
  },
)

watch(
  () => page.value.showToc,
  (showToc) => {
    emits('changed:pageShowToc', showToc)
  },
)

watch(
  () => page.value.zoomLevel,
  (zoomLevel, oldZoomLevel) => {
    emits('changed:pageZoom', { zoomLevel, oldZoomLevel })
    addHistory(historyRecords, 'page', {
      proType: 'zoomLevel',
      newData: zoomLevel,
      oldData: oldZoomLevel,
    })
  },
)

watch(
  () => page.value.preview?.enabled,
  (previewEnabled) => {
    emits('changed:pagePreview', previewEnabled)
    try {
      setTimeout(() => {
        const containerEl = document.querySelector(
          `${container} .umo-zoomable-container`,
        )
        containerEl.scrollTop = 0
      }, 200)
    } catch {}
  },
)

watch(
  () => page.value.watermark,
  (pageWatermark, oldPageWatermark) => {
    emits('changed:pageWatermark', { pageWatermark, oldPageWatermark })
    // 增加水印撤回
    addHistory(historyRecords, 'page', {
      proType: 'watermark',
      newData: pageWatermark,
      oldData: oldPageWatermark,
    })
  },
  { deep: true },
)

watch(
  () => printing.value,
  () => {
    emits('print')
  },
  { deep: true },
)

// i18n Setup
const { t, locale, mergeLocaleMessage } = useI18n()
const $locale = useStorage('umo-editor:locale', options.value.locale)
locale.value = $locale.value
consoleCopyright()
const getLocaleMessage = (lang) => {
  const translations = options.value.translations?.[lang.replaceAll('-', '_')]
  if (isRecord(translations)) {
    return translations
  }
  return {}
}
mergeLocaleMessage(locale.value, getLocaleMessage(locale.value))
const { appContext } = getCurrentInstance()
if (appContext) {
  appContext.config.globalProperties.t = t
  appContext.config.globalProperties.l = l
}
watch(
  () => locale.value,
  (locale, oldLocale) => {
    emits('changed:locale', { locale, oldLocale })
  },
)

// Global Locale Config
const localeConfig = $ref({
  'zh-CN': cnConfig,
  'en-US': enConfig,
})

// Options Setup
const setOptions = (value) => {
  try {
    options.value = getOptions(value, defaultOptions)
    const $locale = useStorage('umo-editor:locale', options.value.locale)
    if (!$locale.value) {
      $locale.value = options.value.locale
    }
  } catch {}
  return options.value
}

// Theme Setup
const setTheme = (theme) => {
  if (!isString(theme) || !['light', 'dark', 'auto'].includes(theme)) {
    throw new Error('"theme" must be one of "light", "dark" or "auto".')
  }
  if (theme !== 'auto') {
    document.querySelector('html')?.setAttribute('theme-mode', theme)

    const $theme = useStorage('umo-editor:theme', options.value.theme)
    $theme.value = theme
    emits('changed:theme', theme)
    return
  }
  const darkScheme = '(prefers-color-scheme: dark)'
  const prefersDarkScheme = window.matchMedia(darkScheme).matches
  setTheme(prefersDarkScheme ? 'dark' : 'light')
  window.matchMedia(darkScheme).addEventListener('change', (e) => {
    setTheme(e.matches ? 'dark' : 'light')
  })
}

// Skin Setup
const setSkin = (skin) => {
  if (!isString(skin) || !['modern', 'default'].includes(skin)) {
    throw new Error('"skin" must be one of "modern" or "default".')
  }
  const $skin = useStorage('umo-editor:skin', options.value.skin)
  $skin.value = skin
  options.value.skin = skin
  emits('changed:skin', skin)
}

// Toolbar and Page Setup Methods
const setToolbar = (params) => {
  if (!isRecord(params)) {
    throw new Error('params must be an object.')
  }
  if (params.mode) {
    if (!isString(params.mode)) {
      throw new Error('"params.mode" must be a string.')
    }
    if (!['classic', 'ribbon'].includes(params.mode)) {
      throw new Error('"params.mode" must be one of "classic" or "ribbon".')
    }
    $toolbar.value.mode = params.mode
  }
  if (isDefined(params.show)) {
    if (!isBoolean(params.show)) {
      throw new Error('"params.show" must be a boolean.')
    }
    $toolbar.value.show = params.show
  }
}

const setLayout = (layout) => {
  if (!options.value.page.layouts.includes(layout)) {
    throw new Error(
      `"params.layout" must be one of ${JSON.stringify(options.value.page.layouts)}.`,
    )
  }
  page.value.layout = layout
}

const setPage = (params) => {
  if (!isRecord(params)) {
    throw new Error('params must be an object.')
  }
  if (params.size) {
    if (!isString(params.size)) {
      throw new Error('"params.size" must be a string.')
    }
    const size = options.value.dicts?.pageSizes.find(
      (item) => item.label === params.size || l(item.label) === params.size,
    )
    if (!size) {
      throw new Error(
        `"params.size" must be one of ${options.value.dicts?.pageSizes.map((item) => l(item.label))}.`,
      )
    }
    page.value.size = size
  }
  if (params.orientation) {
    if (!isString(params.orientation)) {
      throw new Error('"params.orientation" must be a string.')
    }
    if (!['portrait', 'landscape'].includes(params.orientation)) {
      throw new Error(
        '"params.orientation" must be one of "portrait" or "landscape".',
      )
    }
    page.value.orientation = params.orientation
  }

  if (params.background) {
    if (!isString(params.background)) {
      throw new Error('"params.background" must be a string.')
    }
    page.value.background = params.background
  }

  if (params.layout) {
    if (!options.value.page.layouts.includes(params.layout)) {
      throw new Error(
        `"params.layout" must be one of ${JSON.stringify(options.value.page.layouts)}.`,
      )
    }
    page.value.layout = params.layout
  }

  if (params.margin) {
    const marginKeys = ['left', 'right', 'top', 'bottom']
    const copyMargin = { ...page.value.margin }
    for (const key of marginKeys) {
      if (params.margin[key] !== undefined) {
        if (!isNumber(params.margin[key])) {
          throw new Error(`"params.margin.${key}" must be a number.`)
        }
        copyMargin[key] = params.margin[key]
      }
    }
    page.value.margin = copyMargin
  }
}

const setWatermark = (params) => {
  if (!isRecord(params)) {
    throw new Error('params must be an object.')
  }
  page.value.watermark = {}

  if (isDefined(params.alpha)) {
    if (!isNumber(params.alpha)) {
      throw new Error('"params.alpha" must be a number.')
    }
    page.value.watermark.alpha = params.alpha
  }
  if (params.text) {
    if (!isString(params.text)) {
      throw new Error('"params.text" must be a string.')
    }
    if (params.text.length > 30) {
      throw new Error('"params.text" must be less than 30 characters.')
    }
    page.value.watermark.text = params.text
  }

  if (params.type) {
    if (!isString(params.type)) {
      throw new Error('"params.type" must be a string.')
    }
    if (!['compact', 'spacious'].includes(params.type)) {
      throw new Error('"params.type" must be one of "compact" or "spacious".')
    }
    page.value.watermark.type = params.type
  }
  if (params.fontColor) {
    if (!isString(params.fontColor)) {
      throw new Error('"params.fontColor" must be a string.')
    }
    page.value.watermark.fontColor = params.fontColor
  }
  if (params.fontSize) {
    if (!isNumber(params.fontSize)) {
      throw new Error('"params.fontSize" must be a number.')
    }
    page.value.watermark.fontSize = params.fontSize
  }
  if (params.fontFamily || params.fontFamily === null) {
    if (params.fontFamily !== null && !isString(params.fontFamily)) {
      throw new Error('"params.fontFamily" must be a string.')
    }
    page.value.watermark.fontFamily = params.fontFamily
  }
  if (params.fontWeight) {
    if (!isString(params.fontWeight)) {
      throw new Error('"params.fontWeight" must be a string.')
    }
    if (!['normal', 'bold', 'bolder'].includes(params.fontWeight)) {
      throw new Error(
        '"params.fontWeight" must be one of "normal", "bold" or "bolder".',
      )
    }
    page.value.watermark.fontWeight = params.fontWeight
  }
}

const setDocument = (params) => {
  if (!isRecord(params)) {
    throw new Error('params must be an object.')
  }
  Object.keys(params).forEach((key) => {
    options.value.document[key] = params[key]
    $document.value[key] = params[key]
  })
}

// Content Methods
const setContent = (
  content,
  options = {
    emitUpdate: true,
    focusPosition: null,
    focusOptions: { scrollIntoView: true },
  },
) => {
  if (!editor.value) {
    throw new Error('editor is not ready!')
  }
  const doc = contentTransform(content)
  editor.value
    .chain()
    .setContent(doc, { emitUpdate: options.emitUpdate })
    .focus(options.focusPosition, options.focusOptions)
    .run()
}

// Content Methods
const insertContent = (
  content,
  options = {
    updateSelection: true,
    focusPosition: 'start',
    focusOptions: { scrollIntoView: true },
  },
) => {
  if (!editor.value) {
    throw new Error('editor is not ready!')
  }
  const doc = contentTransform(content)
  editor.value
    .chain()
    .insertContent(doc, { updateSelection: options.updateSelection })
    .focus(options.focusPosition, options.focusOptions)
    .run()
}

const startTypewriter = (content, options) => {
  if (!editor.value) {
    throw new Error('editor is not ready!')
  }
  if (typeof content !== 'object') {
    throw new Error('content is not object!')
  }
  setTimeout(() => {
    editor?.value?.commands.focus('end')
    editor?.value?.commands.startTypewriter(content, options)
  }, 100)
}

const stopTypewriter = () => {
  editor?.value?.commands.stopTypewriter()
}

const getTypewriterState = () => {
  return editor?.value?.commands.getTypewriterState()
}

const getContent = (format = 'html') => {
  if (!editor.value) {
    throw new Error('editor is not ready!')
  }
  if (format === 'html') {
    return editor.value.getHTML()
  }
  if (format === 'text') {
    return editor.value.getText()
  }
  if (format === 'json') {
    return editor.value.getJSON()
  }
  throw new Error('format must be html, text or json')
}

// Locale Methods
const setLocale = (lang, silent = true) => {
  if (!['zh-CN', 'en-US'].includes(lang)) {
    throw new Error('"params" must be one of "zh-CN" or "en-US".')
  }
  if (locale.value === lang) {
    return
  }
  if (silent) {
    $locale.value = lang
    location.reload()
    return
  }
  const dialog = useConfirm({
    attach: container,
    theme: 'warning',
    header: t('changeLocale.title'),
    body: t('changeLocale.message'),
    confirmBtn: {
      theme: 'warning',
      content: t('changeLocale.confirm'),
    },
    onConfirm() {
      dialog.destroy()
      setTimeout(() => setLocale(lang), 300)
    },
  })
}

const getLocale = () => locale.value
const getI18n = () => i18n

// Export Methods
const getImage = async (format = 'blob') => {
  const { zoomLevel } = page.value
  try {
    page.value.zoomLevel = 100
    const node = document.querySelector(`${container} .umo-page-content`)
    if (format === 'blob') {
      return await toBlob(node)
    }
    if (format === 'jpeg') {
      return await toJpeg(node)
    }
    if (format === 'png') {
      return await toPng(node)
    }
  } catch {
    throw new Error(t('export.image.error.message'))
  } finally {
    page.value.zoomLevel = zoomLevel
  }
}

// Editor Interaction Methods
const getText = () => getContent('text')
const getHTML = () => getContent('html')
const getJSON = () => getContent('json')
const getVanillaHTML = async () => {
  if (!editor.value) {
    throw new Error('editor is not ready!')
  }

  // 克隆页面内容
  const { readOnly } = options.value.document
  const { isEditable } = editor.value
  if (!readOnly) {
    options.value.document.readOnly = true
  }
  await nextTick()
  const pageNode = document
    .querySelector(`${container} .umo-page-content`)
    ?.cloneNode(true)
  if (!readOnly) {
    options.value.document.readOnly = false
  }

  const replaceIcons = (nodes, size = '1em') => {
    const iconsNode = document.querySelector('#umo-icons')
    nodes.forEach((el) => {
      const icons = el.querySelectorAll('.umo-icon')
      icons.forEach((svg) => {
        const iconId = svg.childNodes[0].getAttribute('xlink:href')
        svg.setAttribute('viewBox', '0 0 48 48')
        svg.setAttribute('fill', 'none')
        svg.setAttribute('width', size)
        svg.setAttribute('height', size)
        svg.innerHTML = iconsNode?.querySelector(iconId)?.innerHTML || ''
      })
    })
  }

  // 移除所有换行和回车标记
  const breakNodes = pageNode.querySelectorAll(
    '.tiptap-invisible-character, .ProseMirror-separator',
  )
  breakNodes.forEach((el) => el.remove())

  // 如果存在视频或音频节点，则替换视频标签
  const mediaNodes = pageNode.querySelectorAll(
    '.umo-node-video, .umo-node-audio',
  )
  mediaNodes.forEach((el) => {
    const mediaNode = el.querySelector('video, audio')
    if (mediaNode) el.querySelector('.plyr')?.replaceWith(mediaNode)
  })

  // 如果存在文件节点，替换文件节点图标
  const fileNodes = pageNode.querySelectorAll('.umo-node-file')
  replaceIcons(fileNodes)

  // 代码块处理
  const codeBlockNodes = pageNode.querySelectorAll('.umo-code-block')
  codeBlockNodes.forEach((el) => {
    const wordWrapButton = el.querySelector('.umo-word-wrap-button')
    if (wordWrapButton) {
      wordWrapButton.remove()
    }
    const buttonNodes = el.querySelectorAll('.umo-button-text')
    buttonNodes.forEach((item) => item.remove())
  })
  replaceIcons(codeBlockNodes, '16px')

  // 图表处理
  const chartNodes = pageNode.querySelectorAll('.umo-node-echarts')
  chartNodes.forEach((el) => {
    const chartNode = el.querySelector('.umo-node-echarts-body')
    if (chartNode) {
      chartNode.removeAttribute('_echarts_instance_')
      chartNode.innerHTML = ''
    }
  })

  // 公式样式
  const mathNodes = pageNode.querySelectorAll('.tiptap-mathematics-render')
  mathNodes.forEach((el) => {
    const katexEl = el.querySelector('.katex')
    if (katexEl) {
      katexEl.innerHTML = katexEl.querySelector('.katex-html')?.innerHTML || ''
    }
  })

  // 如果水印为空，则移除水印
  if (page.value.watermark.text === '') {
    const watermarkNode = pageNode.lastElementChild
    if (
      watermarkNode &&
      !watermarkNode?.classList?.contains('umo-page-node-footer')
    ) {
      watermarkNode.remove()
    }
  }

  // 移除菜单
  const menuNodes = pageNode.querySelector('.umo-block-menu-drag-handle')
  if (menuNodes) {
    menuNodes.remove()
  }

  // 移除所有 html 注释
  const htmlContent = pageNode.outerHTML.replace(/<!--[\s\S]*?-->/g, '')

  // 返回处理后的 html 内容
  return htmlContent
}

const focus = (position = 'start', options = { scrollIntoView: true }) =>
  editor.value?.commands.focus(position, options)

const blur = () => editor.value?.chain().blur().run()

const print = () => {
  if (
    options.value.disableExtensions.includes('print') ||
    editor.value?.isEmpty
  ) {
    return
  }
  if (!options.value?.readOnly) {
    printing.value = true
  }
}

const toggleFullscreen = (isFullscreen) => {
  if (isFullscreen !== undefined) {
    if (!isBoolean(isFullscreen)) {
      throw new Error('"isFullscreen" must be a boolean.')
    }
    fullscreen.value = isFullscreen
    return
  }
  fullscreen.value = !fullscreen.value
}

const reset = (silent) => {
  const resetLocalStorage = () => {
    const keys = Object.keys(localStorage)
    const umoEditorKeys = keys.filter((key) => key.startsWith('umo-editor:'))
    umoEditorKeys.forEach((key) => localStorage.removeItem(key))
    location.reload()
  }
  if (silent) {
    resetLocalStorage()
    return
  }
  const dialog = useConfirm({
    attach: container,
    theme: 'warning',
    header: t('resetAll.title'),
    body: t('resetAll.message'),
    confirmBtn: {
      theme: 'warning',
      content: t('resetAll.reset'),
    },
    onConfirm() {
      dialog.destroy()
      resetLocalStorage()
    },
  })
}

const destroy = () => {
  editor.value?.unmount()
  removeAllHotkeys()
  destroyed.value = true
}

// Content Saving Methods
const saveContent = async (showMessage = true) => {
  if (options.value.document?.readOnly) {
    return
  }
  if (editor.value) {
    // 保存前先同步一份最新内容，避免 onSave 第三个参数读取到旧值
    $document.value.content = editor.value.getHTML()
  }
  const saveBack = {
    status: '', // 可选值：'success' | 'error'  // 状态描述文本（用于前端提示或日志）
    message: '', // 例如：'保存失败：网络异常'
    showMessage: true, // 是否展示message
  }
  try {
    isSaving = true
    useMessage(
      'loading',
      {
        attach: container,
        content: t('save.saving'),
        placement: 'bottom',
        closeBtn: true,
        duration: 0, // 需要手工关闭，不会自动关闭了
        offset: [0, -20],
      },
      getCurrentInstance(),
    )
    const _saveBack = await options.value?.onSave?.(
      {
        html: editor.value?.getHTML(),
        json: editor.value?.getJSON(),
        text: editor.value?.getText(),
      },
      page.value,
      $document.value,
    )
    if (!_saveBack) {
      throw new Error('`onSave` callback must return a value.')
    }
    // 兼容老的保存回调
    if (typeof _saveBack === 'string') {
      if (_saveBack) {
        saveBack.status = 'success'
        saveBack.message = _saveBack
      } else {
        saveBack.status = 'error'
        saveBack.message = _saveBack
      }
    } else {
      for (const key in _saveBack) {
        saveBack[key] = _saveBack[key]
      }
      // 没有返回这个
      if (_saveBack['showMessage'] === undefined) {
        saveBack['showMessage'] = showMessage
      }
    }
    MessagePlugin.closeAll()
    if (saveBack.status === 'error') {
      if (saveBack.showMessage) {
        useMessage('error', {
          attach: container,
          content: saveBack.message || t('save.failed'),
          placement: 'bottom',
          offset: [0, -20],
        })
      }
      return
    }
    emits('saved')
    contentUpdated = false
    if (saveBack.showMessage) {
      useMessage('success', {
        attach: container,
        content: saveBack.message || t('save.success'),
        placement: 'bottom',
        offset: [0, -20],
      })
    }
    const time = useTimestamp({ offset: 0 })
    savedAt.value = time.value
  } catch (error) {
    MessagePlugin.closeAll()
    if (saveBack.showMessage) {
      useMessage('error', {
        attach: container,
        content: error?.message ? error.message : t('save.error'),
        placement: 'bottom',
        offset: [0, -20],
      })
    }
    console.error(error?.message)
  } finally {
    isSaving = false
  }
}
const getAllBookmarks = () => {
  let bookmarkData
  editor.value?.commands.getAllBookmarks(function (_data) {
    bookmarkData = _data
  })
  return bookmarkData
}
const focusBookmark = (bookmarkName) => {
  return editor.value?.commands.focusBookmark(bookmarkName)
}
const setBookmark = (bookmarkName) => {
  return editor.value?.commands.setBookmark({ bookmarkName })
}
const deleteBookmark = (bookmarkName) => {
  if (!bookmarkName) {
    return false
  }
  const element = editor.value?.view.dom.querySelector(
    `bookmark[bookmarkName="${bookmarkName}"]`,
  )
  if (!element) {
    return false
  }
  const pos = editor.value?.view.posAtDOM(element, 0)
  const { tr } = editor.value?.view.state || {}
  if (!tr) {
    return false
  }
  const marks = editor.value?.view.state.doc.resolve(pos + 1)?.marks()
  if (marks !== null && marks.length > 0) {
    for (const mark of marks) {
      if (mark.type.name === 'bookmark') {
        editor.value?.view.dispatch(
          tr.removeMark(pos, pos + element.outerText.length, mark),
        )
      }
    }
  } else {
    editor.value?.view.dispatch(
      tr.removeMark(pos, pos + element.outerText.length),
    )
  }
  return true
}
// Content Excerpt Methods
const getContentExcerpt = (charLimit = 100, more = ' ...') => {
  const text = editor.value?.getText()
  if (text?.length === 0) {
    return ''
  }
  return text?.substring(0, charLimit) + more
}
/* 撤销 重做操作*/
// 协同模式下编辑器内容的撤销/重做由 Yjs UndoManager 接管（undoRedo 扩展已禁用，
// historyRecords 队列里不再有 editor 记录）。
// 注意：不能用 editor.commands.undo()/redo()——@tiptap/extension-collaboration
// 的 undo/redo 命令在 Tiptap3 下因 tr.setMeta('preventDispatch', true) 导致
// dispatch 为 undefined，命中 `if (!dispatch) return true`，undo(state) 永不执行（上游 bug）。
// 故直接从 yUndoPlugin state 取出 undoManager，调其 undo()/redo()。
// page 类历史（页边距、水印等）不受协同影响，仍走 Umo 自建队列弹栈。
const isCollab = () => options.value.disableExtensions.includes('undoRedo')

const undoHistory = () => {
  if (isCollab()) {
    // page 记录仍由 Umo 队列管理；队首是 page 时先弹栈处理 page
    if (historyRecords.value.done.length > 0) {
      undoHistoryRecord(historyRecords, function (record) {
        if (record?.type === 'page' && record?.proType) {
          if (page?.value && record.oldData !== undefined) {
            page.value[record.proType] = record.oldData
          }
        }
      })
      return
    }
    // 否则直接调 Yjs UndoManager 撤销编辑器内容（绕过坏掉的命令）
    collabUndoManager.value?.undo()
    return
  }
  undoHistoryRecord(historyRecords, function (record) {
    if (record?.type === 'editor') {
      editor?.value?.chain().focus().undo().run()
    } else if (record?.type === 'page' && record?.proType) {
      // 撤销
      if (page?.value && record.oldData !== undefined) {
        page.value[record.proType] = record.oldData
      }
    }
  })
}
const redoHistory = () => {
  if (isCollab()) {
    if (historyRecords.value.undone.length > 0) {
      redoHistoryRecord(historyRecords, function (record) {
        if (record?.type === 'page' && record?.proType) {
          if (page?.value && record.newData !== undefined) {
            page.value[record.proType] = record.newData
          }
        }
      })
      return
    }
    // 直接调 Yjs UndoManager 重做（绕过坏掉的命令）
    collabUndoManager.value?.redo()
    return
  }
  redoHistoryRecord(historyRecords, function (record) {
    if (record?.type === 'editor') {
      editor?.value?.chain().focus().redo().run()
    } else if (record?.type === 'page' && record?.proType) {
      //  恢复
      if (page?.value && record.newData !== undefined) {
        page.value[record.proType] = record.newData
      }
    }
  })
}

// Hotkeys Setup
watch(
  () => editor.value,
  () => {
    const unsetFormatPainter = () => editor.value?.commands.unsetFormatPainter()
    const bindEscKey = () => {
      useHotkeys('esc', () => {
        if (page.value.preview) {
          page.value.preview.enabled = false
        }
        if (fullscreen.value) {
          fullscreen.value = false
        }
      })
    }
    const bindUndoRedoKey = () => {
      useHotkeys('ctrl+z, command+z', () => {
        undoHistory()
      })
      useHotkeys('ctrl+y, command+y', () => {
        redoHistory()
      })
    }
    editor.value?.on('focus', () => {
      useHotkeys('esc', unsetFormatPainter)
      useHotkeys('ctrl+s,command+s', () => {
        if (options?.value?.toolbar?.showSaveLabel) {
          saveContent()
          unsetFormatPainter()
        }
      })
      useHotkeys('ctrl+p,command+p', () => {
        print()
        unsetFormatPainter()
      })
      useHotkeys('ctrl+f, command+f', () => {
        searchReplace.value = true
      })
    })
    bindEscKey()
    bindUndoRedoKey()
    editor.value?.on('blur', () => {
      removeAllHotkeys()
      bindEscKey()
      bindUndoRedoKey()
    })
  },
)

// Methods Exposed to Descendants
provide('saveContent', saveContent)

provide('setTheme', setTheme)
provide('setSkin', setSkin)
provide('setLocale', setLocale)
provide('reset', reset)
provide('getVanillaHTML', getVanillaHTML)
provide('undoHistory', undoHistory)
provide('redoHistory', redoHistory)
// Exposing Methods
defineExpose({
  getOptions: () => options.value,
  setOptions,
  setToolbar,
  setLayout,
  setPage,
  setWatermark,
  setDocument,
  setContent,
  insertContent,
  startTypewriter,
  stopTypewriter,
  getTypewriterState,
  setLocale,
  setTheme,
  setSkin,
  getPage: () => page.value,
  getContent,
  getImage,
  getText,
  getHTML,
  getJSON,
  getVanillaHTML,
  saveContent,
  getContentExcerpt,
  getEditor: () => editor,
  useEditor: () => editor.value,
  // 评论功能 API
  getComments: () => comments.value,
  toggleCommentPanel: commentTogglePanel,
  getTableOfContents: () => editor.value?.storage.tableOfContents.content,
  getSelectionText: () => (editor.value ? getSelectionText(editor.value) : ''),
  getSelectionNode: () =>
    editor.value ? getSelectionNode(editor.value) : null,
  deleteSelectionNode: () => editor.value?.commands.deleteSelectionNode(),
  setCurrentNodeSelection: () =>
    editor.value?.commands.setCurrentNodeSelection(),
  getLocale,
  getI18n,
  setReadOnly(readOnly = true) {
    if (options.value.document) {
      options.value.document.readOnly = readOnly
    }
  },
  print,
  focus,
  blur,
  toggleFullscreen,
  reset,
  destroy,
  focusBookmark,
  getAllBookmarks,
  setBookmark,
  deleteBookmark,
  useAlert(pramas) {
    return useAlert({ attach: container, ...pramas })
  },
  useConfirm(pramas) {
    return useConfirm({ attach: container, ...pramas })
  },
  useMessage(type, pramas) {
    return useMessage(type, { attach: container, ...pramas })
  },
})
</script>

<style lang="less">
@import '@/assets/styles/index.less';

// ============ 评论 Mark 样式 ============
.umo-editor-container {
  .umo-comment-mark {
    background-color: rgba(77, 142, 224, 0.15);
    border-radius: 2px;
    transition: background-color 0.15s;
    cursor: pointer;
    &.resolved {
      background-color: rgba(0, 0, 0, 0.05);
      color: var(--umo-text-color-light);
      text-decoration: line-through;
    }
  }
  .umo-comment-active {
    background-color: rgba(77, 142, 224, 0.3) !important;
    box-shadow: 0 0 0 2px rgba(77, 142, 224, 0.2);
  }
}

.umo-editor-container {
  --td-brand-color: var(--umo-primary-color);
  --td-warning-color: var(--umo-warning-color);
  --td-error-color: var(--umo-error-color);
  --td-text-color-primary: var(--umo-text-color);
  --td-text-color-disabled: var(--umo-text-color-disabled);
  width: 100%;
  height: 100%;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  color: var(--umo-text-color);
  font-family: var(--umo-font-family);
  position: relative !important;
  background-color: var(--umo-container-background);
  .umo-footer {
    background-color: var(--umo-color-white);
  }
  &.umo-skin-default {
    .umo-toolbar {
      border-bottom: solid 1px var(--umo-border-color);
      background-color: var(--umo-color-white);
    }
  }
  &.umo-skin-default {
    .umo-toolbar {
      background-color: var(--umo-color-white);
    }
  }
  .umo-main {
    flex: 1;
    background-color: var(--umo-container-background);
    overflow: hidden;
  }
  &.preview-mode {
    &.laser-pointer {
      .umo-main,
      .umo-main * {
        cursor: url('@/assets/images/laser-pointer.svg'), auto !important;
      }
    }
    .umo-toolbar {
      display: none;
    }
    .umo-page-container {
      padding: 45px 0;
    }
  }
  &.umo-editor-is-fullscreen {
    position: fixed !important;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
  }
  &.umo-editor-is-typerwriter-runing {
    pointer-events: none;
  }
}
</style>
