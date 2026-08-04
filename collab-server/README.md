# Umo Editor 协同服务（阶段一）

基于 **Hocuspocus + Yjs** 的最小协同服务，用于验证 Umo Editor 协同编辑链路。

## 快速启动

```bash
cd collab-server
npm install
npm start
```

启动后看到如下输出即成功：

```
✅ 协同服务已启动: ws://localhost:4000
   鉴权 token: demo-token
   持久化方式: 内存 Map（重启丢失）
```

## 验证

1. 按 [`client-example/README.md`](./client-example/README.md) 接入前端
2. 开两个浏览器窗口连同一个 `name`（如 `demo-doc-001`）
3. 一边编辑，另一边应实时同步

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `4000` | 服务端口 |
| `AUTH_TOKEN` | `demo-token` | 客户端连接所需的 token |

## 当前阶段的能力与限制

| 能力 | 状态 |
|---|---|
| 多人实时协同编辑 | ✅ |
| 防抖持久化（内存） | ✅ |
| 简单 token 鉴权 | ✅ |
| 优雅停机 | ✅ |
| 数据库持久化 | ❌（阶段二） |
| JWT/SSO 真实鉴权 | ❌（阶段二） |
| 多实例横向扩展 | ❌（阶段三） |
| 监控/告警 | ❌（阶段三） |

## 演进路线

- **阶段二**：把 `Database` 扩展里的 `fetchData` / `store` 改为真实数据库，`onAuthenticate` 接业务 JWT
- **阶段三**：加 `@hocuspocus/extension-redis` 做多实例广播，接 Prometheus 监控
