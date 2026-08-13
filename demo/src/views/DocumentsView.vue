<template>
  <div class="docs">
    <!-- 顶部栏 -->
    <header class="topbar">
      <div class="topbar-left">
        <span class="logo">
          <span class="logo-mark">U</span>
          <span class="logo-text">Umo 文档中心</span>
        </span>
      </div>
      <div class="topbar-right">
        <span class="greeting">你好，{{ auth.user?.name }}</span>
        <t-tag
          :theme="isViewer() ? 'default' : 'primary'"
          variant="light"
          shape="round"
          size="small"
        >
          <template #icon>
            <t-icon :name="isViewer() ? 'browse' : 'edit-2'" />
          </template>
          {{ isViewer() ? '只读者' : '编辑者' }}
        </t-tag>
        <t-divider layout="vertical" />
        <t-button theme="default" variant="text" shape="square" @click="onLogout">
          <template #icon><t-icon name="poweroff" /></template>
        </t-button>
      </div>
    </header>

    <!-- 主内容 -->
    <main class="content">
      <div class="content-head">
        <div>
          <h1 class="page-title">我的文档</h1>
          <p class="page-sub">共 {{ docs.length }} 篇文档 · {{ isViewer() ? '当前为只读模式' : '点击卡片开始编辑' }}</p>
        </div>
        <div v-if="!isViewer()" class="content-actions">
          <t-button theme="primary" @click="openCreate">
            <template #icon><t-icon name="add" /></template>
            新建文档
          </t-button>
          <t-button theme="default" variant="outline" :loading="importing" @click="triggerUpload">
            <template #icon><t-icon name="upload" /></template>
            上传文档
          </t-button>
          <input
            ref="fileInputRef"
            type="file"
            accept=".txt,.docx"
            class="hidden-file-input"
            @change="onFileSelected"
          />
        </div>
      </div>

      <!-- 卡片网格 -->
      <div v-if="docs.length" class="grid">
        <article
          v-for="doc in docs"
          :key="doc.id"
          class="card"
          @click="openDoc(doc)"
        >
          <div class="card-accent" />
          <div class="card-body">
            <div class="card-title-row">
              <h3 class="card-title">{{ doc.title || '无标题文档' }}</h3>
              <t-icon name="file" class="card-file-icon" />
            </div>
            <p class="card-summary">
              {{ doc.excerpt || '（暂无内容，点击打开开始编辑）' }}
            </p>
            <div class="card-meta">
              <span class="meta-author">
                <t-icon name="user" />
                {{ doc.createdBy || '匿名' }}
              </span>
              <span class="meta-time">
                <t-icon name="time" />
                {{ relativeTime(doc.updatedAt) }}
              </span>
            </div>
          </div>

          <div class="card-actions">
            <t-tooltip content="打开" placement="top" :show-arrow="true">
              <button class="action" @click.stop="openDoc(doc)">
                <t-icon name="browse" />
              </button>
            </t-tooltip>
            <t-tooltip v-if="!isViewer()" content="删除" placement="top" :show-arrow="true">
              <button class="action danger" @click.stop="confirmDelete(doc)">
                <t-icon name="delete" />
              </button>
            </t-tooltip>
          </div>
        </article>
      </div>

      <!-- 加载中 -->
      <div v-else-if="loading" class="empty">
        <div class="empty-illu loading-spin"><t-icon name="loading" /></div>
        <h3>正在加载文档…</h3>
      </div>

      <!-- 加载失败（后端连不上） -->
      <div v-else-if="loadError" class="empty">
        <div class="empty-illu err-illu"><t-icon name="error-triangle" /></div>
        <h3>无法加载文档</h3>
        <p>{{ loadError }}</p>
        <p class="err-tip">请确认示例后端已启动（默认 http://localhost:4001）</p>
        <t-button theme="primary" variant="outline" @click="loadDocs">
          <template #icon><t-icon name="refresh" /></template>
          重新加载
        </t-button>
      </div>

      <!-- 空状态 -->
      <div v-else class="empty">
        <div class="empty-illu">
          <t-icon name="file-paste" />
        </div>
        <h3>{{ isViewer() ? '还没有可查看的文档' : '还没有文档' }}</h3>
        <p v-if="!isViewer()">点击「新建文档」开始创建你的第一篇文档</p>
        <p v-else>请用「编辑者」角色登录后新建文档</p>
        <t-button v-if="!isViewer()" theme="primary" variant="outline" @click="openCreate">
          <template #icon><t-icon name="add" /></template>
          新建文档
        </t-button>
      </div>
    </main>

    <!-- 新建文档对话框 -->
    <t-dialog
      v-model:visible="createVisible"
      header="新建文档"
      :confirm-btn="{ content: '创建并编辑', loading: creating }"
      cancel-btn="取消"
      :on-confirm="doCreate"
      @closed="createTitle = ''"
    >
      <t-form @submit.prevent>
        <t-form-item label="文档标题" name="title">
          <t-input
            v-model="createTitle"
            placeholder="请输入文档标题，回车创建"
            clearable
            maxlength="60"
            @enter="doCreate"
          />
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- 删除确认对话框 -->
    <t-dialog
      v-model:visible="deleteVisible"
      header="删除文档"
      theme="danger"
      :confirm-btn="{ content: '确认删除', theme: 'danger', loading: deleting }"
      cancel-btn="取消"
      :on-confirm="doDelete"
    >
      确定要删除文档「<strong>{{ pendingDelete?.title || '无标题文档' }}</strong>」吗？删除后无法恢复。
    </t-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Button as TButton,
  Tag as TTag,
  Icon as TIcon,
  Divider as TDivider,
  Tooltip as TTooltip,
  Dialog as TDialog,
  Input as TInput,
  Form as TForm,
  FormItem as TFormItem,
} from 'tdesign-vue-next'

import { useToast } from '@/composables/useToast'
import { auth, isViewer, logout } from '@/store/auth'
import { list, create, remove, upload, relativeTime, MAX_IMPORT_SIZE } from '@/store/documents'

const router = useRouter()
const toast = useToast()

// 文档列表（响应式）+ 加载/失败态
const docs = ref([])
const loading = ref(false)
const loadError = ref('')

async function loadDocs() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await list()
    docs.value = Array.isArray(result) ? result : []
  } catch (e) {
    loadError.value = e.message || '加载失败'
    docs.value = []
  } finally {
    loading.value = false
  }
}
loadDocs()

// 新建
const createVisible = ref(false)
const createTitle = ref('')
const creating = ref(false)

function openCreate() {
  createTitle.value = ''
  createVisible.value = true
}

async function doCreate() {
  creating.value = true
  try {
    const id = await create(createTitle.value, auth.user?.name)
    createVisible.value = false
    toast.success('文档已创建')
    router.push({ name: 'editor', params: { id } })
  } catch (e) {
    toast.error('创建失败：' + (e.message || '未知错误'))
  } finally {
    creating.value = false
  }
}

function openDoc(doc) {
  router.push({ name: 'editor', params: { id: doc.id } })
}

// 上传文档导入
const fileInputRef = ref(null)
const importing = ref(false)

function triggerUpload() {
  fileInputRef.value?.click()
}

async function onFileSelected(e) {
  const file = e.target.files?.[0]
  // 重置 input，使同一文件可再次选择
  e.target.value = ''
  if (!file) return

  // 前端预校验体积
  if (file.size > MAX_IMPORT_SIZE) {
    toast.error(`文件超过 2MB 限制（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`)
    return
  }

  importing.value = true
  try {
    const result = await upload(file)
    // 把转换后的 HTML 暂存 sessionStorage（避免超大 URL）
    sessionStorage.setItem(`import-content-${result.id}`, result.html)
    toast.success('文档已导入，正在打开…')
    router.push({ name: 'editor', params: { id: result.id }, query: { import: '1' } })
  } catch (err) {
    toast.error('导入失败：' + (err.message || '未知错误'))
  } finally {
    importing.value = false
  }
}

// 删除
const deleteVisible = ref(false)
const pendingDelete = ref(null)
const deleting = ref(false)

function confirmDelete(doc) {
  pendingDelete.value = doc
  deleteVisible.value = true
}

async function doDelete() {
  if (!pendingDelete.value) return
  deleting.value = true
  try {
    const ok = await remove(pendingDelete.value.id)
    deleteVisible.value = false
    pendingDelete.value = null
    if (ok) {
      toast.success('文档已删除')
      await loadDocs()
    } else {
      toast.error('删除失败：文档不存在')
    }
  } catch (e) {
    toast.error('删除失败：' + (e.message || '未知错误'))
  } finally {
    deleting.value = false
  }
}

function onLogout() {
  logout()
  toast.info('已退出登录')
  router.replace({ name: 'login' })
}
</script>

<style scoped>
.docs {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--demo-bg);
}

/* ===== 顶部栏 ===== */
.topbar {
  flex-shrink: 0;
  height: 60px;
  padding: 0 32px;
  background: #fff;
  border-bottom: 1px solid var(--demo-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: var(--demo-shadow-sm);
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 17px;
}
.logo-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: linear-gradient(135deg, #4d8cf2, #6aa6ff);
  color: #fff;
  font-size: 16px;
}
.logo-text {
  background: linear-gradient(90deg, #4d8cf2, #6aa6ff);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.greeting {
  font-size: 14px;
  color: var(--demo-text-secondary);
  font-weight: 500;
}

/* ===== 主内容 ===== */
.content {
  flex: 1;
  overflow-y: auto;
  padding: 32px 40px 48px;
}
.content-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 28px;
}
.content-actions {
  display: flex;
  gap: 12px;
}
.hidden-file-input {
  display: none;
}
.page-title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
}
.page-sub {
  margin: 6px 0 0;
  color: var(--demo-text-tertiary);
  font-size: 13px;
}

/* ===== 卡片网格 ===== */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}
.card {
  position: relative;
  background: var(--demo-card-bg);
  border-radius: var(--demo-radius);
  box-shadow: var(--demo-shadow-sm);
  border: 1px solid var(--demo-border);
  cursor: pointer;
  overflow: hidden;
  transition: all 0.2s ease;
}
.card:hover {
  transform: translateY(-4px);
  box-shadow: var(--demo-shadow-lg);
  border-color: #c9daf7;
}
.card-accent {
  height: 5px;
  background: linear-gradient(90deg, #4d8cf2, #6aa6ff);
}
.card-body {
  padding: 20px 22px 18px;
}
.card-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.card-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--demo-text);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-file-icon {
  color: var(--demo-text-tertiary);
  font-size: 18px;
  flex-shrink: 0;
}
.card-summary {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--demo-text-tertiary);
  min-height: 44px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: var(--demo-text-tertiary);
}
.card-meta .meta-author,
.card-meta .meta-time {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 悬浮操作按钮 */
.card-actions {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transform: translateY(-4px);
  transition: all 0.18s ease;
}
.card:hover .card-actions {
  opacity: 1;
  transform: translateY(0);
}
.action {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: rgba(29, 33, 41, 0.06);
  color: var(--demo-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: all 0.15s ease;
}
.action:hover {
  background: var(--demo-primary);
  color: #fff;
}
.action.danger:hover {
  background: #ef3f35;
}

/* ===== 空状态 ===== */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  text-align: center;
  color: var(--demo-text-tertiary);
}
.empty-illu {
  width: 96px;
  height: 96px;
  border-radius: 24px;
  background: linear-gradient(135deg, #eef3fc, #f5f7fa);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 44px;
  color: #9bb7ee;
  margin-bottom: 24px;
}
.empty h3 {
  margin: 0 0 8px;
  font-size: 18px;
  color: var(--demo-text-secondary);
}
.empty p {
  margin: 0 0 24px;
  font-size: 14px;
}
.loading-spin {
  color: var(--demo-primary);
  animation: demo-spin 1s linear infinite;
}
@keyframes demo-spin {
  to {
    transform: rotate(360deg);
  }
}
.err-illu {
  background: linear-gradient(135deg, #fff1f0, #fff7e8);
  color: #ffccc7;
}
.err-tip {
  color: var(--demo-text-tertiary) !important;
  font-size: 12px !important;
  margin-top: -12px !important;
}
</style>
