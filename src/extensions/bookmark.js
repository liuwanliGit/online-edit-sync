import { Mark, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

import { shortId } from '@/utils/short-id'

// 书签格式 创建一个书签
export default Mark.create({
  name: 'bookmark',
  priority: 1000,
  keepOnSplit: false,
  exitable: true,
  addOptions() {
    return {
      bookmarkName: '',
      class: 'umo-editor-bookmark',
    }
  },
  addAttributes() {
    return {
      bookmarkName: {
        default: 'bookmarkName',
      },
      class: {
        default: this.options.class,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'bookmark',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['bookmark', mergeAttributes(this.options, HTMLAttributes), 0]
  },

  addCommands() {
    return {
      // 设置书签 若书签有选中区域数据 否则默认值为书签名称
      setBookmark:
        (attributes) =>
        ({ chain, editor }) => {
          try {
            chain().setMark(this.name, attributes).run()
            const { empty } = editor.state.selection
            if (empty && attributes.bookmarkName) {
              chain().focus().insertContent(attributes.bookmarkName).run()
            }
            return true
          } catch (e) {
            return false
          }
        },
      focusBookmark:
        (bookmarkName) =>
        ({ editor, tr }) => {
          if (bookmarkName) {
            const element = editor.view.dom.querySelector(
              `bookmark[bookmarkName="${bookmarkName}"]`,
            )
            if (element) {
              // 书签可能被「不显示书签」隐藏（display:none，无布局框，scrollIntoView 会失效）。
              // 定位时临时显示目标书签 → 滚动 → 恢复隐藏，保证隐藏状态下也能正常跳转。
              const hidden =
                !element.offsetWidth &&
                !element.offsetHeight &&
                !element.getClientRects().length
              let restore = null
              if (hidden) {
                restore = element.style.display
                element.style.display = 'inline'
              }
              // 隐藏时用同步滚动（auto），避免 smooth 异步动画被恢复隐藏打断
              element.scrollIntoView({
                behavior: hidden ? 'auto' : 'smooth',
                block: 'center',
                inline: 'nearest',
              })
              if (restore !== null) {
                element.style.display = restore
              }
              try {
                const pos = editor.view.posAtDOM(element, 0)
                if (tr && pos !== null && pos >= 0) {
                  tr.setSelection(new TextSelection(tr.doc.resolve(pos)))
                  editor.view.dispatch(tr)
                  editor.view.focus()
                }
              } catch (e) {
                // 位置解析失败时静默跳过（滚动已尽量执行），不影响编辑器
              }
            }
            return true
          } else return false
        },
      getAllBookmarks:
        (callback) =>
        ({ editor }) => {
          const bookmarkData = []
          try {
            const alltext = editor.getHTML()
            const parser = new DOMParser()
            const doc = parser.parseFromString(alltext, 'text/html')
            // 获取所有的 <bookmark> 元素
            const bookmarks = doc.body.querySelectorAll(this.name)
            const keyNode = []
            Array.from(bookmarks).forEach((node) => {
              if (node !== null) {
                const bookName = node.getAttribute('bookmarkName')
                if (bookName && !keyNode.includes(bookName)) {
                  keyNode.push(bookName)
                  bookmarkData.push({
                    bookmarkRowId: shortId(),
                    bookmarkRowName: bookName,
                  })
                }
              }
            })
          } catch (e) {}
          callback(bookmarkData)
          return true
        },
    }
  },
})
