<template>
  <div class="login">
    <!-- 左侧品牌区 -->
    <aside class="brand">
      <div class="brand-inner">
        <div class="brand-logo">
          <span class="brand-mark">U</span>
          <span class="brand-name">Umo 文档中心</span>
        </div>
        <h1 class="brand-title">在线文档<br />从这里开始协作</h1>
        <p class="brand-desc">
          基于 @umoteam/editor 的演示应用。登录后即可新建文档、在线编辑，体验类 Word 的富文本能力。
        </p>
        <ul class="brand-features">
          <li><span class="dot" />富文本编辑 · 分页排版</li>
          <li><span class="dot" />多角色权限 · 只读 / 可编辑</li>
          <li><span class="dot" />本地持久化 · 刷新不丢稿</li>
        </ul>
      </div>
      <div class="brand-decor decor-a" />
      <div class="brand-decor decor-b" />
      <div class="brand-decor decor-c" />
    </aside>

    <!-- 右侧登录卡片 -->
    <main class="panel">
      <div class="card">
        <header class="card-head">
          <h2>欢迎回来 👋</h2>
          <p>输入用户名、选择角色，进入工作台</p>
        </header>

        <form class="form" @submit.prevent="onSubmit">
          <label class="field">
            <span class="field-label">用户名</span>
            <t-input
              v-model="name"
              size="large"
              clearable
              placeholder="请输入你的名字"
              :status="nameError ? 'error' : 'default'"
              :tips="nameError"
              @blur="validateName"
              @enter="onSubmit"
            >
              <template #prefix-icon>
                <t-icon name="user" />
              </template>
            </t-input>
          </label>

          <div class="field">
            <span class="field-label">选择角色</span>
            <div class="roles">
              <button
                v-for="r in roleOptions"
                :key="r.value"
                type="button"
                class="role"
                :class="{ active: role === r.value }"
                @click="role = r.value"
              >
                <span class="role-icon" :style="{ background: r.color }">
                  <t-icon :name="r.icon" />
                </span>
                <span class="role-text">
                  <span class="role-name">{{ r.label }}</span>
                  <span class="role-desc">{{ r.desc }}</span>
                </span>
                <t-icon v-if="role === r.value" name="check-circle-filled" class="role-check" />
              </button>
            </div>
          </div>

          <div class="field">
            <span class="field-label">编辑模式</span>
            <div class="roles">
              <button
                v-for="m in modeOptions"
                :key="m.value"
                type="button"
                class="role"
                :class="{ active: mode === m.value }"
                @click="mode = m.value"
              >
                <span class="role-icon" :style="{ background: m.color }">
                  <t-icon :name="m.icon" />
                </span>
                <span class="role-text">
                  <span class="role-name">{{ m.label }}</span>
                  <span class="role-desc">{{ m.desc }}</span>
                </span>
                <t-icon v-if="mode === m.value" name="check-circle-filled" class="role-check" />
              </button>
            </div>
            <p v-if="mode === 'collab'" class="mode-tip">
              <t-icon name="info-circle" />
              协同模式需启动 demo 后端（:4001）与协同服务（:4000），见 README。
            </p>
          </div>

          <t-button
            theme="primary"
            size="large"
            block
            type="submit"
            :loading="loading"
            class="submit"
          >
            进入工作台
          </t-button>

          <p class="hint">
            <t-icon name="info-circle" />
            这是一个前端 demo，登录信息仅保存在本地浏览器。
          </p>
        </form>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Input as TInput, Button as TButton, Icon as TIcon } from 'tdesign-vue-next'

import { useToast } from '@/composables/useToast'
import { login } from '@/store/auth'

const router = useRouter()
const route = useRoute()
const toast = useToast()

const name = ref('')
const role = ref('editor')
const mode = ref('standalone')
const nameError = ref('')
const loading = ref(false)

const roleOptions = [
  {
    value: 'editor',
    label: '编辑者',
    desc: '可新建、编辑、删除文档',
    icon: 'edit-2',
    color: 'linear-gradient(135deg,#4d8cf2,#6aa6ff)',
  },
  {
    value: 'viewer',
    label: '只读者',
    desc: '仅可查看文档，不能修改',
    icon: 'browse',
    color: 'linear-gradient(135deg,#8a94a6,#aab4c5)',
  },
]

const modeOptions = [
  {
    value: 'standalone',
    label: '单机模式',
    desc: '文档存本浏览器，开箱即用',
    icon: 'desktop',
    color: 'linear-gradient(135deg,#52c41a,#73d13d)',
  },
  {
    value: 'collab',
    label: '协同模式',
    desc: '多人共享文档，实时同步编辑',
    icon: 'user-group',
    color: 'linear-gradient(135deg,#9254de,#b37feb)',
  },
]

function validateName() {
  if (!name.value.trim()) {
    nameError.value = '请输入用户名'
    return false
  }
  nameError.value = ''
  return true
}

function onSubmit() {
  if (!validateName()) {
    toast.warning('请先填写用户名')
    return
  }
  loading.value = true
  // 模拟一点登录延迟，让交互更真实
  setTimeout(() => {
    login(name.value, role.value, mode.value)
    toast.success(`欢迎你，${name.value.trim()}`)
    const redirect = route.query.redirect
    router.replace(typeof redirect === 'string' ? redirect : { name: 'documents' })
  }, 450)
}
</script>

<style scoped>
.login {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ===== 左侧品牌区 ===== */
.brand {
  position: relative;
  flex: 1.1;
  min-width: 0;
  color: #fff;
  background: linear-gradient(135deg, #2c5bd6 0%, #4d8cf2 55%, #6aa6ff 100%);
  overflow: hidden;
  display: flex;
  align-items: center;
}
.brand-inner {
  position: relative;
  z-index: 2;
  padding: 0 8%;
  max-width: 560px;
}
.brand-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 56px;
}
.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(4px);
  font-weight: 800;
  font-size: 20px;
}
.brand-title {
  font-size: 42px;
  line-height: 1.25;
  margin: 0 0 20px;
  font-weight: 700;
  letter-spacing: 1px;
}
.brand-desc {
  font-size: 15px;
  line-height: 1.8;
  margin: 0 0 36px;
  color: rgba(255, 255, 255, 0.88);
}
.brand-features {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.92);
}
.brand-features .dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  margin-right: 12px;
  vertical-align: middle;
}
/* 装饰圆 */
.brand-decor {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
}
.decor-a {
  width: 420px;
  height: 420px;
  right: -160px;
  top: -120px;
}
.decor-b {
  width: 220px;
  height: 220px;
  right: 10%;
  bottom: -80px;
  background: rgba(255, 255, 255, 0.06);
}
.decor-c {
  width: 120px;
  height: 120px;
  left: -40px;
  bottom: 18%;
  background: rgba(255, 255, 255, 0.05);
}

/* ===== 右侧表单区 ===== */
.panel {
  flex: 1;
  min-width: 420px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--demo-bg);
}
.card {
  width: 380px;
  max-width: calc(100% - 48px);
  background: var(--demo-card-bg);
  border-radius: var(--demo-radius);
  box-shadow: var(--demo-shadow-md);
  padding: 40px 36px 32px;
}
.card-head h2 {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 700;
}
.card-head p {
  margin: 0 0 28px;
  color: var(--demo-text-tertiary);
  font-size: 14px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--demo-text-secondary);
}

/* 角色卡片 */
.roles {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.role {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1.5px solid var(--demo-border);
  background: #fff;
  cursor: pointer;
  text-align: left;
  transition: all 0.18s ease;
  font: inherit;
}
.role:hover {
  border-color: #b3cdf6;
  transform: translateY(-1px);
}
.role.active {
  border-color: var(--demo-primary);
  box-shadow: 0 0 0 3px rgba(77, 140, 242, 0.12);
}
.role-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 20px;
}
.role-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.role-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--demo-text);
}
.role-desc {
  font-size: 12px;
  color: var(--demo-text-tertiary);
}
.role-check {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--demo-primary);
  font-size: 20px;
}

.submit {
  margin-top: 4px;
  font-weight: 600;
}

.hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--demo-text-tertiary);
}

.mode-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
  font-size: 12px;
  color: #d48806;
  background: #fff7e8;
  border: 1px solid #ffe7ba;
  border-radius: 6px;
  padding: 6px 10px;
}

/* 窄屏：隐藏左侧品牌区，表单铺满 */
@media (max-width: 880px) {
  .brand {
    display: none;
  }
  .panel {
    min-width: 0;
    flex: 1;
  }
}
</style>
