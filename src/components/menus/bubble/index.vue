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
// 是否允许评论（评论功能启用 且 角色非 viewer）。
// commenter（readOnly）也需要弹出气泡菜单来评论；viewer 不弹。
const canComment = inject('canComment', ref(false))

// 自定义 shouldShow：让 commenter 模式（readOnly）也能弹出气泡菜单
// Tiptap BubbleMenu 默认在 !editor.isEditable 时不显示，
// 当 canComment 为 true 时，commenter 选中文本也弹出（菜单中只有评论按钮可见）
// viewer（canComment=false）不弹出
const shouldShow = ({ editor: ed, state }) => {
  const { selection } = state
  // 空选区不显示
  if (selection.empty) return false
  // 编辑器可编辑时正常显示（原始行为）
  if (ed.isEditable) return true
  // commenter 模式：可评论时显示气泡菜单（仅评论按钮）
  return canComment.value
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
