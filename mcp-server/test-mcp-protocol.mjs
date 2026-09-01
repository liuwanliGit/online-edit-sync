// MCP 协议层端到端测试:spawn server.mjs,走 initialize → tools/list → tools/call
// 运行: node test-mcp-protocol.mjs
import { spawn } from 'child_process'

const proc = spawn('node', ['server.mjs'], {
  cwd: new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  stdio: ['pipe', 'pipe', 'inherit'],
})

let buf = ''
const pending = new Map()
let nextId = 1

proc.stdout.on('data', (chunk) => {
  buf += chunk.toString()
  let idx
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
})

function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)))
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => reject(new Error(`rpc ${method} 超时`)), 60000)
  })
}

function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

// 1. initialize 握手
const init = await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'test-client', version: '0.0.1' },
})
console.log('✓ initialize:', init.serverInfo.name, init.serverInfo.version)
notify('notifications/initialized', {})

// 2. tools/list
const tools = await rpc('tools/list', {})
console.log('✓ tools/list:', tools.tools.map((t) => t.name).join(', '))

// 3. tools/call create_report_docx(走 MCP 协议生成真实报表)
const call = await rpc('tools/call', {
  name: 'create_report_docx',
  arguments: {
    title: 'MCP协议层验证报表',
    outputDir: 'output',
    blocks: [
      { type: 'heading', level: 1, text: 'MCP 协议层验证报表' },
      { type: 'paragraph', text: '本报表由 LLM 通过 MCP tools/call 生成,用于验证协议链路。' },
      {
        type: 'table',
        headers: ['项目', '结果'],
        aligns: ['left', 'center'],
        rows: [
          ['initialize 握手', '通过'],
          ['tools/list', '通过'],
          ['图表 SSR', '见下图'],
        ],
      },
      {
        type: 'chart',
        width: 560,
        height: 300,
        alt: '验证用雷达图',
        option: {
          title: { text: '链路验证', left: 'center', textStyle: { fontSize: 14 } },
          radar: {
            indicator: [
              { name: '协议', max: 100 },
              { name: '渲染', max: 100 },
              { name: '转换', max: 100 },
              { name: '保真', max: 100 },
              { name: '速度', max: 100 },
            ],
          },
          series: [{ type: 'radar', data: [{ value: [100, 95, 100, 90, 95], name: '评分' }] }],
        },
      },
    ],
  },
})
console.log('✓ tools/call:', call.content[0].text)

proc.kill()
process.exit(0)
