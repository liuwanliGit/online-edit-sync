import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// 瘦客户端 Vite 配置
// 编辑器通过 iframe 嵌入引擎 /embed，本工程不含协同运行时（无 @tiptap/yjs/@hocuspocus 依赖），
// 无需 dedupe / optimizeDeps.exclude / editor 别名。
export default defineConfig({
  base: '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: true,
    // docs/ 在 demo/ 之外（仓库根），需放开 fs.allow 才能读取
    fs: { allow: ['..'] },
  },
})
