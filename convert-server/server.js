/**
 * Umo Editor 文档转换服务
 * -----------------------------------------------------------
 * 只负责「格式转换」：把编辑器导出的 HTML 转成 .docx 文件。
 * 不接触文档元数据（由 demo/server 管），也不碰 Yjs 协同内容（由 collab-server 管）。
 *
 * 独立成服务的原因：
 *   - 转换依赖 html-to-docx（纯 JS，体积可观），隔离在此服务避免污染轻量的元数据服务；
 *   - 后续若要切换/叠加更高保真的转换引擎（LibreOffice 等），改动只集中在这里。
 *
 * 启动：npm install && npm start
 * 端口：4002（避开 collab-server 的 4000、demo-server 的 4001）
 */
import HTMLToDocX from 'html-to-docx'
import http from 'http'

// ============ 配置 ============
const PORT = process.env.PORT || 4002
// 含 base64 图片的 HTML 可能很大，放宽到 20MB
const MAX_BODY = 20 * 1024 * 1024

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// ============ HTTP 工具 ============
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
  })
  res.end(JSON.stringify(data))
}

// 读 request body（限 MAX_BODY，转换接口的 HTML 可能含 base64 图片，需要放大）
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大（超过 20MB 限制）'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(
          chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {},
        )
      } catch (e) {
        reject(new Error('JSON 解析失败'))
      }
    })
    req.on('error', reject)
  })
}

// 文件名安全处理：去掉路径分隔符与控制字符，防止注入与路径穿越
function sanitizeFilename(name) {
  const cleaned = (name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .trim()
  // RFC 5987：非 ASCII 文件名用 filename*=UTF-8'' 编码，兼容现代浏览器
  const fallback = 'document'
  const finalName = cleaned || fallback
  const encoded = encodeURIComponent(finalName)
  return {
    ascii: finalName.replace(/[^\x20-\x7e]/g, '_'), // ASCII 兜底（老浏览器）
    utf8: encoded,
  }
}

// ============ 转换核心 ============
async function convertHtmlToDocx(html, title) {
  // HTMLToDocX(html, headerHTML, documentOptions, footerHTML)
  // 包一层基本文档结构，确保有标题与默认字体；表格行不跨页拆分
  const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${(
    title || ''
  ).replace(/[<>&]/g, '')}</title></head><body>${html || ''}</body></html>`

  const buffer = await HTMLToDocX(
    wrapped,
    null,
    {
      table: { row: { cantSplit: true } },
    },
    null,
  )
  return buffer
}

// ============ 路由 ============
const server = http.createServer(async (req, res) => {
  // 处理预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const { pathname } = url

  try {
    // POST /api/convert/docx { html, title } —— 转 Word
    if (pathname === '/api/convert/docx' && req.method === 'POST') {
      const body = await readBody(req)
      const html = (body.html || '').toString()
      const title = (body.title || '').toString().trim()
      if (!html) {
        sendJson(res, 400, { error: '缺少 html 字段' })
        return
      }
      const buffer = await convertHtmlToDocx(html, title)
      const { ascii, utf8 } = sanitizeFilename(title)
      res.writeHead(200, {
        'Content-Type': DOCX_MIME,
        'Content-Disposition': `attachment; filename="${ascii}.docx"; filename*=UTF-8''${utf8}.docx`,
        ...CORS_HEADERS,
      })
      console.log(`[convert] docx 生成成功 (${buffer.length} bytes)`)
      res.end(buffer)
      return
    }

    // 健康检查
    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, service: 'umo-convert-server' })
      return
    }

    sendJson(res, 404, { error: '未找到路由' })
  } catch (e) {
    console.error('[error]', e.message)
    sendJson(res, 500, { error: e.message || '转换失败' })
  }
})

server.listen(PORT, () => {
  console.log(`\n✅ 转换服务已启动: http://localhost:${PORT}`)
  console.log(`   接口: POST /api/convert/docx`)
  console.log(`   引擎: html-to-docx (纯 JS)\n`)
})

// 优雅停机
const shutdown = (signal) => {
  console.log(`\n收到 ${signal}，正在关闭...`)
  server.close(() => process.exit(0))
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
