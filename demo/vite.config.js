import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// 瘦客户端 Vite 配置
// 编辑器通过 iframe 嵌入引擎 /embed，本工程不含协同运行时（无 @tiptap/yjs/@hocuspocus 依赖），
// 无需 dedupe / optimizeDeps.exclude / editor 别名。
export default defineConfig({
  // demo 应用前缀固定 /oes/demo/：构建产物 index.html 用 /oes/demo/assets/...、
  // /oes/demo/config.js 绝对路径引用，配合容器 nginx 的 location /oes/demo/ 提供静态资源。
  // 与引擎侧 /oes/embed/ 前缀错开，单域名部署时长前缀分流互不干扰。
  base: '/oes/demo/',
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
