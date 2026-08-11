import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// /embed 纯编辑器页构建配置（独立于库的 library 模式构建）
// 引用 @umoteam/editor 时走上层仓库的 dist/（package.json 的 exports 已映射）
export default defineConfig({
  // 固定应用前缀 /oes/embed/：构建产物 index.html 用 /oes/embed/assets/... 绝对路径引用，
  // 配合引擎容器 nginx 的 location /oes/embed/ 提供静态资源。
  // 引擎专属前缀 /oes/embed/ 与 demo 的 /oes/ 错开，单域名外层 nginx 可用最长前缀匹配分流：
  //   /oes/embed*           → 引擎容器
  //   其余 /oes/*（页面/API）→ demo 容器
  // 同时修掉之前 base:'./' 在某些 vite/rolldown 版本下产物变 /assets/... 绝对路径的 bug。
  base: '/oes/embed/',
  plugins: [vue()],
  resolve: {
    alias: {
      // 显式指向已构建产物，避免 npm file:.. 解析 / exports 条件在不同环境下不一致
      '@umoteam/editor/style': fileURLToPath(
        new URL('./node_modules/@umoteam/editor/dist/umo-editor.css', import.meta.url),
      ),
      '@umoteam/editor': fileURLToPath(
        new URL('./node_modules/@umoteam/editor/dist/umo-editor.js', import.meta.url),
      ),
    },
    // 编辑器 bundle 把 @tiptap/* / prosemirror-* / yjs 等外部化了，运行时由宿主（本应用）提供。
    // 本应用注入的 Collaboration / 远程光标扩展必须与编辑器内部用「同一个」模块实例，
    // 否则 ProseMirror 的 schema/instanceof 校验会因实例不一致而报错。dedupe 强制单一来源。
    dedupe: [
      'vue',
      'yjs',
      '@tiptap/core',
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
  // @umoteam/editor 是上游仓库已构建好的 ESM bundle，不要让 Vite 预打包器处理它
  optimizeDeps: {
    exclude: ['@umoteam/editor'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    open: true,
  },
})
