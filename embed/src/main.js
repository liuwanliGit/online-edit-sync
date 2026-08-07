import { createApp } from 'vue'

// Umo Editor：注册全局组件 <umo-editor> + 引入样式
import { useUmoEditor } from '@umoteam/editor'
import '@umoteam/editor/style'

import App from './App.vue'

const app = createApp(App)
app.use(useUmoEditor, {})
app.mount('#app')
