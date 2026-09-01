/**
 * 报表生成核心:blocks(文本/表格/图表) → HTML → docx
 * -----------------------------------------------------------
 * 供 MCP server(server.mjs)和直接测试脚本(test-report.mjs)共用。
 *
 * 图表链路:echarts option JSON --echarts SSR(@napi-rs/canvas)--> PNG base64
 *          --> <img> 内嵌 --> html-to-docx --> Word 里的静态图片。
 * 与编辑器导出(getVanillaHTML 的 getDataURL 快照)是同一保真路径,
 * 已实测:PNG 图片在 docx 中完整存活(尺寸/alt 均正确)。
 *
 * 转换引擎两种模式:
 *   - 默认:本地 html-to-docx(与 convert-server 同版本同参数,零部署依赖)
 *   - 设 OES_CONVERT_URL=http://host:4002 时:POST 到引擎 convert-server,
 *     与在线文档导出走同一条服务端链路
 */
import * as echarts from 'echarts'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import HTMLToDocX from 'html-to-docx'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, extname, join, resolve } from 'path'

// zrender 测文字时会无参调用 createCanvas(),@napi-rs/canvas 要求必传尺寸
echarts.setPlatformAPI({
  createCanvas: (w, h) => createCanvas(w ?? 300, h ?? 150),
})

// CJK 字体:Linux slim 容器默认字体只有 Latin(DejaVu),中文会画成豆腐块;
// 注册 Noto Sans CJK 并设为图表默认字体(Windows/本地有系统字体则跳过,保持 sans-serif)
const CJK_FONT_PATH =
  process.env.CJK_FONT_PATH || '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
const CHART_FONT_FAMILY = (() => {
  try {
    if (existsSync(CJK_FONT_PATH)) {
      GlobalFonts.registerFromPath(CJK_FONT_PATH, 'oes-cjk')
      return 'oes-cjk'
    }
  } catch {
    /* 注册失败回落系统默认字体 */
  }
  return 'sans-serif'
})()

// ============ HTML 工具 ============
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 文件名安全化(去路径分隔符与非法字符)
function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .trim()
  return cleaned || 'report'
}

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

// docx 内图片显示宽度上限:超出 A4 版心(约 600px@96dpi)会被 Word 裁掉,
// 超限时等比缩到该宽度显示(仅影响 docx 展示尺寸,渲染分辨率不变)
const MAX_IMG_WIDTH = Number(process.env.MAX_IMG_WIDTH) || 600

function displaySize(w, h) {
  if (!w || w <= MAX_IMG_WIDTH) return { w, h }
  return { w: MAX_IMG_WIDTH, h: Math.round((h * MAX_IMG_WIDTH) / w) }
}

// PNG IHDR 头读原始尺寸(用于无 width 参数时钳制显示宽度)
function pngSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(12) === 0x49484452) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }
  return null
}

// ============ echarts SSR 渲染 ============
export function renderChartPng(option, { width = 600, height = 360, pixelRatio = 2 } = {}) {
  if (!option || typeof option !== 'object' || Array.isArray(option)) {
    throw new Error('chart.option 必须是 echarts option 对象(非数组)')
  }
  const canvas = createCanvas(width, height)
  const chart = echarts.init(canvas)
  try {
    // 先落全局默认字体,再合并调用方 option(调用方显式指定的 fontFamily 优先生效)
    chart.setOption({ textStyle: { fontFamily: CHART_FONT_FAMILY } })
    chart.setOption(option)
    return chart.getDataURL({
      type: 'png',
      pixelRatio,
      backgroundColor: option.backgroundColor || '#ffffff',
    })
  } finally {
    chart.dispose()
  }
}

// ============ blocks → HTML ============
// block 类型:
//   { type:'heading',  level:1-6, text }
//   { type:'paragraph', text, indent?:boolean }    // 纯文本,自动转义;默认首行缩进两字符
//   { type:'paragraph', html }                      // 受信内联 HTML(加粗/链接等),不做缩进
//   { type:'bullets',  items:[string] }
//   { type:'numbered', items:[string] }
//   { type:'table',    headers:[string], rows:[[string]], aligns?:['left'|'center'|'right'],
//                      bordered?:boolean }          // bordered 默认 true(单元格四边框线)
//   { type:'chart',    option:<echarts option>, width?, height?, alt? }
//                     // width/height 为渲染分辨率;docx 内显示宽度上限 600px,超出等比缩
//   { type:'image',    path:<本地图片路径>, width?, alt? }
function blockToHtml(block, index) {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(block.level) || 1))
      return `<h${level}>${escapeHtml(block.text)}</h${level}>`
    }
    case 'paragraph': {
      // html-to-docx 不支持 text-indent,首行缩进用两个全角空格实现(中文公文习惯)
      const indent = block.indent !== false ? '\u3000\u3000' : ''
      if (block.html !== undefined) return `<p>${block.html}</p>`
      return `<p>${indent}${escapeHtml(block.text)}</p>`
    }
    case 'bullets':
      return `<ul>${(block.items || [])
        .map((i) => `<li>${escapeHtml(i)}</li>`)
        .join('')}</ul>`
    case 'numbered':
      return `<ol>${(block.items || [])
        .map((i) => `<li>${escapeHtml(i)}</li>`)
        .join('')}</ol>`
    case 'table': {
      // html-to-docx 只认单元格上的四边 border 内联样式(表级 border 属性不生效)
      const { headers = [], rows = [], aligns = [] } = block
      const border = block.bordered !== false
        ? 'border-top:1px solid #8c8c8c;border-right:1px solid #8c8c8c;border-bottom:1px solid #8c8c8c;border-left:1px solid #8c8c8c;'
        : ''
      const th = headers
        .map(
          (h) =>
            `<th style="background-color:#4472c4;color:#ffffff;font-weight:bold;text-align:center;${border}">${escapeHtml(h)}</th>`,
        )
        .join('')
      const trs = rows
        .map(
          (r) =>
            `<tr>${r
              .map(
                (c, i) =>
                  `<td style="${border}text-align:${aligns[i] || 'left'};">${escapeHtml(c)}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('')
      return `<table border="1" style="border-collapse:collapse;width:100%;"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`
    }
    case 'chart': {
      const width = Math.min(1200, Math.max(200, Number(block.width) || 600))
      const height = Math.min(900, Math.max(150, Number(block.height) || 360))
      const dataUrl = renderChartPng(block.option, { width, height })
      const d = displaySize(width, height)
      return `<p style="text-align:center;"><img src="${dataUrl}" alt="${escapeHtml(block.alt || `图表${index + 1}`)}" style="width:${d.w}px;height:${d.h}px;" /></p>`
    }
    case 'image': {
      const abs = resolve(block.path)
      const mime = MIME_BY_EXT[extname(abs).toLowerCase()]
      if (!mime) throw new Error(`不支持的图片类型: ${abs}`)
      const buf = readFileSync(abs)
      let css = ''
      if (block.width) {
        const d = displaySize(Number(block.width), 1)
        css = ` style="width:${d.w}px;"`
      } else if (mime === 'image/png') {
        const nat = pngSize(buf) // 未指定宽度时按原始尺寸,超版心则钳到安全宽
        if (nat && nat.w > MAX_IMG_WIDTH) css = ` style="width:${MAX_IMG_WIDTH}px;"`
      }
      return `<p style="text-align:center;"><img src="data:${mime};base64,${buf.toString('base64')}" alt="${escapeHtml(block.alt || '')}"${css} /></p>`
    }
    default:
      throw new Error(`未知的 block.type: ${block.type}(block #${index})`)
  }
}

export function blocksToHtml(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error('blocks 必须是非空数组')
  }
  return blocks.map(blockToHtml).join('\n')
}

// ============ HTML → docx ============
async function htmlToDocxBuffer(html, title) {
  const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${html}</body></html>`
  // 与 convert-server/server.js 的 convertHtmlToDocx 保持同参数(表格行不跨页拆分)
  return HTMLToDocX(wrapped, null, { table: { row: { cantSplit: true } } }, null)
}

async function convertViaOes(html, title) {
  const res = await fetch(`${process.env.OES_CONVERT_URL}/api/convert/docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, title }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`convert-server 转换失败: ${err.error || res.status}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

// ============ 主入口 ============
export async function createReportDocx({ title, blocks, outputDir = 'output' }) {
  const html = blocksToHtml(blocks)
  const chartCount = blocks.filter((b) => b.type === 'chart').length
  const tableCount = blocks.filter((b) => b.type === 'table').length

  const buffer = process.env.OES_CONVERT_URL
    ? await convertViaOes(html, title)
    : await htmlToDocxBuffer(html, title)

  const outDir = resolve(outputDir)
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${sanitizeFilename(title)}.docx`)
  writeFileSync(outPath, buffer)

  return {
    path: outPath,
    bytes: buffer.length,
    charts: chartCount,
    tables: tableCount,
    htmlLength: html.length,
  }
}
