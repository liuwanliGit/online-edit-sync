/**
 * 评论 active 高亮（Decoration 驱动）
 * -----------------------------------------------------------
 * Mark 本身已持久渲染底色（.umo-comment-mark），这里只负责 active 高亮：
 * 当 activeCommentId 命中文档中某条 comment mark 时，给该 range 叠加
 * Decoration.inline（class: umo-comment-active），让对应文字高亮加强。
 *
 * 遍历文档找含 comment mark 且 commentId 匹配的节点 range，生成 decoration。
 * decoration 是只读叠加层，不修改 doc → editor/viewer 通用。
 *
 * activeCommentId 变化时由外层 dispatch 空 tr 触发 decorations 重算。
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
    }
  },
  addProseMirrorPlugins() {
    const { getActiveComment } = this.options
    return [
      new Plugin({
        key: commentHighlightKey,
        props: {
          decorations(state) {
            const activeId = getActiveComment()
            if (!activeId) return DecorationSet.empty
            const decorations = []
            // 遍历文档，找 comment mark 的 commentId === activeId 的 range
            state.doc.descendants((node, pos) => {
              if (!node.isText) return
              const mark = node.marks.find(
                (m) => m.type.name === 'comment' && m.attrs.commentId === activeId,
              )
              if (mark) {
                decorations.push(
                  Decoration.inline(pos, pos + node.nodeSize, {
                    class: 'umo-comment-active',
                  }),
                )
              }
            })
            return decorations.length
              ? DecorationSet.create(state.doc, decorations)
              : DecorationSet.empty
          },
        },
      }),
    ]
  },
})
