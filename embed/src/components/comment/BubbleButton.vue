<template>
  <span v-if="hasTextSelection" class="umo-cmt-bubble-wrap">
    <span class="umo-bubble-menu-divider"></span>
    <button
      class="umo-cmt-bubble-btn"
      title="添加评论"
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

function onClick() {
  if (!editor?.state) return
  const { from, to, empty } = editor.state.selection
  if (empty) return
  const selectedText = editor.state.doc.textBetween(from, to, '\n').slice(0, 2000)
  emit('add', { from, to, selectedText })
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
.umo-cmt-bubble-btn:hover {
  background: var(--umo-bg-color-hover, #f2f2f2);
  color: var(--umo-primary-color, #4d8ee0);
}
</style>
