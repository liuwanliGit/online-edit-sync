/**
 * 评论 Mark 扩展（用 Tiptap Mark 锚定评论位置）
 * -----------------------------------------------------------
 * 选中文字 → editor.chain().setMark('comment', { commentId }).run()
 * 被评论的文字渲染为 <span class="umo-comment-mark" data-comment-id="xxx">
 *
 * Mark 是 ProseMirror 原生机制：文字增删时 mark 自动跟随，协同编辑通过 Yjs
 * 自动同步 mark，刷新页面后 mark 随 Yjs 文档恢复——彻底取代 {from,to} 位置方案。
 *
 * 属性：
 *   commentId  评论 UUID（与后端评论 id 一一对应）
 *   resolved   是否已解决（已解决的 mark 渲染为灰色）
 *
 * inclusive: false —— 光标在 mark 内输入新文字时不自动继承 mark（避免新内容被误标）
 */
import { Mark } from '@tiptap/core'

export const Comment = Mark.create({
  name: 'comment',

  inclusive: false,

  excludes: '', // 允许与其他 mark 共存（加粗、斜体等）

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) => {
          if (!attributes.commentId) return {}
          return { 'data-comment-id': attributes.commentId }
        },
      },
      resolved: {
        default: false,
        parseHTML: (element) => element.classList.contains('resolved'),
        renderHTML: (attributes) => {
          if (!attributes.resolved) return {}
          return { class: 'resolved' }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-comment-id]',
        getAttrs: (element) => {
          const id = element.getAttribute('data-comment-id')
          return id ? null : false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    // HTMLAttributes 已包含 addAttributes 的 renderHTML 输出（data-comment-id、class:resolved）。
    // 合并 class：始终带 umo-comment-mark，保留 resolved（如有）。
    const existingClass = HTMLAttributes.class || ''
    const merged = existingClass
      ? `umo-comment-mark ${existingClass}`
      : 'umo-comment-mark'
    return ['span', { ...HTMLAttributes, class: merged }, 0]
  },
})
