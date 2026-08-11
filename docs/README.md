# Umo Editor Engine 使用文档

> Umo Editor Engine 是一个可私有化部署的**实时协同富文本编辑引擎**，以 Docker 镜像形式交付。
> 业务系统通过 **iframe** 嵌入编辑器，通过 **同源直调** 或 **跨域 postMessage** 两种方式与编辑器交互。
>
> 对标产品形态：OnlyOffice Document Server（自部署版）。

---

## 文档目录

### Get Started（入门）

| 文档 | 说明 |
| --- | --- |
| [概述](./get-started/overview.md) | 什么是 Umo Editor Engine，它的架构与核心能力（含内置评论） |
| [部署引擎镜像](./get-started/installation.md) | 用 Docker 启动引擎，环境变量与数据持久化 |
| [鉴权对接](./get-started/authentication.md) | 企业后端代理签发 JWT，角色与权限控制 |
| [前端 iframe 嵌入](./get-started/embedding.md) | 构造 iframe URL，URL 参数、业务配置下发（config 协议）、token 过期处理 |
| [支持的功能](./get-started/features.md) | 协同编辑、评论、导出、文件上传、书签等能力总览 |
| [FAQ](./get-started/faq.md) | 常见问题与接入决策树 |

### API Reference（API 参考）

| 文档 | 说明 |
| --- | --- |
| [iframe URL 参数](./api-reference/url-params.md) | `/oes/embed` 页面的全部 URL 参数契约 |
| [同源直调 API](./api-reference/same-origin-api.md) | `window.__UMO_EDITOR__` 暴露的全部方法（最强交互） |
| [postMessage 协议](./api-reference/postmessage-protocol.md) | 跨域请求/响应消息协议、config 下发与主动推送消息 |
| [服务端接口](./api-reference/server-api.md) | `/oes/api/token`、`/oes/api/convert`、`/oes/collab`、评论 API、健康检查 |
| [导出与文件回传](./api-reference/export.md) | 工具栏导出（直接下载）与方案 B3（docx 推送到业务后端） |
| [nginx 同域反代配置](./api-reference/nginx-reverse-proxy.md) | 单域名子路径部署的分流模板（引擎 /oes/embed* + demo /oes/*） |

### Samples（示例）

| 文档 | 说明 |
| --- | --- |
| [最小可用集成（跨域）](./samples/minimal-cross-domain.md) | 不配反代，纯 postMessage 完成嵌入 + 导出 |
| [强交互集成（同源）](./samples/full-same-origin.md) | nginx 反代 + 同源直调完整示例 |
| [瘦客户端示例项目](./samples/demo-project.md) | 仓库 `demo/` 目录的完整可运行示例说明（含 Docker 容器方式） |

### 附录

| 文档 | 说明 |
| --- | --- |
| [评论功能设计文档](./comment-builtin-design.md) | 评论功能内置化设计的详细方案与实施记录 |
| [Docker 部署说明](../docker/README.md) | 引擎镜像构建、全栈编排、外层 nginx 反代的完整部署指南 |

---

## 快速导航

**我是首次接入：** 从 [概述](./get-started/overview.md) 开始，依次阅读 → [部署](./get-started/installation.md) → [鉴权](./get-started/authentication.md) → [嵌入](./get-started/embedding.md)。

**我要查 API：** 直接看 [同源直调 API](./api-reference/same-origin-api.md) 或 [postMessage 协议](./api-reference/postmessage-protocol.md)。

**我要跑示例：** 看 [瘦客户端示例项目](./samples/demo-project.md)。仓库 `demo/` 目录可直接运行，或用 `docker compose -f docker/docker-compose.yml up -d --build` 一键启动引擎 + demo 双容器。
