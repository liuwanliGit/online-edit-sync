/* 记录历史记录的公共组
{
  done: [],        // 能撤销的记录数组
  undone: [],      // 能重做的记录数组
  isUndoRedo: false // 是否正在执行撤销 / 重做
}
*/

export const addHistory = (records, stepType, data, isCollab = false) => {
  if (records.value.isUndoRedo || !data) return

  // 协同模式下编辑器内容的撤销/重做由 Yjs UndoManager 接管，
  // 不再依赖 ProseMirror 的 state.history$ 计数对齐（undoRedo 扩展已禁用，
  // history$ 为 undefined，eventCount 永远为 0，会整条短路）。
  // page 类历史（页边距、水印等）不受协同影响，仍走 Umo 自建队列。
  if (isCollab && stepType === 'editor') return

  stepType === 'editor'
    ? addHistoryEditor(records, stepType, data)
    : addHistoryPage(records, stepType, data)
}

/* ================= 编辑器历史 ================= */

const addHistoryEditor = (records, stepType, data) => {
  const undoneCount = data?.undone?.eventCount || 0
  if (undoneCount > 0) return

  const eventCount = data?.done?.eventCount || 0
  if (eventCount === 0) return

  const { done } = records.value
  let currentCount =
    typeof records.value.editorCount === 'number'
      ? records.value.editorCount
      : done.filter((item) => item.type === stepType).length

  if (currentCount < eventCount) {
    for (let i = currentCount; i < eventCount; i++) {
      done.push({ type: stepType })
    }
    currentCount = eventCount
  }

  records.value.editorCount = currentCount
  resetUndone(records)
}

/* ================= 页面历史 ================= */

const addHistoryPage = (records, stepType, data) => {
  if (!stepType) return

  const { proType, newData, oldData } = data
  if (!proType || !newData || !oldData) return

  // 值相同不记录
  if (isEqual(newData, oldData)) return

  records.value.done.push({ type: stepType, ...data })
  resetUndone(records)
}

/* ================= 公共工具 ================= */

const resetUndone = (records) => {
  records.value.undone = []
}

const isEqual = (a, b) => {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (typeof a !== typeof b) return false

  if (typeof a === 'object') {
    // 数组
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false
      return a.every((item, i) => isEqual(item, b[i]))
    }

    // 对象
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false

    return keysA.every((key) => keysB.includes(key) && isEqual(a[key], b[key]))
  }

  return false
}

/* ================= 撤销 / 重做 ================= */

const withUndoRedoFlag = (records, fn) => {
  records.value.isUndoRedo = true
  try {
    fn()
  } catch (e) {}
  setTimeout(() => {
    records.value.isUndoRedo = false
  }, 0)
}

// 撤销
export const undoHistoryRecord = (records, method) => {
  const { done } = records.value
  if (done.length === 0) return

  withUndoRedoFlag(records, () => {
    const record = done.pop()
    method(record)
    records.value.undone.unshift(record)
    if (record?.type === 'editor') {
      const currentCount =
        typeof records.value.editorCount === 'number'
          ? records.value.editorCount
          : 0
      records.value.editorCount = Math.max(0, currentCount - 1)
    }
  })
}

// 重做
export const redoHistoryRecord = (records, method) => {
  const { undone } = records.value
  if (undone.length === 0) return

  withUndoRedoFlag(records, () => {
    const record = undone.shift()
    method(record)
    records.value.done.push(record)
    if (record?.type === 'editor') {
      const currentCount =
        typeof records.value.editorCount === 'number'
          ? records.value.editorCount
          : 0
      records.value.editorCount = currentCount + 1
    }
  })
}
