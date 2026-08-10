/**
 * 评论高亮扩展（active 驱动的 ProseMirror decoration）
 * -----------------------------------------------------------
 * - 默认不在正文中渲染任何评论标记
 * - 仅当 activeCommentId 命中某条 active 评论时，为该评论当前 {from,to}
 *   生成一条 Decoration.inline 高亮
 * - decoration 是只读叠加层，不修改 doc → editor/viewer 通用，绕开引擎 viewer 限制
 *
 * activeCommentId 变化时需由外层 dispatch 一个空 tr 触发 decorations 重算
 * （见 App.vue 的 watch(activeCommentId)）。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const commentHighlightKey = new PluginKey('commentHighlight')

export const CommentHighlight = Extension.create({
  name: 'commentHighlight',
  addOptions() {
    return {
      getActiveComment: () => null, // () => string | null
      getComments: () => [], // () => Comment[]
    }
  },
  addProseMirrorPlugins() {
    const { getActiveComment, getComments } = this.options
    return [
      new Plugin({
        key: commentHighlightKey,
        props: {
          decorations(state) {
            const activeId = getActiveComment()
            if (!activeId) return DecorationSet.empty
            const c = getComments().find(
              (x) => x.id === activeId && x.status !== 'stale',
            )
            if (!c) return DecorationSet.empty
            const size = state.doc.content.size
            const from = Math.max(0, Math.min(c.from, size))
            const to = Math.max(from, Math.min(c.to, size))
            if (from === to) return DecorationSet.empty
            return DecorationSet.create(state.doc, [
              Decoration.inline(from, to, { class: 'umo-comment-active' }),
            ])
          },
        },
      }),
    ]
  },
})
