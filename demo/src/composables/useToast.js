import { MessagePlugin } from 'tdesign-vue-next'

// 统一的消息提示封装，避免每个组件重复 import + 调参。
// 用法：const toast = useToast(); toast.success('保存成功')
export function useToast() {
  return {
    success(content, duration = 2000) {
      MessagePlugin.success(content, duration)
    },
    warning(content, duration = 2500) {
      MessagePlugin.warning(content, duration)
    },
    error(content, duration = 3000) {
      MessagePlugin.error(content, duration)
    },
    info(content, duration = 2000) {
      MessagePlugin.info(content, duration)
    },
  }
}
