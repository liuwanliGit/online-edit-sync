<template>
  <span v-if="hasTextSelection" class="umo-cmt-bubble-wrap">
    <span class="umo-bubble-menu-divider"></span>
    <button
      class="umo-cmt-bubble-btn"
      title="添加评论"
      @mousedown.prevent="onMousedown"
      @click="onClick"
    >
      评论
    </button>
  </span>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  getEditor: { type: Function, required: true }, // () => Tiptap editor 实例
})
const emit = defineEmits(['add'])

// hasTextSelection 必须用 ref + 编辑器事件手动维护：
// editor.state.selection 是 ProseMirror 普通对象，不是 Vue 响应式数据，
// 用 computed 永远拿不到更新（这是之前按钮不显示的根因）。
const hasTextSelection = ref(false)
let editor = null

// 缓存点击瞬间的选区：mousedown 时浏览器可能折叠 DOM 选区，
// onClick 时 editor.state.selection 可能已经 empty。
// 在 mousedown（preventDefault 后）把 { from, to, text } 存下来，
// click 时直接用缓存值，不依赖实时 selection。
// from/to 仅用于 App.vue 定位 apply mark 的范围，不持久化到后端。
let cachedSelection = null

function refresh() {
  if (!editor?.state) {
    hasTextSelection.value = false
    return
  }
  hasTextSelection.value = !editor.state.selection.empty
}

function onSelectionUpdate() {
  refresh()
}

function onMousedown() {
  if (!editor?.state) return
  const { from, to, empty } = editor.state.selection
  if (empty) {
    cachedSelection = null
    return
  }
  const selectedText = editor.state.doc.textBetween(from, to, '\n').slice(0, 2000)
  cachedSelection = { from, to, selectedText }
}

function onClick() {
  // 优先用 mousedown 缓存的选区；兜底取实时选区
  const sel = cachedSelection || (() => {
    if (!editor?.state) return null
    const { from, to, empty } = editor.state.selection
    if (empty) return null
    const selectedText = editor.state.doc.textBetween(from, to, '\n').slice(0, 2000)
    return { from, to, selectedText }
  })()
  cachedSelection = null
  if (!sel) return
  // 客户端生成 commentId（用作 comment mark 的 data-comment-id + 后端评论主键）
  const commentId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `cmt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  emit('add', { commentId, ...sel })
}

function attach(ed) {
  detach()
  editor = ed
  if (!editor) return
  editor.on('selectionUpdate', onSelectionUpdate)
  refresh()
}

function detach() {
  if (editor && typeof editor.off === 'function') {
    editor.off('selectionUpdate', onSelectionUpdate)
  }
  editor = null
}

// 编辑器可能在组件挂载后才就绪，用 watch 跟踪 getEditor() 返回值。
// 注意：getter 必须对 null/undefined 全防御——bubble_menu 插槽会被 Umo Editor
// 在显示/隐藏时反复挂载卸载，组件挂载瞬间 getEditor 闭包里的 editorRef 可能
// 尚未绑定（editorRef.value 为 null），或 useEditor 方法尚未挂载。
// getter 里任何一处抛错都会让 Vue 的 flush 整个中断，报
// "Cannot read properties of null (reading 'value')"。
function safeGetEditor() {
  try {
    return props.getEditor?.()
  } catch {
    return null
  }
}

watch(safeGetEditor, (ed) => attach(ed), {
  immediate: true,
  flush: 'post',
})

onBeforeUnmount(detach)
</script>

<style scoped>
.umo-cmt-bubble-wrap {
  display: inline-flex;
  align-items: center;
}
.umo-bubble-menu-divider {
  width: 1px;
  border-right: solid 1px var(--umo-border-color-light, #e7e7e7);
  height: 16px;
  margin: 0 5px 0 0;
}
.umo-cmt-bubble-btn {
  border: none;
  background: transparent;
  color: var(--umo-text-color-primary, #333);
  font-size: 13px;
  cursor: pointer;
  padding: 0 6px;
  height: var(--td-comp-size-xs, 28px);
  line-height: 1;
  border-radius: var(--umo-radius, 3px);
  white-space: nowrap;
}
.umo-bubble-menu-btn:hover {
  background: var(--umo-bg-color-hover, #f2f2f2);
  color: var(--umo-primary-color, #4d8ee0);
}
</style>
