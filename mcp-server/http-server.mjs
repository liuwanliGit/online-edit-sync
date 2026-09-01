#!/usr/bin/env node
/**
 * oes-report-mcp —— HTTP 远程模式(Streamable HTTP)
 * -----------------------------------------------------------
 * 以独立 HTTP 服务运行,远程 MCP 客户端通过 URL 接入:
 *
 *   端点:
 *     POST /mcp          MCP Streamable HTTP(无状态,JSON 响应)
 *     GET  /dl/:token    下载生成的 docx(临时链接,免鉴权,默认 5 分钟有效)
 *     GET  /health       健康检查
 *
 *   环境变量:
 *     PORT               监听端口,默认 3100
 *     MCP_API_KEY        Bearer Token 鉴权,仅作用于 /mcp(公网部署务必设置)
 *     DOWNLOAD_TTL       临时下载链接有效期(秒),默认 300
 *     OUTPUT_DIR         文档输出目录,默认 ./output
 *     PUBLIC_BASE_URL    强制固定下载地址前缀(可选;默认按请求头动态推导,
 *                        见 resolveBaseUrl——多域名反代场景无需设置)
 *     OES_CONVERT_URL    设为引擎 convert-server 地址时,转换走引擎而非本地
 *
 * 下载安全模型:下载不设常驻鉴权,靠"生成时签发不可猜测的短时效 token"控制,
 * URL 过期即 410 失效;token 不含路径信息,天然无路径穿越面。
 *
 * 无状态模式:每个 POST 独立创建 transport + server 实例,不留会话状态,
 * 可多实例水平扩展(GET/DELETE 按规范返回 405);
 * 注意:token 映射在进程内存,多实例部署需粘性路由或共享存储。
 */
import http from 'http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createReadStream, existsSync, statSync } from 'fs'
import { randomBytes } from 'crypto'
import { resolve } from 'path'

import { registerTools } from './tools.mjs'

const PORT = Number(process.env.PORT) || 3100
const MCP_API_KEY = process.env.MCP_API_KEY || ''
const OUTPUT_DIR = resolve(process.env.OUTPUT_DIR || 'output')
// 可选覆盖:设置后所有下载 URL 固定用该前缀;不设则按每个请求的头动态推导,
// 同一实例可同时服务内外网多个域名/多级反代,互不干扰
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')
const DOWNLOAD_TTL = Number(process.env.DOWNLOAD_TTL) || 300 // 临时下载链接有效期(秒)

// ============ 鉴权(仅保护 /mcp;下载走临时链接,免鉴权) ============
function authorized(req) {
  if (!MCP_API_KEY) return true // 未配置时开放(仅限内网/dev)
  const header = req.headers['authorization'] || ''
  return header === `Bearer ${MCP_API_KEY}`
}

// ============ 临时下载链接(token 映射在内存,过期即失效) ============
const downloadTokens = new Map() // token -> { file, name, expiresAt }

// 反代会追加同名头(如 X-Forwarded-Proto: https, http),取第一段即最初来源
function firstHeader(req, name) {
  const value = req.headers[name]
  return typeof value === 'string' ? value.split(',')[0].trim() : ''
}

// 下载地址前缀按请求头动态推导:URL 在工具调用时生成,而那次 /mcp 请求本身就
// 带着客户端实际使用的域名与协议,所以内网域名、外网域名、直连 IP 各自拿到
// 自己的下载链接,天然多域名兼容(nginx 需转发 X-Forwarded-* 头,见 deploy/nginx.conf)
function resolveBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL

  const proto =
    ['x-forwarded-proto', 'x-forwarded-scheme']
      .map((h) => firstHeader(req, h).toLowerCase())
      .find((p) => p === 'http' || p === 'https') ||
    (req.socket?.encrypted ? 'https' : 'http')

  const host = firstHeader(req, 'x-forwarded-host') || firstHeader(req, 'host')
  // 校验 host 字符集(hostname[:port] 或 [IPv6][:port]),不让畸形头进 URL 文本
  if (!/^(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:]+\])(?::\d{1,5})?$/.test(host)) {
    return `http://localhost:${PORT}`
  }

  // 反代剥离的路径前缀(如 /oes/report):显式头优先,没有则从
  // X-Forwarded-Uri(反代收到的完整原始路径)减去本服务路径推出来
  const sanitizePrefix = (raw) => {
    let p = raw.trim()
    if (!p) return ''
    if (!p.startsWith('/')) p = `/${p}`
    p = p.replace(/\/+$/, '')
    return /^\/[A-Za-z0-9._~/-]*$/.test(p) && !p.includes('..') ? p : ''
  }
  let prefix = sanitizePrefix(firstHeader(req, 'x-forwarded-prefix'))
  if (!prefix) {
    const forwardedUri = firstHeader(req, 'x-forwarded-uri').split('?')[0]
    const localPath = (req.url || '').split('?')[0]
    if (forwardedUri.endsWith(localPath) && forwardedUri !== localPath) {
      prefix = sanitizePrefix(forwardedUri.slice(0, -localPath.length))
    }
  }

  return `${proto}://${host}${prefix}`
}

function issueDownloadUrl(result, req) {
  // base64url 随机 token:不可猜测、不含路径信息;TTL 内可重复下载,过期作废
  const token = randomBytes(24).toString('base64url')
  const name = result.path.split(/[\\/]/).pop()
  downloadTokens.set(token, {
    file: result.path,
    name,
    expiresAt: Date.now() + DOWNLOAD_TTL * 1000,
  })
  return { url: `${resolveBaseUrl(req)}/dl/${token}`, ttlSeconds: DOWNLOAD_TTL }
}

function purgeExpiredTokens() {
  const now = Date.now()
  for (const [token, entry] of downloadTokens) {
    if (entry.expiresAt <= now) downloadTokens.delete(token)
  }
}
setInterval(purgeExpiredTokens, 60_000).unref?.()

// ============ 请求体读取 ============
function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch (e) {
        reject(new Error('JSON 解析失败'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders })
  res.end(JSON.stringify(data))
}

// ============ MCP 端点(无状态 Streamable HTTP) ============
async function handleMcp(req, res) {
  // Streamable HTTP 要求客户端声明可接受 JSON 与 SSE
  const accept = req.headers['accept'] || ''
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
    sendJson(res, 406, {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Accept 头必须同时包含 application/json 与 text/event-stream' },
    })
    return
  }
  try {
    const body = await readBody(req)
    // 无状态:每个请求一套全新的 transport + server,响应完即销毁
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const server = new McpServer({ name: 'oes-report-mcp', version: '0.1.0' })
    // 下载 URL 前缀取自本次请求的头:哪个域名进来,链接就生成哪个域名
    registerTools(server, {
      makeDownloadUrl: (result) => issueDownloadUrl(result, req),
    })
    res.on('close', () => {
      transport.close()
      server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (e) {
    sendJson(res, 400, {
      jsonrpc: '2.0',
      error: { code: -32700, message: e?.message || '请求处理失败' },
    })
  }
}

// ============ 文件下载端点(临时链接,免鉴权) ============
function handleDownload(req, res, token) {
  purgeExpiredTokens()
  const entry = downloadTokens.get(token)
  if (!entry) {
    sendJson(res, 410, { error: `下载链接已失效(有效期 ${DOWNLOAD_TTL} 秒),请重新生成报表获取新链接` })
    return
  }
  if (!existsSync(entry.file)) {
    sendJson(res, 404, { error: '文件不存在(可能已被清理)' })
    return
  }
  const stat = statSync(entry.file)
  res.writeHead(200, {
    'Content-Type':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(entry.name)}`,
  })
  createReadStream(entry.file).pipe(res)
}

// ============ HTTP 服务 ============
const httpServer = http.createServer(async (req, res) => {
  try {
    // 畸形 Host 头会让 URL 解析抛错,必须兜住:否则未捕获 rejection 直接杀进程
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const { pathname } = url

    if (pathname === '/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, service: 'oes-report-mcp', mode: 'http' })
      return
    }

    // 临时下载:凭不可猜测的短时效 token 取文件,免鉴权(token 不暴露路径)
    const dlMatch = pathname.match(/^\/dl\/([A-Za-z0-9_-]{20,})$/)
    if (dlMatch && req.method === 'GET') {
      handleDownload(req, res, dlMatch[1])
      return
    }

    if (!authorized(req)) {
      sendJson(res, 401, { error: '未授权(需要 Authorization: Bearer <MCP_API_KEY>)' })
      return
    }

    if (pathname === '/mcp') {
      if (req.method === 'POST') {
        await handleMcp(req, res)
        return
      }
      // 无状态模式不支持 GET(SSE 长连接)与 DELETE(会话终止),按规范 405
      res.writeHead(405, { Allow: 'POST' }).end()
      return
    }

    sendJson(res, 404, { error: '未找到路由' })
  } catch (e) {
    sendJson(res, 400, { error: e?.message || '无效请求' })
  }
})

httpServer.listen(PORT, () => {
  console.log(`\n✅ oes-report-mcp HTTP 服务已启动: http://localhost:${PORT}`)
  if (PUBLIC_BASE_URL) {
    console.log(`   下载前缀:  ${PUBLIC_BASE_URL}(PUBLIC_BASE_URL 固定覆盖)`)
  } else {
    console.log(`   下载前缀:  按请求头动态推导(X-Forwarded-Host/Proto/Prefix),多域名反代各自生成对应链接`)
  }
  console.log(`   文件下载:  GET  /dl/<token>(临时链接,免鉴权,${DOWNLOAD_TTL} 秒有效)`)
  console.log(`   鉴权:      ${MCP_API_KEY ? '已启用(仅 /mcp,Bearer Token)' : '未设置 MCP_API_KEY,/mcp 开放访问(仅限内网)'}\n`)
})

const shutdown = (signal) => {
  console.log(`\n收到 ${signal},正在关闭...`)
  httpServer.close(() => process.exit(0))
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
