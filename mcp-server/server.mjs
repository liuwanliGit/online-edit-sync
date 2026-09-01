#!/usr/bin/env node
/**
 * oes-report-mcp —— LLM 报表文档生成 MCP Server(stdio 本地模式)
 * -----------------------------------------------------------
 * 本地模式:MCP 客户端(ZCode/Claude Desktop 等)把本进程作为子进程拉起,
 *           生成结果落在本机 output 目录,返回本地路径。
 * 远程模式:用 http-server.mjs(Streamable HTTP,支持远程调用与文件下载)。
 *
 * 图表走服务端渲染(echarts + @napi-rs/canvas),不依赖浏览器;
 * 导出走 html-to-docx(与 oes convert-server 同引擎同参数)。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { registerTools } from './tools.mjs'

const server = new McpServer({ name: 'oes-report-mcp', version: '0.1.0' })
registerTools(server) // 本地模式:不注入下载 URL,结果只返回本地路径

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[oes-report-mcp] stdio server started') // stderr,不污染 stdout 协议流
