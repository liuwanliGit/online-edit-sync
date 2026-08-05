<template>
  <menus-button
    ico="redo"
    :text="t('base.redo')"
    shortcut="Ctrl+Y / Ctrl+Shift+Z"
    hide-text
    :disabled="isCollab ? !collabCanRedo : historyRecords.undone.length === 0"
    @menu-click="menuClick"
  />
</template>

<script setup>
/* 重做*/
const options = inject('options')
const historyRecords = inject('historyRecords')
const collabCanRedo = inject('collabCanRedo')

const menuClick = inject('redoHistory')
// 协同模式下重做能力来自 Yjs UndoManager，由 collabCanRedo 反映；
// 单机模式仍用 Umo 自建历史队列长度判断。
const isCollab = computed(() =>
  options.value.disableExtensions.includes('undoRedo'),
)
</script>
