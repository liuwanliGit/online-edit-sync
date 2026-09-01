/**
 * MCP 工具注册(stdio 与 HTTP 两种传输共用)
 * -----------------------------------------------------------
 * makeDownloadUrl:
 *   - stdio 本地模式不传,工具结果只返回本地文件路径
 *   - HTTP 远程模式传入(result) => { url, ttlSeconds },
 *     工具结果附带临时下载 URL(免鉴权,短时效,过期即失效)
 */
import { z } from 'zod'
import { writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'

import { createReportDocx, renderChartPng } from './report.mjs'

const formatTtl = (seconds) =>
  seconds % 60 === 0 ? `${seconds / 60}分钟` : `${seconds}秒`

export function registerTools(server, { makeDownloadUrl = null } = {}) {
  const fileRef = (result) => {
    if (!makeDownloadUrl) return result.path
    const { url, ttlSeconds } = makeDownloadUrl(result)
    return `${result.path}\n下载地址(${formatTtl(ttlSeconds)}内有效): ${url}`
  }

  // chart block 的 echarts option 是任意 JSON 对象,用 z.any() 放行,由 report.mjs 校验
  const ChartBlock = z.object({
    type: z.literal('chart'),
    option: z
      .any()
      .describe('echarts option 对象,如 {xAxis:{type:"category",data:[...]},yAxis:{type:"value"},series:[{type:"bar",data:[...]}]}'),
    width: z.number().min(200).max(1200).optional().describe('图表渲染宽度 px,默认 600;docx 内显示宽度上限 600px,超出等比缩放'),
    height: z.number().min(150).max(900).optional().describe('图表高度 px,默认 360'),
    alt: z.string().optional().describe('图片替代文本(进 docx 的 descr)'),
  })

  const Block = z.union([
    z.object({ type: z.literal('heading'), level: z.number().min(1).max(6), text: z.string() }),
    z.object({
      type: z.literal('paragraph'),
      text: z.string().optional().describe('纯文本,自动转义'),
      html: z.string().optional().describe('受信内联 HTML(<b>/<i>/<a> 等),与 text 二选一'),
      indent: z.boolean().optional().describe('首行缩进两字符(中文公文习惯),默认 true;设 false 关闭'),
    }),
    z.object({ type: z.literal('bullets'), items: z.array(z.string()) }),
    z.object({ type: z.literal('numbered'), items: z.array(z.string()) }),
    z.object({
      type: z.literal('table'),
      headers: z.array(z.string()),
      rows: z.array(z.array(z.string())),
      aligns: z.array(z.enum(['left', 'center', 'right'])).optional().describe('每列对齐,默认 left'),
      bordered: z.boolean().optional().describe('单元格四边框线,默认 true;设 false 得到无线表格'),
    }),
    ChartBlock,
    z.object({
      type: z.literal('image'),
      path: z.string().describe('服务器本机图片绝对路径(png/jpg/gif/bmp/svg)'),
      width: z.number().optional(),
      alt: z.string().optional(),
    }),
  ])

  server.registerTool(
    'create_report_docx',
    {
      title: '生成报表 Word 文档',
      description:
        '根据结构化内容块生成报表文档并导出 .docx。支持标题/段落/列表/表格/echarts 图表/图片;' +
        '图表在服务端渲染为高清 PNG 内嵌,Word 中完整保留。建议图表与数据表格成对出现,互为兜底。',
      inputSchema: {
        title: z.string().describe('报表标题,同时用作 docx 文件名'),
        blocks: z.array(Block).describe('内容块序列,按顺序渲染'),
        outputDir: z.string().optional().describe('输出目录(服务器本机),默认 ./output'),
      },
    },
    async ({ title, blocks, outputDir }) => {
      const result = await createReportDocx({ title, blocks, outputDir })
      return {
        content: [
          {
            type: 'text',
            text:
              `已生成: ${fileRef(result)}\n` +
              `大小: ${result.bytes} bytes | 图表: ${result.charts} 张 | 表格: ${result.tables} 个`,
          },
        ],
      }
    },
  )

  server.registerTool(
    'render_chart_png',
    {
      title: '渲染 echarts 图表为 PNG',
      description: '将 echarts option 渲染为静态 PNG 图片文件(服务端渲染,无需浏览器)。',
      inputSchema: {
        option: z.any().describe('echarts option 对象'),
        outPath: z.string().describe('输出 PNG 路径(服务器本机)'),
        width: z.number().min(200).max(1200).optional(),
        height: z.number().min(150).max(900).optional(),
      },
    },
    async ({ option, outPath, width, height }) => {
      const dataUrl = renderChartPng(option, { width, height })
      const abs = resolve(outPath)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, Buffer.from(dataUrl.split(',')[1], 'base64'))
      return { content: [{ type: 'text', text: `已生成: ${abs}` }] }
    },
  )
}
