<template>
  <menus-button
    ico="undo"
    :text="t('base.undo')"
    shortcut="Ctrl+Z"
    hide-text
    :disabled="isCollab ? !collabCanUndo : historyRecords.done.length === 0"
    @menu-click="menuClick"
  />
</template>

<script setup>
const options = inject('options')
const historyRecords = inject('historyRecords')
const collabCanUndo = inject('collabCanUndo')
const menuClick = inject('undoHistory')
// 协同模式下撤销能力来自 Yjs UndoManager，由 collabCanUndo 反映；
// 单机模式仍用 Umo 自建历史队列长度判断。
const isCollab = computed(() =>
  options.value.disableExtensions.includes('undoRedo'),
)
</script>
