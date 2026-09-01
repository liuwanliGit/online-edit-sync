# oes-report-mcp —— LLM 报表文档生成 MCP Server

让 LLM 通过 MCP 工具调用生成报表文档(**文本 + 表格 + echarts 图表**)并导出 Word(.docx)。
图表在**服务端渲染**为高清 PNG 内嵌(不依赖浏览器),与在线编辑器导出走同一保真路径。

**两种部署形态,共享同一套工具实现:**

| 模式 | 启动 | 接入方式 | 适用 |
| --- | --- | --- | --- |
| stdio 本地 | `npm start`(`server.mjs`) | MCP 客户端子进程拉起 | 个人本机使用,结果落本地盘 |
| **HTTP 远程** | `npm run start:http`(`http-server.mjs`) | MCP 客户端连 URL | 团队/服务器部署,Docker 化 |
| Docker | `docker build -t oes-report-mcp .` | 同上 | 生产部署 |

## 架构

```
LLM ──MCP──> server.mjs(stdio) 或 http-server.mjs(Streamable HTTP)
               └─ tools.mjs(共享工具定义)
                    └─ report.mjs
                         ├─ echarts SSR(@napi-rs/canvas) ──> PNG base64
                         ├─ blocks(标题/段落/表格/图表) ──> HTML
                         └─ html-to-docx ──> .docx(默认本地;设 OES_CONVERT_URL 走引擎 convert-server)
```

远程模式额外提供:

- `POST /mcp` —— MCP Streamable HTTP 端点(无状态,可水平扩展)
- `GET /dl/<token>` —— 下载生成的 docx:**临时链接,免鉴权**,默认 5 分钟有效
  (`DOWNLOAD_TTL` 可调),过期返回 410;URL 在生成报表的工具结果里自动附带
- `GET /health` —— 健康检查
- Bearer Token 鉴权(`MCP_API_KEY`)**仅作用于 `/mcp`**;下载不做常驻鉴权,
  安全靠"不可猜测 + 短时效"的随机 token(token 不含路径,也无路径穿越面)

已实测验证:stdio 协议链路、HTTP 协议链路(curl:initialize/tools/list/tools/call)、
Docker 容器内图表渲染与文件下载、`/mcp` 无鉴权 401 拒绝、
临时链接免鉴权下载 200 / 过期与伪造 token 410 失效。

## 安装与运行

```bash
cd mcp-server
npm install
node test-report.mjs          # 直接生成示例报表到 output/
node test-mcp-protocol.mjs    # stdio 协议层自测
npm run start:http            # 启动 HTTP 远程服务(:3100)
```

## MCP 客户端配置

### 本地(stdio)

```json
{
  "mcpServers": {
    "oes-report": {
      "command": "node",
      "args": ["D:/workspace/online-edit-sync/mcp-server/server.mjs"]
    }
  }
}
```

### 远程(HTTP)

ZCode(用户级 `~/.zcode/cli/config.json` 或工作区 `.zcode/config.json` 的 `mcp.servers`):

```json
{
  "mcp": {
    "servers": {
      "oes-report": {
        "type": "http",
        "url": "http://your-server:3100/mcp",
        "headers": { "Authorization": "Bearer <MCP_API_KEY>" }
      }
    }
  }
}
```

Claude Desktop / Cursor 等客户端同理:填 `url` 指向 `/mcp` 端点,鉴权放 `headers`。

经 nginx 反代时(见 `deploy/nginx.conf` 与 `deploy/README.md`):`url` 填
`http://<对外地址>:8080/oes/report/mcp`。下载链接的域名/协议/前缀**按请求头动态推导**
(`X-Forwarded-Host` / `X-Forwarded-Proto` / `X-Forwarded-Prefix`,nginx 配置已转发),
所以内网域名、外网域名、多级反代各自拿到自己可访问的下载链接,容器**无需**再设
`PUBLIC_BASE_URL`;该变量保留为强制固定前缀的覆盖项(仅单域名且无反代头时才需要)。

### Docker 部署

```bash
docker build -t oes-report-mcp .
docker run -d -p 3100:3100 \
  -e MCP_API_KEY=<强随机key> \
  --restart unless-stopped oes-report-mcp
```

下载链接前缀默认按请求头动态推导:反代部署只需让 nginx 转发 `X-Forwarded-*`
(仓库 `deploy/nginx.conf` 已配好),内外网多域名共用同一容器各自生成正确链接;
直连部署用客户端实际连接的 Host。需要强制固定前缀时再设 `PUBLIC_BASE_URL`。

输出目录**无需挂载卷**:产物通过临时下载 URL 取回,容器内落盘即可;
仅在需要把生成文件持久留在宿主机时才挂 `-v <host-dir>:/app/output`(可选)。

镜像基底走仓库同源的阿里云镜像仓库(本网络 docker.io 不可达,有代理可换回 `node:22-bookworm-slim`)。

## 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` | HTTP 服务端口 | 3100 |
| `MCP_API_KEY` | Bearer Token 鉴权,**仅保护 `/mcp`**;公网部署务必设置 | 空=开放(仅限内网) |
| `DOWNLOAD_TTL` | 临时下载链接有效期(秒) | 300 |
| `OUTPUT_DIR` | 文档输出目录 | ./output |
| `PUBLIC_BASE_URL` | 强制固定下载地址前缀(可选覆盖);默认按请求头动态推导:`X-Forwarded-Host`(回退 `Host`)+ `X-Forwarded-Proto` + `X-Forwarded-Prefix`(回退从 `X-Forwarded-Uri` 推导),多域名反代/直连均自动正确 | 空=动态推导 |
| `OES_CONVERT_URL` | 设为引擎 convert-server 地址时,转换走引擎而非本地 | 空=本地转换 |
| `CJK_FONT_PATH` | 图表 CJK 字体文件(Linux 容器默认字体无中文,需指定) | /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc |
| `MAX_IMG_WIDTH` | docx 内图片显示宽度上限(px) | 600 |

## 图表中文字体(容器部署必读)

slim 基底镜像的默认字体只有 Latin(DejaVu),echarts 画中文会变成豆腐块、
标签布局还会整体失效——Dockerfile 已 `apt-get install fonts-noto-cjk`,
服务启动时自动 `registerFromPath` 注册并设为图表默认字体(调用方 option 里
显式写的 `fontFamily` 仍然优先)。换字体改 `CJK_FONT_PATH` 即可(需含 CJK 字形)。

## 工具说明

### create_report_docx

| 参数 | 说明 |
| --- | --- |
| `title` | 报表标题,同时用作文件名 |
| `blocks` | 内容块数组,按顺序渲染 |
| `outputDir` | 输出目录(服务器本机),默认 `./output` |

block 类型:

```jsonc
{ "type": "heading",  "level": 1, "text": "标题" }
{ "type": "paragraph", "text": "纯文本自动转义", "indent": true }   // indent 默认 true:首行缩进两字符;
                                                                   // 设 false 齐头;html 变体不做缩进
{ "type": "bullets",  "items": ["要点1", "要点2"] }
{ "type": "numbered", "items": ["结论1", "结论2"] }
{ "type": "table",    "headers": ["列A", "列B"], "rows": [["1", "2"]],
                      "aligns": ["left", "right"], "bordered": true }
// bordered 默认 true:单元格四边框线(中文报表习惯);设 false 得到无线表格
{ "type": "chart",    "option": { "xAxis": {...}, "series": [...] },   // 标准 echarts option
                      "width": 600, "height": 360, "alt": "趋势图" }
// width/height 为渲染分辨率;docx 内显示宽度上限 600px(A4 版心),超出自动等比缩小
{ "type": "image",    "path": "/abs/path/logo.png", "width": 400, "alt": "logo" }
```

返回:`{ path, 下载URL(远程模式,临时链接限时有效), bytes, charts, tables }`(二进制不回传,给路径/URL)。

### render_chart_png

单独渲染一张 echarts 图表为 PNG 文件,参数:`option` / `outPath` / `width` / `height`。

## 远程化的取舍(相对本地 stdio)

- **产物获取**:文件在服务器上,远程调用方走工具结果里的临时 URL 下载(`/dl/<token>`,
  免鉴权、5 分钟有效;stdio 模式直接给本地路径)。
- **鉴权责任**:stdio 天然私有(进程边界);HTTP 侧 `MCP_API_KEY` 只需保护 `/mcp`,
  下载安全交给短时效随机 token,生产建议再加 TLS 反代(nginx + https)。
- **无状态设计**:每个 POST 独立实例,不留会话,可多实例负载均衡;代价是不支持
  SSE 长连接推送(GET /mcp 返回 405,对报表生成场景无影响)。
  注意:临时链接的 token 映射在进程内存,多实例部署需粘性路由或共享存储(单实例无影响)。
- **输出目录治理**:多人共用时文件名可能冲突(按 title 命名),生产可按用户/请求加子目录。

## 给 LLM 的使用建议(prompt 工程层面)

- **图表与数据表格成对出现**:表格承载明细(保真度最高),图表承载趋势可视化,互为兜底。
- chart.option 直接给标准 echarts option JSON,`tooltip`/`legend` 照常支持(渲染为静态图后交互失效,属预期)。
- 每张图配 `alt`,会写入 docx 图片描述。

## 已知限制(继承自 html-to-docx)

- 删除线 `<s>` 会转成下划线(库 bug);`<em>` 斜体在个别混排场景丢失,建议用 `<i>`/`<b>`。
- 中文正文字体未设置 `eastAsia` 属性,Word 中可能回落默认字体;图表不受影响(已栅格化为 PNG)。
- 图片会重复存一份在 media(未引用,仅占体积)。
- 图表是静态 PNG:编辑器里不可交互、不可二次编辑数据;需要活图表要走在线文档的 echarts 节点(该导出问题已在引擎侧修复,见主仓库 `src/components/index.vue` 的 getVanillaHTML)。

## 后续演进方向

1. 接入引擎 collab-server:把 blocks 写进 Yjs 文档(复用评论模块的 openDirectConnection 模式),让 LLM 生成的报表直接成为**在线可协同文档**,浏览器里可继续编辑,再按需导出 Word。
2. 增量追加工具(append_blocks),支持长文档分段生成,避免单次上下文过长。
3. 幂等:按 title 查重返回已有文档,防 LLM 重试产生重复文件。
