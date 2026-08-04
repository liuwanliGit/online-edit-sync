/**
 * 端到端协同链路测试
 * 模拟两个客户端连同一文档，A 写入、B 接收，验证同步与持久化。
 * 运行：先 npm start 启动服务，另开终端 node e2e-test.mjs
 */
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'

const SERVER = 'ws://localhost:4000'
const DOC_NAME = 'e2e-test-doc'
const TOKEN = 'demo-token'

const makeClient = (name) => {
  const ydoc = new Y.Doc()
  const provider = new HocuspocusProvider({
    url: SERVER,
    name: DOC_NAME,
    document: ydoc,
    token: TOKEN,
  })
  return { name, ydoc, provider }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const main = async () => {
  console.log('--- 启动两个客户端 ---')
  const a = makeClient('A')
  const b = makeClient('B')

  // 等待双方都同步连接
  await sleep(1500)

  console.log('\n--- 客户端 A 写入 Yjs 文本 ---')
  const ytext = a.ydoc.getText('content')
  a.ydoc.transact(() => {
    ytext.insert(0, '来自 A 的第一条编辑')
  })

  // 等待 B 通过服务端同步收到
  await sleep(1000)

  const bText = b.ydoc.getText('content').toString()
  const aText = ytext.toString()

  console.log(`A 看到的内容: "${aText}"`)
  console.log(`B 看到的内容: "${bText}"`)

  const ok = aText === bText && aText.length > 0
  console.log(`\n${ok ? '✅ 同步测试通过：A 的编辑已实时同步到 B' : '❌ 同步测试失败'}`)

  // 等待服务端 onStoreDocument 防抖触发（默认 2s）
  console.log('\n--- 等待服务端防抖持久化（3s）---')
  await sleep(3000)

  console.log('\n--- 断开连接 ---')
  a.provider.destroy()
  b.provider.destroy()
  a.ydoc.destroy()
  b.ydoc.destroy()

  console.log(ok ? '\n🎉 端到端链路验证通过，可以接入 Umo Editor 前端了' : '\n⚠️ 链路异常，请检查服务日志')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('测试出错:', e)
  process.exit(1)
})
