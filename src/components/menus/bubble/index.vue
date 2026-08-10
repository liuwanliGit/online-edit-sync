<template>
  <bubble-menu
    v-if="editor"
    class="umo-editor-bubble-menu"
    :editor="editor"
    :shouldShow="shouldShow"
  >
    <menus-bubble-menus v-if="options?.document?.enableBubbleMenu">
      <template #bubble_menu="props">
        <slot name="bubble_menu" v-bind="props" />
      </template>
    </menus-bubble-menus>
  </bubble-menu>
</template>

<script setup>
import { BubbleMenu } from '@tiptap/vue-3/menus'

const editor = inject('editor')
const options = inject('options')
// 评论功能是否启用（viewer 模式下也需要弹出气泡菜单来评论）
const commentsEnabled = inject('commentsEnabled', ref(false))

// 自定义 shouldShow：让 viewer 模式（readOnly）也能弹出气泡菜单
// Tiptap BubbleMenu 默认在 !editor.isEditable 时不显示，
// 当 comments 启用时，viewer 选中文本也弹出（菜单中只有评论按钮可见）
const shouldShow = ({ editor: ed, state }) => {
  const { selection } = state
  // 空选区不显示
  if (selection.empty) return false
  // 编辑器可编辑时正常显示（原始行为）
  if (ed.isEditable) return true
  // viewer 模式：评论启用时也显示气泡菜单
  return commentsEnabled.value
}
</script>

<style lang="less">
.umo-editor-bubble-menu {
  max-width: 620px;
  z-index: 110;
  border-radius: var(--umo-radius);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 8px 10px !important;
  box-shadow: var(--umo-shadow);
  border: 1px solid var(--umo-border-color);
  background-color: var(--umo-color-white);

  &:empty {
    display: none;
  }

  .umo-menu-button.show-text .umo-button-content .umo-button-text {
    display: none !important;
  }

  .umo-menu-button.huge {
    height: var(--td-comp-size-xs);
    min-width: unset;

    .umo-button-content {
      min-width: unset !important;

      .umo-icon {
        font-size: 16px;
        margin-top: 0;
      }
    }
  }
}
</style>
