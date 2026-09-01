<template>
  <menus-button
    ico="word"
    :text="t('export.word.text')"
    huge
    :disabled="exportFile.word"
    @menu-click="exportWord"
  />
</template>

<script setup>
const editor = inject('editor')
// getVanillaHTML 是组件级方法（单独 provide），不在 Tiptap 实例 editor 上
const getVanillaHTML = inject('getVanillaHTML')
const options = inject('options')
const container = inject('container')
const exportFile = inject('exportFile')

const exportWord = async () => {
  if (!editor.value) {
    return
  }
  // 未配置 onExportDocx 回调：提示宿主接入转换服务
  if (typeof options.value?.onExportDocx !== 'function') {
    const dialog = useAlert({
      attach: container,
      theme: 'warning',
      header: t('export.word.error.title'),
      body: t('export.word.error.message'),
      onConfirm() {
        dialog.destroy()
      },
    })
    return
  }
  exportFile.value.word = true
  try {
    // 用页面渲染后的高保真 HTML（含图表快照/媒体处理），与 postMessage export 路径一致。
    // 若用 Tiptap 的 getHTML()，echarts 等自定义节点会序列化为空标签，导出的 docx 丢内容。
    const html = await getVanillaHTML()
    const { title } = options.value.document
    const name = title !== '' ? options.value.document.title : t('document.untitled')
    await options.value.onExportDocx(html, name)
  } catch {
    const dialog = useAlert({
      attach: container,
      theme: 'warning',
      header: t('export.word.error.title'),
      body: t('export.word.error.message'),
      onConfirm() {
        dialog.destroy()
      },
    })
  } finally {
    exportFile.value.word = false
  }
}
</script>
