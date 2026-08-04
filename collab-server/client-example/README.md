# Umo Editor 前端接入协同示例

把下面这段代码接入你的 Umo Editor 实例即可连接阶段一协同服务。

## 1. 安装前端依赖

```bash
# 在你的业务项目里（不是 editor 本仓库）
npm install @tiptap/extension-collaboration @hocuspocus/provider yjs
```

> 版本要求：`yjs` 必须与编辑器内置版本一致（`13.6.29`），否则 CRDT 协议可能不兼容。

## 2. Vue3 接入代码

```vue
<template>
  <UmoEditor
    :options="options"
    :extensions="collabExtensions"
  />
</template>

<script setup>
import { ref, onUnmounted } from 'vue'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import Collaboration from '@tiptap/extension-collaboration'

// 1. 创建 Yjs 文档
const ydoc = new Y.Doc()

// 2. 连接协同服务（token 与 server.js 里的 AUTH_TOKEN 一致）
const provider = new HocuspocusProvider({
  url: 'ws://localhost:4000',
  name: 'demo-doc-001',        // 文档 ID（同 ID 的人会进入同一篇文档协作）
  document: ydoc,
  token: 'demo-token',         // 阶段一写死的 token
})

// 3. 把 Collaboration 扩展注入编辑器
const collabExtensions = [
  Collaboration.configure({ document: ydoc }),
]

const options = ref({
  // 你的常规 Umo Editor 配置
  document: { content: '' },  // 协同模式下 content 可留空，由 Y.Doc 驱动
})

// 4. 组件卸载时清理连接
onUnmounted(() => {
  provider.destroy()
  ydoc.destroy()
})
</script>
```

## 3. 验证协同效果

1. 启动协同服务：在本目录 `collab-server/` 下执行 `npm install && npm start`
2. 用上面的代码起两个浏览器窗口（或两台机器）
3. 在窗口 A 编辑，窗口 B 应**实时**看到变化；两个光标应互相可见

## 4. 已知限制（阶段一）

- 服务重启后文档丢失（仅内存持久化）
- token 写死，无真实鉴权
- 单进程，不支持横向扩展
- 无光标用户名显示（需要在 provider.awareness 里补充用户信息，见阶段二）
