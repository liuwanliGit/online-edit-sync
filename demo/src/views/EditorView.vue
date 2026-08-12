<template>
  <div class="editor-page">
    <!-- 顶部栏 -->
    <header class="topbar">
      <div class="topbar-left">
        <t-button theme="default" variant="text" shape="square" @click="goBack">
          <template #icon><t-icon name="arrow-left" /></template>
        </t-button>
        <t-divider layout="vertical" />
        <span class="topbar-title">{{ doc?.title || '加载中…' }}</span>
      </div>
      <div class="topbar-right">
        <t-tag
          :theme="editorReady ? 'success' : 'default'"
          variant="light"
          shape="round"
          size="small"
        >
          <template #icon>
            <t-icon :name="editorReady ? 'check-circle' : 'loading'" :class="{ spin: !editorReady }" />
          </template>
          {{ editorReady ? '编辑器就绪' : '连接中' }}
        </t-tag>
        <t-tag
          :theme="isViewer() ? 'default' : 'primary'"
          variant="light"
          shape="round"
          size="small"
        >
          <template #icon>
            <t-icon :name="isViewer() ? 'lock-on' : 'edit-2'" />
          </template>
          {{ isViewer() ? '只读' : '可编辑' }}
        </t-tag>
        <t-button
          theme="default"
          variant="outline"
          @click="togglePanel"
        >
          <template #icon><t-icon :name="panelOpen ? 'chevron-right' : 'play-circle'" /></template>
          {{ panelOpen ? '收起面板' : '交互演示' }}
        </t-button>
      </div>
    </header>

    <!-- 文档不存在 -->
    <div v-if="notFound" class="missing">
      <div class="missing-illu"><t-icon name="file-unknown" /></div>
      <h3>文档不存在</h3>
      <p>这篇文档可能已被删除，或链接有误。</p>
      <t-button theme="primary" variant="outline" @click="goBack">
        <template #icon><t-icon name="list" /></template>
        返回文档列表
      </t-button>
    </div>

    <!-- 加载失败 -->
    <div v-else-if="loadError" class="missing">
      <div class="missing-illu err-illu"><t-icon name="error-triangle" /></div>
      <h3>打开文档失败</h3>
      <p class="err-msg">{{ loadError }}</p>
      <t-button theme="primary" variant="outline" @click="goBack">
        <template #icon><t-icon name="list" /></template>
        返回文档列表
      </t-button>
    </div>

    <!-- 编辑器 + 交互面板 -->
    <div v-else class="editor-body">
      <!-- iframe 编辑器 -->
      <div class="iframe-wrap">
        <iframe
          v-if="iframeSrc"
          ref="iframeRef"
          :src="iframeSrc"
          class="editor-iframe"
          allow="clipboard-read; clipboard-write; fullscreen"
          @load="onIframeLoad"
        />
      </div>

      <!-- 交互演示面板 -->
      <transition name="slide">
        <aside v-show="panelOpen" class="demo-panel">
          <div class="panel-head">
            <h3 class="panel-title">
              <t-icon name="play-circle" />
              交互演示
            </h3>
            <t-button
              class="panel-close"
              theme="default"
              variant="text"
              shape="square"
              size="small"
              :aria-label="'收起交互演示面板'"
              @click="togglePanel"
            >
              <template #icon><t-icon name="chevron-right" /></template>
            </t-button>
          </div>
          <p class="panel-desc">
            以下四个场景对应
            <a :href="guideUrl" target="_blank">接入指南</a>
            的第三~五节，接入方可照抄。
          </p>

          <!-- 1. 鉴权对接 -->
          <section class="demo-section">
            <div class="section-head">
              <span class="step">1</span>
              <span class="section-title">鉴权对接（业务后端代理签 JWT）</span>
            </div>
            <p class="section-desc">
              前端不直接调引擎 /api/token，而是调业务后端 /api/doc-token（持 UMO_API_KEY 代签）。当前 token 已由打开文档时自动获取。
            </p>
            <div class="token-info">
              <t-tag theme="primary" variant="outline" size="small">
                <t-icon name="lock-on" />
                JWT 已签发
              </t-tag>
              <t-button theme="default" variant="text" size="small" @click="refreshToken">
                <template #icon><t-icon name="refresh" /></template>
                重新签发
              </t-button>
            </div>
          </section>

          <!-- 2. 同源直调 -->
          <section class="demo-section">
            <div class="section-head">
              <span class="step">2</span>
              <span class="section-title">同源直调（同步取内容）</span>
            </div>
            <p class="section-desc">
              配 nginx 反代后 iframe 同源，可直接调
              <code>iframe.contentWindow.__UMO_EDITOR__</code>
            </p>
            <div class="btn-row">
              <t-button theme="primary" variant="outline" size="small" :loading="busy.sameOrigin" @click="sameOriginGetHTML">
                <template #icon><t-icon name="file" /></template>
                同步取 HTML
              </t-button>
            </div>
            <div v-if="result.sameOrigin" class="result-box ok">
              <div class="result-label">结果（前 500 字）：</div>
              <pre>{{ truncate(result.sameOrigin, 500) }}</pre>
            </div>
            <div v-if="error.sameOrigin" class="result-box err">
              <pre>{{ error.sameOrigin }}</pre>
            </div>
          </section>

          <!-- 3. postMessage -->
          <section class="demo-section">
            <div class="section-head">
              <span class="step">3</span>
              <span class="section-title">跨域 postMessage</span>
            </div>
            <p class="section-desc">
              跨域通用，异步请求/响应。
            </p>
            <div class="btn-row">
              <t-button theme="primary" variant="outline" size="small" :loading="busy.getContent" @click="pmGetContent">
                <template #icon><t-icon name="file-download" /></template>
                取内容
              </t-button>
              <t-button theme="default" variant="outline" size="small" :loading="busy.insertContent" @click="pmInsertContent">
                <template #icon><t-icon name="edit" /></template>
                插入段落
              </t-button>
            </div>
            <div v-if="result.getContent" class="result-box ok">
              <div class="result-label">结果（前 500 字）：</div>
              <pre>{{ truncate(result.getContent, 500) }}</pre>
            </div>
            <div v-if="result.insertContent" class="result-box ok">
              <pre>{{ result.insertContent }}</pre>
            </div>
            <div v-if="error.postMessage" class="result-box err">
              <pre>{{ error.postMessage }}</pre>
            </div>
          </section>

          <!-- 4. 导出回传 -->
          <section class="demo-section">
            <div class="section-head">
              <span class="step">4</span>
              <span class="section-title">导出 Word（方案 B3 回传）</span>
            </div>
            <p class="section-desc">
              iframe 内转 docx 后直接 POST 推给业务后端 /api/receive-doc，后端存盘返回下载链接。
            </p>
            <div class="btn-row">
              <t-button
                theme="success"
                variant="outline"
                size="small"
                :loading="busy.export"
                :disabled="!editorReady"
                @click="exportDocx"
              >
                <template #icon><t-icon name="file-export" /></template>
                导出并回传
              </t-button>
            </div>
            <div v-if="result.export" class="result-box ok">
              <div class="result-label">导出成功：</div>
              <a :href="result.export.url" target="_blank" class="download-link">
                <t-icon name="file-icon" />
                {{ result.export.filename }} ({{ formatSize(result.export.size) }})
              </a>
            </div>
            <div v-if="error.export" class="result-box err">
              <pre>{{ error.export }}</pre>
            </div>
          </section>
        </aside>
      </transition>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Button as TButton,
  Tag as TTag,
  Icon as TIcon,
  Divider as TDivider,
} from 'tdesign-vue-next'

import { useToast } from '@/composables/useToast'
import { auth, isViewer } from '@/store/auth'
import { get } from '@/store/documents'
import { fetchDocToken, getApiBase } from '@/utils/api'
import { getEmbedUrl, getEngineUrl } from '@/utils/engine-config'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const docId = route.params.id
const doc = ref(null)
const notFound = ref(false)
const loadError = ref('')

// iframe
const iframeRef = ref(null)
const iframeSrc = ref('')
const editorReady = ref(false)
const tokenData = ref(null)

// 面板：默认折叠，记住用户偏好（localStorage）
const panelOpen = ref(
  typeof window !== 'undefined' && localStorage.getItem('demo-panel-open') === '1',
)
const guideUrl = 'https://github.com/umoteam/umo-editor/blob/main/EMBED_INTEGRATION_GUIDE.md'

function togglePanel() {
  panelOpen.value = !panelOpen.value
  try {
    localStorage.setItem('demo-panel-open', panelOpen.value ? '1' : '0')
  } catch {
    // 隐私模式等场景下忽略持久化失败
  }
}

// ============ 下发给 embed 的业务配置（postMessage config 握手） ============
// embed 挂载时向父页面请求 { type:'request-config' }，父页面回传 { type:'config', payload }。
// 模板/用户目录/书签显示/分享/CDN 全部由业务系统控制，URL 不承载配置，无长度限制。
//
// 注意：评论功能现已由引擎内置（同源调用 /api/documents/:docId/comments），
// 不再需要下发 commentApiBase。
const editorConfig = {
  // 模板：业务系统维护内容，编辑器只负责插入
  templates: [
    {
      title: '工作任务',
      description: '工作任务模板',
      content:
        '<h1>工作任务</h1><h3>任务名称：</h3><p>[任务的简短描述]</p><h3>负责人：</h3><p>[执行任务的个人姓名]</p><h3>截止日期：</h3><p>[任务需要完成的日期]</p><h3>任务详情：</h3><ol><li>[任务步骤1]</li><li>[任务步骤2]</li><li>[任务步骤3]...</li></ol><h3>目标：</h3><p>[任务需要达成的具体目标或结果]</p><h3>备注：</h3><p>[任何额外信息或注意事项]</p>',
    },
    {
      title: '工作周报',
      description: '工作周报模板',
      content:
        '<h1>工作周报</h1><h2>本周工作总结</h2><hr /><h3>已完成工作：</h3><ul><li>[任务1名称]：[简要描述任务内容及完成情况]</li><li>[任务2名称]：[简要描述任务内容及完成情况]</li><li>...</li></ul><h3>进行中工作：</h3><ul><li>[任务1名称]：[简要描述任务当前进度和下一步计划]</li><li>[任务2名称]：[简要描述任务当前进度和下一步计划]</li><li>...</li></ul><h3>问题与挑战：</h3><ul><li>[问题1]：[描述遇到的问题及当前解决方案或需要的支持]</li><li>[问题2]：[描述遇到的问题及当前解决方案或需要的支持]</li><li>...</li></ul><hr /><h2>下周工作计划</h2><h3>计划开展工作：</h3><ul><li>[任务1名称]：[简要描述下周计划开始的任务内容]</li><li>[任务2名称]：[简要描述下周计划开始的任务内容]</li><li>...</li></ul><h3>需要支持与资源：</h3><ul><li>[资源1]：[描述需要的资源或支持]</li><li>[资源2]：[描述需要的资源或支持]</li><li>...</li></ul>',
    },
  ],
  // @提及用户目录（embed 本地过滤，输入 @ 触发）
  users: [
    { id: 'umodoc', label: 'Umo Team', bio: '核心开发者', color: 'var(--umo-primary-color)' },
    { id: 'china-wangxu', label: 'china-wangxu', bio: '重要贡献者', color: 'var(--umo-primary-color)' },
    { id: 'Cassielxd', label: 'Cassielxd', bio: '重要贡献者', color: 'var(--umo-primary-color)' },
    { id: 'Goldziher', label: "Na'aman Hirschfeld" },
    { id: 'SerRashin', label: 'SerRashin' },
    { id: 'ChenErik', label: 'ChenErik' },
    { id: 'testuser', label: '测试用户' },
  ],
  // 书签标记在页面中可见
  page: { showBookmark: true },
  // 分享链接：业务系统的文档页地址（而非 embed 的带 token URL，token 会过期）
  shareUrl: typeof window !== 'undefined' ? window.location.href : '',
  // 外部资源 CDN（公式/图表/播放器/文件图标等加载地址）
  cdnUrl: 'https://cdn.umodoc.com',
}

// 交互结果
const busy = ref({ sameOrigin: false, getContent: false, insertContent: false, export: false })
const result = ref({ sameOrigin: '', getContent: '', insertContent: '', export: null })
const error = ref({ sameOrigin: '', postMessage: '', export: '' })

// ============ 打开文档：取元数据 → 签 token → 拼 iframe URL ============
async function openDoc() {
  try {
    const meta = await get(docId)
    if (!meta) {
      notFound.value = true
      return
    }
    doc.value = meta

    // 1. 调业务后端代理签 JWT（不直接调引擎 /api/token）
    const role = isViewer() ? 'viewer' : 'editor'
    tokenData.value = await fetchDocToken({
      doc: String(docId),
      name: auth.user?.name || '匿名',
      role,
    })

    // 2. 拼引擎 /embed URL
    const mode = role === 'viewer' ? 'view' : 'edit'
    iframeSrc.value = getEmbedUrl(String(docId), tokenData.value.token, mode, 'zh-CN', meta.title || '')
  } catch (e) {
    loadError.value = e.message || String(e)
  }
}

// 重新签 token（演示鉴权对接）
async function refreshToken() {
  try {
    const role = isViewer() ? 'viewer' : 'editor'
    tokenData.value = await fetchDocToken({
      doc: String(docId),
      name: auth.user?.name || '匿名',
      role,
    })
    toast.success('JWT 已重新签发')
  } catch (e) {
    toast.error('签发失败：' + (e.message || e))
  }
}

// ============ iframe 加载 & ready 监听 ============
function onIframeLoad() {
  // iframe DOM 加载完成，但编辑器可能还在连接协同
  // embed 页面会在编辑器 created 后 postMessage({ type: 'ready' })
}

// 监听 iframe 发来的 postMessage
function onMessage(e) {
  const { data } = e
  if (!data || typeof data.type !== 'string') return

  // embed 请求业务配置 → 回传（必须在编辑器挂载前送达，否则 embed 会用默认配置）
  if (data.type === 'request-config') {
    sendConfig()
    return
  }

  // 编辑器就绪通知
  if (data.type === 'ready') {
    editorReady.value = true
    return
  }

  // 导出结果（方案 B3）
  if (data.type === 'export:result') {
    busy.value.export = false
    if (data.ok) {
      result.value.export = { url: data.url, filename: data.data?.filename, size: data.data?.size }
      toast.success('导出成功，文件已回传业务后端')
    } else {
      error.value.export = data.error || '导出失败'
      toast.error('导出失败：' + (data.error || '未知错误'))
    }
    return
  }

  // 标准 postMessage 响应：<type>:result
  const match = data.type.match(/^(.+):result$/)
  if (!match) return
  const method = match[1]

  if (method === 'getContent') {
    busy.value.getContent = false
    if (data.ok) {
      result.value.getContent = typeof data.data === 'string' ? data.data : JSON.stringify(data.data)
    } else {
      error.value.postMessage = data.error || '取内容失败'
    }
    return
  }

  if (method === 'insertContent') {
    busy.value.insertContent = false
    if (data.ok) {
      result.value.insertContent = '已插入段落（postMessage）'
    } else {
      error.value.postMessage = data.error || '插入失败'
    }
    return
  }
}

// ============ 交互 2：同源直调 ============
function sameOriginGetHTML() {
  busy.value.sameOrigin = true
  error.value.sameOrigin = ''
  result.value.sameOrigin = ''
  try {
    const editor = iframeRef.value?.contentWindow?.__UMO_EDITOR__
    if (!editor) {
      throw new Error('无法访问 iframe 内编辑器（跨域或未就绪）。同源直调需配 nginx 反代使 iframe 与父页面同域。')
    }
    const html = editor.getHTML()
    result.value.sameOrigin = html || '(空文档)'
    toast.success('已通过同源直调取得 HTML')
  } catch (e) {
    error.value.sameOrigin = e.message || String(e)
    toast.error('同源直调失败，详见面板')
  } finally {
    busy.value.sameOrigin = false
  }
}

// ============ 交互 3：postMessage ============
function postToIframe(msg) {
  const iframe = iframeRef.value
  if (!iframe || !iframe.contentWindow) {
    toast.error('iframe 未就绪')
    return false
  }
  // targetOrigin 用引擎地址（dev 可 '*'）
  const engineOrigin = (() => {
    try {
      return new URL(getEngineUrl()).origin
    } catch {
      return '*'
    }
  })()
  iframe.contentWindow.postMessage(msg, engineOrigin)
  return true
}

// 下发业务配置给 embed（模板/用户目录/书签显示/分享/CDN，由业务系统控制）
// embed 挂载时会 postMessage({ type:'request-config' })，收到后调本函数回传。
function sendConfig() {
  postToIframe({ type: 'config', payload: editorConfig })
}

function pmGetContent() {
  busy.value.getContent = true
  error.value.postMessage = ''
  result.value.getContent = ''
  const reqId = `getContent-${Date.now()}`
  if (!postToIframe({ type: 'getContent', format: 'html', id: reqId })) {
    busy.value.getContent = false
  }
}

function pmInsertContent() {
  busy.value.insertContent = true
  error.value.postMessage = ''
  result.value.insertContent = ''
  const reqId = `insert-${Date.now()}`
  const content = `<p>由 postMessage 插入的段落（${new Date().toLocaleTimeString()}）</p>`
  if (!postToIframe({ type: 'insertContent', content, id: reqId })) {
    busy.value.insertContent = false
  }
}

// ============ 交互 4：导出回传（方案 B3） ============
function exportDocx() {
  busy.value.export = true
  error.value.export = ''
  result.value.export = null
  const reqId = `export-${Date.now()}`
  // callbackUrl 指向业务后端（demo-server）的接收接口
  const callbackUrl = `${getApiBase()}/api/receive-doc`
  const posted = postToIframe({
    type: 'export',
    format: 'docx',
    title: doc.value?.title || '文档',
    callbackUrl,
    id: reqId,
  })
  if (!posted) {
    busy.value.export = false
  }
}

// ============ 工具 ============
function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(1)} ${units[i]}`
}

function goBack() {
  router.push({ name: 'documents' })
}

// ============ 生命周期 ============
onMounted(() => {
  window.addEventListener('message', onMessage)
  openDoc()
})

onUnmounted(() => {
  window.removeEventListener('message', onMessage)
})
</script>

<style scoped>
.editor-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--demo-bg);
}

/* ===== 顶部栏 ===== */
.topbar {
  flex-shrink: 0;
  height: 52px;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid var(--demo-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.topbar-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--demo-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.spin {
  animation: demo-spin 1s linear infinite;
}
@keyframes demo-spin {
  to { transform: rotate(360deg); }
}

/* ===== 主体 ===== */
.editor-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

/* iframe 区 */
.iframe-wrap {
  flex: 1;
  min-width: 0;
  background: #fff;
}
.editor-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}

/* ===== 交互面板 ===== */
.demo-panel {
  flex-shrink: 0;
  width: 360px;
  background: #fff;
  border-left: 1px solid var(--demo-border);
  overflow-y: auto;
  padding: 16px 18px 24px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.panel-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--demo-text);
}
.panel-title .t-icon {
  color: var(--demo-primary);
}
.panel-close {
  flex-shrink: 0;
  color: var(--demo-text-tertiary);
}
.panel-close:hover {
  color: var(--demo-text);
  background: var(--demo-bg);
}
.panel-desc {
  margin: 0 0 20px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--demo-text-tertiary);
}
.panel-desc a {
  color: var(--demo-primary);
  text-decoration: none;
}
.panel-desc a:hover {
  text-decoration: underline;
}

/* 演示分区 */
.demo-section {
  padding: 14px 0;
  border-top: 1px solid var(--demo-border);
}
.demo-section:first-of-type {
  border-top: none;
}
.section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--demo-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--demo-text);
}
.section-desc {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--demo-text-tertiary);
}
.section-desc code {
  background: #f2f3f5;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
  color: var(--demo-text-secondary);
}

/* token 信息行 */
.token-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 按钮行 */
.btn-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* 结果展示 */
.result-box {
  margin-top: 8px;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  overflow: hidden;
}
.result-box.ok {
  background: #f0fff0;
  border: 1px solid #d9f7be;
}
.result-box.err {
  background: #fff1f0;
  border: 1px solid #ffccc7;
  color: #ef3f35;
}
.result-label {
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--demo-text-secondary);
  font-size: 11px;
}
.result-box pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow-y: auto;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}
.download-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--demo-primary);
  text-decoration: none;
  font-weight: 500;
}
.download-link:hover {
  text-decoration: underline;
}

/* 滑入动画 */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

/* ===== 缺省态 ===== */
.missing {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--demo-text-tertiary);
}
.missing-illu {
  width: 96px;
  height: 96px;
  border-radius: 24px;
  background: linear-gradient(135deg, #fff1f0, #fff7e8);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 44px;
  color: #ffccc7;
  margin-bottom: 24px;
}
.missing h3 {
  margin: 0 0 8px;
  font-size: 18px;
  color: var(--demo-text-secondary);
}
.missing p {
  margin: 0 0 24px;
  font-size: 14px;
}
.err-msg {
  color: #ef3f35;
  word-break: break-all;
}
.err-illu {
  background: linear-gradient(135deg, #fff1f0, #fff7e8);
  color: #ffccc7;
}
</style>
