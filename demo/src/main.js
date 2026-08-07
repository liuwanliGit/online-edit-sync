import { createApp } from 'vue'
import TDesign from 'tdesign-vue-next'
import 'tdesign-vue-next/es/style/index.css'

import App from './App.vue'
import router from './router'
import './styles/global.css'

const app = createApp(App)

app.use(router)
app.use(TDesign)

app.mount('#app')
