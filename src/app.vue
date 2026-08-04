<template>
  <div class="examples">
    <div class="box">
      <!--
        协同模式下，等 HocuspocusProvider 首次同步完成（synced）后再挂载编辑器，
        确保 y-prosemirror binding 建立时 Yjs 文档已是稳定状态，避免选区转换竞争。
      -->
      <umo-editor v-if="editorReady" ref="editorRef" v-bind="options"></umo-editor>
      <div v-else class="loading">正在连接协同服务…</div>
    </div>
    <!-- <div class="box">
      <umo-editor editor-key="testaaa" :toolbar="{ defaultMode: 'classic' }" />
    </div> -->
  </div>
</template>

<script setup>
import Collaboration from '@tiptap/extension-collaboration'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { onUnmounted, ref } from 'vue'
import * as Y from 'yjs'

import { shortId } from '@/utils/short-id'

// ============ 协同模式开关（URL 带 ?collab=1 启用）============
const collabEnabled = new URLSearchParams(window.location.search).has('collab')

// 每个浏览器标签页作为一个独立的"协作者"，用随机用户名区分光标
const collabUser = {
  name: `用户-${Math.floor(Math.random() * 1000)}`,
  color: `hsl(${Math.floor(Math.random() * 360)}, 80%, 50%)`,
}

// 协同文档：所有 ?collab=1 的标签页连到同一篇文档 demo-doc
let ydoc = null
let provider = null
const collabExtensions = []
// 协同模式下编辑器需等 provider 首次同步完成后再挂载；单机模式立即可用
const editorReady = ref(!collabEnabled)
if (collabEnabled) {
  ydoc = new Y.Doc()
  provider = new HocuspocusProvider({
    url: 'ws://localhost:4000',
    name: 'demo-doc', // 同名 = 同一篇文档，多人协作
    document: ydoc,
    token: 'demo-token',
  })
  // 把当前用户信息写进 awareness，用于显示光标和昵称
  provider.setAwarenessField('user', collabUser)
  // 首次同步完成后才挂载编辑器，确保 binding 基于稳定的 Yjs 文档状态
  provider.on('synced', () => {
    console.log('[collab] 服务端首次同步完成，挂载编辑器')
    editorReady.value = true
  })
  // 修复 y-prosemirror 初始化竞争：
  // Umo 的文档 schema 是 block+，ProseMirror 会强制创建一个默认空段落，
  // 而 Yjs 文档初始为空。ySyncPlugin 的 update 钩子认为"ProseMirror 内容和默认一致"
  // 就不会同步到 Yjs，导致 Yjs 永远空、ProseMirror 有段落，两者不同步。
  // yUndoPlugin 在初始事务时转换选区会触发 findRootTypeKey "Unexpected case"。
  // 预填充一个空段落到 Yjs，让两边初始状态对齐。
  const fragment = ydoc.getXmlFragment('default')
  if (fragment.length === 0) {
    const para = new Y.XmlElement('paragraph')
    fragment.push([para])
  }
  collabExtensions.push(Collaboration.configure({ document: ydoc }))
  console.log(`[collab] 已启用协同，当前用户: ${collabUser.name}`)
}

const editorRef = $ref(null)
const remoteMentionUsers = [
  {
    id: 'remote-alice',
    label: 'Alice Chen',
    bio: '远程目录用户',
    color: 'var(--umo-primary-color)',
  },
  {
    id: 'remote-bob',
    label: 'Bob Li',
    bio: '远程目录用户',
    color: 'var(--umo-primary-color)',
  },
  {
    id: 'remote-charlie',
    label: 'Charlie Wang',
    bio: '远程目录用户',
    color: 'var(--umo-primary-color)',
  },
  {
    id: 'remote-dora',
    label: 'Dora Xu',
    bio: '远程目录用户',
    color: 'var(--umo-primary-color)',
  },
]
const templates = [
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
]
const options = $ref({
  // theme: 'auto',
  // skin: 'modern',
  toolbar: {
    // defaultMode: 'classic',
    // menus: ['base'],
  },
  document: {
    title: '测试文档',
    // 协同模式下内容来自 Y.Doc（服务端），不要用 localStorage 的本地内容覆盖
    content: collabEnabled ? '' : localStorage.getItem('document.content') || '<p>测试文档</p>',
    // structure: 'heading block*',
  },
  page: {
    layouts: ['page', 'web'],
    showBookmark: true,
  },
  templates,
  cdnUrl: 'https://cdn.umodoc.com',
  shareUrl: 'https://www.umodoc.com',
  file: {
    // allowedMimeTypes: [
    //   'application/pdf',
    //   'image/svg+xml',
    //   'video/mp4',
    //   'audio/*',
    // ],
  },
  user: {
    id: 'umoeditor',
    label: 'Umo Editor',
    avatar: 'https://tdesign.gtimg.com/site/avatar.jpg',
  },
  users: [
    {
      id: 'umodoc',
      label: 'Umo Team',
      bio: '核心开发者',
      avatar: 'https://s1.umodoc.com/images/favicon.png',
      color: 'var(--umo-primary-color)',
    },
    {
      id: 'china-wangxu',
      label: 'china-wangxu',
      bio: '重要贡献者',
      color: 'var(--umo-primary-color)',
    },
    {
      id: 'Cassielxd',
      label: 'Cassielxd',
      bio: '重要贡献者',
      color: 'var(--umo-primary-color)',
    },
    { id: 'Goldziher', label: "Na'aman Hirschfeld" },
    { id: 'SerRashin', label: 'SerRashin' },
    { id: 'ChenErik', label: 'ChenErik' },
    { id: 'china-wangxu', label: 'china-wangxu' },
    { id: 'Sherman Xu', label: 'xuzhenjun130' },
    { id: 'testuser', label: '测试用户' },
  ],
  async onMentionSearch(query) {
    await new Promise((resolve) => setTimeout(resolve, 800))
    return remoteMentionUsers.filter((user) =>
      user.label.toLowerCase().includes(query.toLowerCase()),
    )
  },
  // https://dev.umodoc.com/cn/docs/options/extensions#disableextensions
  // 协同模式：禁用 UndoRedo（它注册的 history 插件与 Collaboration 自带的 Yjs history 互斥，
  // 会触发 y-prosemirror 的 findRootTypeKey "Unexpected case" 报错）
  disableExtensions: collabEnabled ? ['undoRedo'] : [],
  // 协同模式：注入 Collaboration 扩展；单机模式：空数组（不影响原有逻辑）
  extensions: collabExtensions,
  async onSave(content, page, document) {
    // 协同模式下文档由服务端持久化，跳过本地 localStorage 写入
    if (collabEnabled) {
      return '协同模式：已由服务端自动保存'
    }
    // 将文档和评论线程保存到 localStorage
    localStorage.setItem('document.content', content.html)
    // 模拟保存等待过程
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('onSave', { content, page, document })
        resolve('文档保存成功')
      }, 2000)
    })
  },
  async onFileUpload(file) {
    if (!file) {
      throw new Error('没有找到要上传的文件')
    }
    console.log('onUpload', file)
    await new Promise((resolve) => setTimeout(resolve, 3000))
    return {
      id: shortId(),
      url: file.url || URL.createObjectURL(file),
      name: file.name,
      type: file.type,
      size: file.size,
    }
  },
  onFileDelete(id, url, type) {
    console.log(id, url, type)
  },
})

// 协同模式：组件卸载时清理连接，避免热更新泄漏
onUnmounted(() => {
  if (provider) provider.destroy()
  if (ydoc) ydoc.destroy()
})
</script>

<style>
html,
body {
  padding: 0;
  margin: 0;
}
.examples {
  margin: 20px;
  display: flex;
  height: calc(100vh - 40px);
}
.box {
  border: solid 1px #ddd;
  box-sizing: border-box;
  position: relative;
  width: 100%;
  height: 100%;
}
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #888;
  font-size: 14px;
}

html,
body {
  height: 100vh;
  overflow: hidden;
}
</style>
