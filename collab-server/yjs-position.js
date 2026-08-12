/**
 * Yjs 文档位置工具（服务端代写 comment mark 用）
 * -----------------------------------------------------------
 * 服务端无 ProseMirror schema，无法用 y-prosemirror 的 position 工具，
 * 故手写 ProseMirror 绝对 position ↔ Y.XmlText 节点内相对 offset 的映射。
 *
 * ProseMirror position 模型（经 prosemirror-model 验证）：
 *   文档 <p>hello </p><p>world</p>：
 *     pos 0      = 段落1开标签前
 *     pos 1..6   = "hello " 6 个字符（pos 1=h, 6=空格）
 *     pos 7      = 段落1末尾后（闭标签前）
 *     pos 8      = 段落2开标签前
 *     pos 9..13  = "world" 5 个字符
 *     pos 14     = 段落2末尾后
 *   每个 block（XmlElement）占 nodeSize = 2 + 内容长度 个 pos（开标签1 + 内容 + 闭标签1）。
 *   XmlText len 个字符占 len 个 pos；pos 在 XmlText 内可取 [0, len]（含末尾后）。
 *
 * 用于：commenter 通过 HTTP 提交评论时，服务端在 Y.Doc 上代写 comment mark。
 */
import * as Y from 'yjs'

/**
 * 解析 RelativePosition → {xmlText, relOffset, length}
 * @param {Y.Doc} doc 服务端 Y.Doc 实例（经 openDirectConnection 拿到）
 * @param {Uint8Array} relPosEnc Y.encodeRelativePosition 编码的相对位置
 * @returns {{xmlText: Y.XmlText, index: number} | null} 解析失败（位置已失效）返回 null
 */
export function resolveRelativePosition(doc, relPosEnc) {
  const relPos = Y.decodeRelativePosition(relPosEnc)
  const abs = Y.createAbsolutePositionFromRelativePosition(relPos, doc)
  if (!abs || !(abs.type instanceof Y.XmlText)) return null
  return { xmlText: abs.type, index: abs.index }
}

/**
 * 读取 XmlText 某区间的纯文字（含 mark 的文字也算，只取 insert）
 * @param {Y.XmlText} xmlText
 * @param {number} from 起始 index（含）
 * @param {number} to 结束 index（不含）
 * @returns {string}
 */
export function readTextRange(xmlText, from, to) {
  let text = ''
  for (const op of xmlText.toDelta()) {
    if (op.insert) text += op.insert
  }
  return text.slice(from, to)
}

/**
 * 按 commentId 扫描整个文档，找所有含该 comment mark 的区间
 * 用于 resolve（改属性）/ delete（移除 mark）时定位，不依赖记住的 offset
 * @param {Y.XmlFragment} frag doc.getXmlFragment('default')
 * @param {string} commentId
 * @returns {Array<{xmlText: Y.XmlText, relOffset: number, length: number, attrs: object}>}
 */
export function findCommentRanges(frag, commentId) {
  const ranges = []
  walkXmlTexts(frag, (xmlText) => {
    let offset = 0
    for (const op of xmlText.toDelta()) {
      const opLen = op.insert ? op.insert.length : 0
      const c = op.attributes?.comment
      if (c && c.commentId === commentId) {
        ranges.push({ xmlText, relOffset: offset, length: opLen, attrs: c })
      }
      offset += opLen
    }
  })
  return ranges
}

/**
 * 遍历 XmlFragment 下所有 XmlText 节点（递归嵌套结构）
 * @param {Y.XmlFragment|Y.XmlElement} type
 * @param {(xmlText: Y.XmlText) => void} fn
 */
function walkXmlTexts(type, fn) {
  const children = type.toArray ? type.toArray() : []
  for (const child of children) {
    if (child instanceof Y.XmlText) {
      fn(child)
    } else if (child instanceof Y.XmlElement) {
      walkXmlTexts(child, fn)
    }
  }
}

/**
 * 在 XmlText 上加/改 comment mark
 * @param {Y.XmlText} xmlText
 * @param {number} relOffset 区间起始 index
 * @param {number} length 区间长度
 * @param {{commentId: string, resolved?: boolean}} attrs
 */
export function setCommentMark(xmlText, relOffset, length, attrs) {
  xmlText.format(relOffset, length, {
    comment: { commentId: attrs.commentId, resolved: !!attrs.resolved },
  })
}

/**
 * 移除 XmlText 上某区间的 comment mark（format null 触发 negate）
 */
export function removeCommentMark(xmlText, relOffset, length) {
  xmlText.format(relOffset, length, { comment: null })
}

/**
 * 估算 XmlElement 内容占用的 ProseMirror pos 数（用于 position 映射递归）
 * XmlText._length 之和 + 嵌套 XmlElement nodeSize 之和
 */
function xmlElementContentSize(el) {
  let size = 0
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) {
      size += child._length
    } else if (child instanceof Y.XmlElement) {
      size += 2 + xmlElementContentSize(child)
    }
  }
  return size
}

/**
 * ProseMirror 绝对 position → {xmlText, relOffset}
 * 备用：当前方案用 RelativePosition，此函数供调试/兜底/未来扩展使用
 * @param {Y.XmlFragment} frag
 * @param {number} absPos ProseMirror 绝对 position
 * @returns {{xmlText: Y.XmlText, relOffset: number} | {atNodeBefore: true} | null}
 */
export function resolveAbsPosition(frag, absPos) {
  return resolveType(frag, absPos)
}

function resolveType(type, pos) {
  if (type instanceof Y.XmlText) {
    const len = type._length
    if (pos <= len) return { xmlText: type, relOffset: pos }
    return null
  }
  const children = type.toArray ? type.toArray() : []
  for (const child of children) {
    if (child instanceof Y.XmlText) {
      const len = child._length
      if (pos <= len) return { xmlText: child, relOffset: pos }
      pos -= len
    } else if (child instanceof Y.XmlElement) {
      if (pos === 0) return { atNodeBefore: true }
      pos -= 1 // 开标签
      const r = resolveType(child, pos)
      if (r) return r
      pos -= xmlElementContentSize(child)
      pos -= 1 // 闭标签
    }
  }
  return null
}
