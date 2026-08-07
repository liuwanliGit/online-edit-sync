<template>
  <div class="docs">
    <!-- 顶部栏 -->
    <header class="docs-header">
      <div class="header-inner">
        <div class="header-title">
          <span class="header-mark">U</span>
          <span>Umo Editor 使用文档</span>
        </div>
        <router-link
          :to="backTarget"
          class="back-link"
        >
          <t-icon name="arrow-left" />
          <span>返回</span>
        </router-link>
      </div>
    </header>

    <div class="docs-body">
      <!-- 左侧目录 -->
      <aside class="sidebar" :class="{ open: sidebarOpen }">
        <nav class="toc">
          <div v-for="g in groups" :key="g.key" class="toc-group">
            <div class="toc-group-title">{{ g.title }}</div>
            <ul class="toc-list">
              <li
                v-for="item in g.items"
                :key="item.path"
              >
                <button
                  type="button"
                  class="toc-item"
                  :class="{ active: currentPath === item.path }"
                  @click="selectDoc(item.path)"
                >
                  {{ item.title }}
                </button>
              </li>
            </ul>
          </div>
        </nav>
      </aside>

      <!-- 移动端遮罩 -->
      <div
        v-if="sidebarOpen"
        class="sidebar-mask"
        @click="sidebarOpen = false"
      />

      <!-- 右侧内容 -->
      <main class="content">
        <button
          class="sidebar-toggle"
          type="button"
          @click="sidebarOpen = !sidebarOpen"
        >
          <t-icon :name="sidebarOpen ? 'close' : 'menu'" />
        </button>

        <article
          v-if="html"
          class="markdown-body"
          v-html="html"
        />
        <div v-else class="content-empty">
          <p>未找到该文档</p>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { marked } from 'marked'
import { Icon as TIcon } from 'tdesign-vue-next'
import { isLoggedIn } from '@/store/auth'

// ============ 静态加载 docs 下全部 Markdown（构建时内联） ============
// DocsView.vue 在 demo/src/views/，需 ../../../ 回到仓库根再进 docs/
// fs.allow 已在 vite.config.js 放开（允许访问仓库根）
const docsRaw = import.meta.glob('../../../docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// ============ 目录元信息：手动维护分组与标题 ============
// glob 路径形如 '/docs/get-started/overview.md'
const META = {
  '/docs/README.md': { group: 'root', title: '文档首页' },
  // get-started
  '/docs/get-started/overview.md': { group: 'get-started', title: '概述' },
  '/docs/get-started/installation.md': { group: 'get-started', title: '部署引擎镜像' },
  '/docs/get-started/authentication.md': { group: 'get-started', title: '鉴权对接' },
  '/docs/get-started/embedding.md': { group: 'get-started', title: '前端 iframe 嵌入' },
  '/docs/get-started/features.md': { group: 'get-started', title: '支持的功能' },
  '/docs/get-started/faq.md': { group: 'get-started', title: '常见问题' },
  // api-reference
  '/docs/api-reference/url-params.md': { group: 'api-reference', title: 'iframe URL 参数' },
  '/docs/api-reference/same-origin-api.md': { group: 'api-reference', title: '同源直调 API' },
  '/docs/api-reference/postmessage-protocol.md': { group: 'api-reference', title: 'postMessage 协议' },
  '/docs/api-reference/server-api.md': { group: 'api-reference', title: '服务端接口' },
  '/docs/api-reference/export.md': { group: 'api-reference', title: '导出与文件回传' },
  '/docs/api-reference/nginx-reverse-proxy.md': { group: 'api-reference', title: 'nginx 同域反代' },
  // samples
  '/docs/samples/minimal-cross-domain.md': { group: 'samples', title: '最小可用集成（跨域）' },
  '/docs/samples/full-same-origin.md': { group: 'samples', title: '强交互集成（同源）' },
  '/docs/samples/demo-project.md': { group: 'samples', title: '瘦客户端示例项目' },
}

const GROUPS = [
  { key: 'root', title: '起步' },
  { key: 'get-started', title: '入门' },
  { key: 'api-reference', title: 'API 参考' },
  { key: 'samples', title: '示例' },
]

// ============ 构建分组目录 ============
const groups = computed(() => {
  // glob key 可能以 '../../docs' 开头，统一规整成 '/docs/...'
  const normalize = (k) => k.replace(/^.*\/docs\//, '/docs/')
  const allPaths = Object.keys(docsRaw).map(normalize)

  return GROUPS.map((g) => ({
    ...g,
    items: allPaths
      .filter((p) => META[p]?.group === g.key)
      .sort((a, b) => Object.keys(META).indexOf(a) - Object.keys(META).indexOf(b))
      .map((p) => ({ path: p, title: META[p].title })),
  })).filter((g) => g.items.length > 0)
})

// ============ 当前文档 ============
const route = useRoute()
const router = useRouter()
const currentPath = ref('')
const html = ref('')
const sidebarOpen = ref(false)

// 配置 marked：相对链接改写为 /docs?file= 路由，GFM 表格
marked.setOptions({
  gfm: true,
  breaks: false,
})

function getDocSource(path) {
  const normalize = (k) => k.replace(/^.*\/docs\//, '/docs/')
  const key = Object.keys(docsRaw).find((k) => normalize(k) === path)
  return key ? docsRaw[key] : ''
}

function renderDoc(path) {
  const md = getDocSource(path)
  if (!md) {
    html.value = ''
    return
  }
  // 把 Markdown 内的相对链接（如 ./overview.md、../api-reference/x.md）改写为文档内跳转
  const rewritten = rewriteLinks(md, path)
  html.value = marked.parse(rewritten)
  // 切文档后回到顶部
  nextTick(() => {
    const el = document.querySelector('.content')
    if (el) el.scrollTop = 0
  })
}

// 把 md 里的相对 .md 链接改写为 /docs?file=<绝对路径>
function rewriteLinks(md, basePath) {
  // 匹配 [text](relative.md) 或 [text](relative.md#anchor)，不匹配 http 链接
  return md.replace(
    /(\[[^\]]*\])\(([^)]+\.md)(#[^)]*)?\)/g,
    (m, text, link, anchor) => {
      if (/^https?:/.test(link)) return m // 外链不动
      const baseDir = basePath.replace(/\/[^/]+$/, '')
      const resolved = resolveRelative(baseDir, link)
      return `${text}(/docs?file=${encodeURIComponent(resolved)}${anchor || ''})`
    },
  )
}

function resolveRelative(base, rel) {
  const parts = base.split('/')
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

// 处理 query → 选中文档
function syncFromRoute() {
  const file = route.query.file
  let path
  if (typeof file === 'string' && file) {
    path = decodeURIComponent(file).replace(/#.*$/, '')
    if (!META[path]) path = '/docs/README.md' // 未知文件兜底回首页
  } else {
    path = '/docs/README.md'
  }
  if (currentPath.value !== path) {
    currentPath.value = path
    renderDoc(path)
  }
}

function selectDoc(path) {
  sidebarOpen.value = false
  if (path === currentPath.value) return
  router.push({ name: 'docs', query: { file: path } })
}

// 监听路由 query 变化（点目录、浏览器前进后退都会触发）
watch(() => route.query.file, syncFromRoute, { immediate: true })

// 返回目标：登录态回工作台，否则回登录页
const backTarget = computed(() =>
  isLoggedIn() ? { name: 'documents' } : { name: 'login' },
)

// 点击渲染后内容的内部链接（改写过的 /docs?file= 链接）
onMounted(() => {
  const el = document.querySelector('.content')
  if (!el) return
  el.addEventListener('click', (e) => {
    const a = e.target.closest('a')
    if (!a) return
    const href = a.getAttribute('href') || ''
    if (href.startsWith('/docs?file=')) {
      e.preventDefault()
      const search = new URL(href, window.location.origin).search
      const params = new URLSearchParams(search)
      const file = params.get('file')
      if (file) selectDoc(file)
    }
  })
})
</script>

<style scoped>
.docs {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--demo-bg);
}

/* ===== 顶部栏 ===== */
.docs-header {
  flex-shrink: 0;
  height: 56px;
  background: var(--demo-card-bg);
  border-bottom: 1px solid var(--demo-border);
  box-shadow: var(--demo-shadow-sm);
}
.header-inner {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}
.header-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
  color: var(--demo-text);
}
.header-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, #4d8cf2, #6aa6ff);
  color: #fff;
  font-weight: 800;
  font-size: 15px;
}
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--demo-text-secondary);
  text-decoration: none;
  transition: all 0.15s;
}
.back-link:hover {
  background: var(--demo-bg);
  color: var(--demo-primary);
}

/* ===== 主体 ===== */
.docs-body {
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
}

/* ===== 左侧目录 ===== */
.sidebar {
  flex-shrink: 0;
  width: 240px;
  background: var(--demo-card-bg);
  border-right: 1px solid var(--demo-border);
  overflow-y: auto;
  padding: 16px 0;
}
.toc {
  padding: 0 12px;
}
.toc-group {
  margin-bottom: 20px;
}
.toc-group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--demo-text-tertiary);
  letter-spacing: 0.5px;
  padding: 0 12px 8px;
  text-transform: uppercase;
}
.toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.toc-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font: inherit;
  font-size: 13.5px;
  color: var(--demo-text-secondary);
  cursor: pointer;
  transition: all 0.12s;
}
.toc-item:hover {
  background: var(--demo-bg);
  color: var(--demo-text);
}
.toc-item.active {
  background: rgba(77, 140, 242, 0.1);
  color: var(--demo-primary);
  font-weight: 500;
}

/* ===== 右侧内容 ===== */
.content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  position: relative;
}
.sidebar-toggle {
  display: none;
  position: fixed;
  top: 68px;
  left: 16px;
  z-index: 20;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--demo-border);
  background: var(--demo-card-bg);
  box-shadow: var(--demo-shadow-sm);
  cursor: pointer;
  align-items: center;
  justify-content: center;
  color: var(--demo-text-secondary);
  font-size: 18px;
}
.content-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--demo-text-tertiary);
}

/* ===== Markdown 排版 ===== */
.markdown-body {
  max-width: 860px;
  margin: 0 auto;
  padding: 40px 48px 120px;
  font-size: 15px;
  line-height: 1.8;
  color: var(--demo-text);
}
.markdown-body :deep(h1) {
  font-size: 30px;
  font-weight: 700;
  margin: 0 0 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--demo-border);
  line-height: 1.3;
}
.markdown-body :deep(h2) {
  font-size: 22px;
  font-weight: 600;
  margin: 40px 0 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--demo-border);
}
.markdown-body :deep(h3) {
  font-size: 18px;
  font-weight: 600;
  margin: 32px 0 12px;
}
.markdown-body :deep(h4) {
  font-size: 15px;
  font-weight: 600;
  margin: 24px 0 10px;
}
.markdown-body :deep(p) {
  margin: 0 0 16px;
}
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0 0 16px;
  padding-left: 24px;
}
.markdown-body :deep(li) {
  margin: 6px 0;
}
.markdown-body :deep(li > ul),
.markdown-body :deep(li > ol) {
  margin: 6px 0;
}
.markdown-body :deep(a) {
  color: var(--demo-primary);
  text-decoration: none;
}
.markdown-body :deep(a:hover) {
  text-decoration: underline;
}
.markdown-body :deep(blockquote) {
  margin: 0 0 16px;
  padding: 8px 16px;
  border-left: 4px solid var(--demo-primary);
  background: rgba(77, 140, 242, 0.06);
  border-radius: 0 6px 6px 0;
  color: var(--demo-text-secondary);
}
.markdown-body :deep(blockquote p) {
  margin: 4px 0;
}
/* 行内代码 */
.markdown-body :deep(code) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.88em;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(29, 33, 41, 0.06);
  color: #d63384;
}
/* 代码块 */
.markdown-body :deep(pre) {
  margin: 0 0 16px;
  padding: 16px 20px;
  border-radius: 8px;
  background: #1e1e2e;
  overflow-x: auto;
}
.markdown-body :deep(pre code) {
  display: block;
  padding: 0;
  background: transparent;
  color: #cdd6f4;
  font-size: 13px;
  line-height: 1.6;
}
/* 表格 */
.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 16px;
  font-size: 14px;
  display: block;
  overflow-x: auto;
}
.markdown-body :deep(thead) {
  background: var(--demo-bg);
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 10px 14px;
  border: 1px solid var(--demo-border);
  text-align: left;
}
.markdown-body :deep(th) {
  font-weight: 600;
  white-space: nowrap;
}
.markdown-body :deep(tbody tr:nth-child(2n)) {
  background: rgba(29, 33, 41, 0.02);
}
.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--demo-border);
  margin: 32px 0;
}
.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 8px;
}
/* 锚点引用 */
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  scroll-margin-top: 20px;
}

/* ===== 响应式：窄屏折叠侧栏 ===== */
@media (max-width: 880px) {
  .sidebar-toggle {
    display: inline-flex;
  }
  .sidebar {
    position: fixed;
    top: 56px;
    left: 0;
    bottom: 0;
    z-index: 30;
    width: 260px;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    box-shadow: var(--demo-shadow-lg);
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .sidebar-mask {
    position: fixed;
    inset: 56px 0 0 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 25;
  }
  .markdown-body {
    padding: 56px 20px 80px;
    font-size: 14.5px;
  }
}
</style>
