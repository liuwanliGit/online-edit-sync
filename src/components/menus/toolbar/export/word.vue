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
    const html = editor.value.getHTML()
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
