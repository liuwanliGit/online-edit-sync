import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// demo 应用的 Vite 配置（独立于库的 library 模式构建）
// 引用 @umoteam/editor 时走上层仓库的 dist/（package.json 的 exports 已映射）
export default defineConfig({
  base: '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // 关键：编辑器 bundle 把 @tiptap/* / prosemirror-* / yjs 等外部化了，
    // 运行时由宿主（本 demo）提供。本 demo 的协同代码也直接 import 这些包，
    // 必须保证编辑器内部与协同扩展用的是「同一个」模块实例，否则
    // ProseMirror 的 schema/instanceof 校验会因实例不一致而报
    // "Cannot read properties of undefined (reading 'localsInner')" 等错。
    // dedupe 强制 Vite 始终从单一来源解析这些包。
    dedupe: [
      'vue',
      'yjs',
      '@tiptap/core',
      '@tiptap/vue-3',
      '@tiptap/pm',
      '@tiptap/extension-collaboration',
      '@tiptap/y-tiptap',
      'prosemirror-model',
      'prosemirror-state',
      'prosemirror-view',
      'prosemirror-transform',
      'prosemirror-keymap',
    ],
  },
  // @umoteam/editor 是上游仓库已构建好的 ESM bundle（dist/umo-editor.js），
  // 不要让 Vite 的依赖预打包器再去处理它，否则会报 "incompatible with the dep optimizer"。
  optimizeDeps: {
    exclude: ['@umoteam/editor'],
  },
  server: {
    port: 5173,
    open: true,
  },
})
