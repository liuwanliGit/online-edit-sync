# Umo Editor 库使用文档

`@umoteam/editor` 是一个基于 Vue3 + Tiptap3 的文档编辑器**组件库**。本仓库执行 `npm run build` 后，`dist/` 下会生成两个文件，这就是库的全部产物：

```
dist/
├── umo-editor.js    # 组件库主文件（ESM）
└── umo-editor.css   # 样式文件
```

任何 Vue3 项目都可以通过 `import` 把它接进来，几分钟搭起一个类 Word 的文档编辑器。本文档讲清楚：怎么装、怎么用、怎么配置、怎么保存、怎么接入协同。

> 说明：仓库里的 `src/app.vue` / `src/main.js` / `index.html` 是**本地联调 demo**，不参与 `npm run build`，不会进入产物。它们就是下面示例代码的真实来源，可以直接参考。

---

## 一、安装

### 方式 A：直接用已发布的 npm 包（推荐，最简单）

```bash
npm install @umoteam/editor
```

`@umoteam/editor` 已发布到 npm，依赖 Vue3 与 Tiptap3，装包时会自动带上。

### 方式 B：用本仓库自己构建的产物

如果你想改源码或用未发布的版本：

```bash
# 1. 在本仓库构建产物
cd D:\workspace\editor
npm install
npm run build          # 产出 dist/umo-editor.js + dist/umo-editor.css

# 2. 在你的业务项目里直接引用本地产物
npm install D:/workspace/editor   # 或 npm link
```

之后在业务项目里 `import` 的写法完全一样（见下一节）。

---

## 二、最小可用示例

### 1. 注册插件 + 引入样式（在应用入口）

```js
// main.js
import { createApp } from 'vue'
import { useUmoEditor } from '@umoteam/editor'
import '@umoteam/editor/style'   // 引入样式（对应 dist/umo-editor.css）

import App from './App.vue'

const app = createApp(App)
// 通过插件注册全局组件 <umo-editor>，第二个参数是全局默认配置（可选）
app.use(useUmoEditor, {})
app.mount('#app')
```

> 如果是方式 B（本地产物），把 `@umoteam/editor` 换成本仓库包名即可，引用路径不变。

### 2. 在组件里使用

```vue
<!-- App.vue -->
<template>
  <umo-editor
    :toolbar="{ defaultMode: 'ribbon' }"
    :document="{ title: '我的文档', content: '<p>开始编辑吧</p>' }"
    @save="onSave"
  />
</template>

<script setup>
function onSave(content, page, document) {
  console.log('保存内容：', content.html)
  // TODO: 把 content.html 提交到你的后端
}
</script>
```

打开页面，一个带工具栏、分页、富文本编辑能力的编辑器就跑起来了。**这就是全部的最小接入**——一个 `<umo-editor>` 标签。

---

## 三、常用配置（通过 props 传入）

所有配置都通过 `:xxx` prop 传给 `<umo-editor>`。下面是最常用的几项（完整字段见 `src/options/config/index.js`）。

### 3.1 文档内容

```js
:document="{
  title: '季度报告',          // 文档标题
  content: '<p>初始内容</p>', // 初始 HTML，留空则空白文档
  readOnly: false,           // 是否只读
  autofocus: true,           // 是否自动聚焦
  enableMarkdown: true,      // 是否启用 Markdown 语法
}"
```

### 3.2 工具栏

```js
:toolbar="{
  defaultMode: 'ribbon',    // 'ribbon'（默认）| 'classic'
  menus: ['base', 'insert', 'table', 'tools', 'page', 'view', 'export'],
}"
```

`menus` 数组控制显示哪些菜单组，去掉某项即不显示该功能。

### 3.3 页面与外观

```js
:page="{
  layouts: ['page', 'web'],          // 支持 'page'（分页，类 Word）和 'web'（流式）
  defaultOrientation: 'portrait',    // 'portrait' 纵向 | 'landscape' 横向
  watermark: { text: '内部文档' },   // 水印
}"
:height="'600px'"          // 编辑器高度，支持 CSS 值
:theme="'light'"           // 'light' | 'dark' | 'auto'
:locale="'zh-CN'"          // 'zh-CN' | 'en-US'
```

### 3.4 多个独立实例

```vue
<umo-editor editor-key="doc-a" :document="{ title: '文档 A' }" />
<umo-editor editor-key="doc-b" :document="{ title: '文档 B' }" />
```

`editorKey` 用于区分多个编辑器实例，**同一页面多实例时必须各不相同**。

---

## 四、保存与文件上传

这两个是接入业务系统时最关键的回调。

### 4.1 保存（`onSave` 选项）

```js
const options = {
  async onSave(content, page, document) {
    // content.html  —— HTML 字符串，最常用
    // content.json  —— Tiptap JSON，适合后续再编辑
    // page          —— 页面设置（页边距、纸张等）
    // document      —— 文档元信息（标题等）
    await fetch('/api/documents/123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: content.html }),
    })
    return '保存成功'   // 返回字符串会作为提示展示给用户
  },
}
```

把 `options` 作为 `<umo-editor v-bind="options">` 传入即可。工具栏点"保存"或触发自动保存时调用。

### 4.2 文件/图片上传（`onFileUpload`）

```js
const options = {
  async onFileUpload(file) {
    // file 是用户选择的文件对象
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: formData })
    const data = await res.json()
    // 必须返回这个结构，编辑器据此插入文件
    return {
      id: data.id,
      url: data.url,      // 可访问的文件 URL
      name: file.name,
      type: file.type,
      size: file.size,
    }
  },
  onFileDelete(id, url, type) {
    // 可选：文件被删除时通知后端清理
    fetch('/api/upload/' + id, { method: 'DELETE' })
  },
}
```

---

## 五、接入协同编辑（多人实时协作）

本仓库内置了基于 **Yjs + Hocuspocus** 的协同能力。**接入方需要先部署协同服务**（见 `collab-server/README.md`），然后按下面的方式启用。

### 5.1 部署协同服务

```bash
cd D:\workspace\editor\collab-server
npm install --omit=dev
JWT_SECRET="<强随机密钥>" PORT=4000 node server.js
```

### 5.2 前端启用协同

协同地址通过**运行时全局变量**配置，无需重新构建：

```js
// 在创建编辑器之前设置一次（dev 不设则兜底 ws://localhost:4000）
window.__UMO_COLLAB_URL__ = 'wss://collab.your-domain.com'
```

协同能力需要注入扩展（参考仓库 `src/app.vue` 的完整实现）。核心三步：

```js
import Collaboration from '@tiptap/extension-collaboration'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'

// 1. 建立 Yjs 文档 + 协同连接
const ydoc = new Y.Doc()
const provider = new HocuspocusProvider({
  url: window.__UMO_COLLAB_URL__ || 'ws://localhost:4000',
  name: 'my-doc',         // 文档名，同名 = 同一篇文档
  document: ydoc,
  token: async () => {
    const res = await fetch(`https://collab.your-domain.com/api/token?name=alice&doc=my-doc&role=editor`)
    const data = await res.json()
    return data.token
  },
})

// 2. 注入协同扩展
const collabExtensions = [
  Collaboration.configure({ document: ydoc }),
  // 远程光标扩展（详见 src/app.vue）
]

// 3. 传给编辑器，并禁用内置的 UndoRedo（改用 Yjs 的撤销栈）
<umo-editor
  :extensions="collabExtensions"
  :disable-extensions="['undoRedo']"
  :document="{ content: '' }"   <!-- 协同模式内容由服务端驱动，留空 -->
/>
```

完整实现（含远程光标、权限控制、协作者列表）直接参考 `src/app.vue`，那是一份可运行的真实范例。

### 5.3 协同模式 URL 参数（demo 入口）

如果你跑的是仓库自带的 dev demo（`npm run dev`），协同通过 URL 参数切换：

| 参数 | 说明 |
|---|---|
| `?collab=1` | 启用协同（不带即单机模式，不受协同代码影响） |
| `?doc=xxx` | 指定文档名（多文档隔离） |
| `?role=viewer` | 只读模式（生产应由业务系统签发的 JWT role 决定） |

```
http://localhost:9000/umo-editor/?collab=1&doc=my-doc&role=viewer
```

---

## 六、peerDependencies 说明

库把以下依赖**外部化**（external）了，意味着它们不会被打进 `umo-editor.js`，需要由你的宿主项目提供。这是库的标准做法，避免重复打包：

```jsonc
{
  "vue": "^3.5.0",           // 必须，宿主项目本来就是 Vue3
  "tiptap3 相关包": ">=3.x",  // 用到时按需安装
  // 完整列表见 package.json 的 dependencies
}
```

如果你用的是方式 A（`npm install @umoteam/editor`），npm 会自动装好这些依赖，无需手动处理。**只有在方式 B（手动引本地产物）且宿主项目缺少这些包时，才需要手动补装。**

---

## 七、常见问题

**Q: 编辑器样式错乱 / 没有样式？**
A: 忘了引入样式。在入口加 `import '@umoteam/editor/style'`。

**Q: 控制台报 "vue is not defined" 之类？**
A: 宿主项目没装 Vue3，或 Vue 版本不是 3.x。库要求 Vue3。

**Q: 多个编辑器实例互相干扰？**
A: 没给每个实例设置不同的 `editor-key`。

**Q: 协同模式下编辑器一直显示"正在连接协同服务…"？**
A: 协同服务没启动，或 `window.__UMO_COLLAB_URL__` 指向的地址连不上。先 `npm start` 跑 `collab-server`，再检查地址（生产是 `wss://`，本地是 `ws://localhost:4000`）。

**Q: 我只想发布升级这个库到 npm？**
A: 直接 `npm publish`（会自动触发 `prepublishOnly` 跑 build）。`dist/` 下那两个文件就是发布物，符合预期。

---

## 八、参考

- 完整配置项：`src/options/config/index.js`
- 协同完整范例：`src/app.vue`
- 协同服务部署：`collab-server/README.md`
- 协同设计背景与踩坑记录：`COLLAB_HANDOFF.md`
- 官方文档：[https://dev.umodoc.com/cn/docs/editor](https://dev.umodoc.com/cn/docs/editor)
