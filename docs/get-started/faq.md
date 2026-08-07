# FAQ

> 常见问题与接入决策树。

---

## 接入决策树

```
你的业务系统技术栈是 Vue3，且愿意维护协同运行时（yjs/@hocuspocus）？
├─ 是 → 考虑「组件库集成」模式（npm 包，见 COLLAB_HANDOFF.md）
└─ 否 → 用本指南的「引擎 iframe 集成」模式
        │
        能配 nginx 反代吗？
        ├─ 能 → 同源直调（强交互，推荐）
        │        → 见 强交互集成（同源）
        └─ 不能 → 跨域 postMessage（通用）
                 → 见 最小可用集成（跨域）
                 │
                 需要后端读文档（列表/检索）？
                 ├─ 需要 → 启用 read-server（二阶段）
                 └─ 不需要 → 仅前端交互即可
```

---

## 常见问题

### Q1: iframe 跨域了，还能和编辑器交互吗？

**能。** 跨域用 postMessage（异步请求/响应），能力覆盖大部分操作：取内容、插入、导出、只读切换、书签。

限制：
- 拿不到 Tiptap 底层实例（函数引用不可跨域克隆）
- 拖拽体验打折（drop 事件不跨 frame）

条件允许建议配 nginx 反代走同源直调。详见 [postMessage 协议 - 跨域硬限制](../api-reference/postmessage-protocol.md#跨域硬限制)。

---

### Q2: 为什么导出不能让后端直接凭地址下载？

前端生成的 docx 是 **Blob**（浏览器内存对象），`URL.createObjectURL(blob)` 生成的是 `blob:http://...` 伪 URL，**只在生成它的浏览器进程内有效**，业务后端（服务器上）访问不到。

必须由 iframe 把文件 **POST 推给** 业务后端（方案 B3）。详见 [导出与文件回传](../api-reference/export.md)。

---

### Q3: token 过期了怎么办？

JWT 默认 24h 过期。建议：
- **主动刷新**：业务前端在 iframe 加载前检查 token 剩余有效期，临近过期（如 < 1h）重新调业务后端换 token
- **被动刷新**：协同连接断开时（`onAuthenticationFailed`），重新走「换 token → 重设 iframe src」流程

详见 [鉴权对接 - token 过期处理](./authentication.md#token-过期处理)。

---

### Q4: 能不能不用 iframe，直接把编辑器组件嵌入我的 Vue 项目？

**可以**，但那是「组件库集成」模式（引 npm 包 + 自己编排 Yjs provider），不是本指南的「私有化引擎」模式。

| 模式 | 集成成本 | 适用 |
| --- | --- | --- |
| 引擎 iframe（本指南） | 低（只需 iframe + 4 步） | 跨技术栈、低耦合 |
| 组件库集成（npm 包） | 高（要装 yjs/@hocuspocus + 版本对齐） | 技术栈一致、愿维护协同运行时 |

组件库集成详见 `COLLAB_HANDOFF.md`。

---

### Q5: 协同的 WebSocket 总是断开？

通常是 nginx 的 `proxy_read_timeout` 默认 60s 断开了空闲长连接。

解决：按 [nginx 同域反代配置](../api-reference/nginx-reverse-proxy.md) 设 `proxy_read_timeout 86400s`。

```nginx
location /editor/ {
    proxy_pass http://editor-host:9999/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 86400s;   # ← 关键
}
```

---

### Q6: 如何做高保真导出？

**必须走前端路径**（用户打开文档时）。编辑器已渲染好 DOM，`getImage()` 截图或 `getVanillaHTML() → docx` 都是所见即所得。

后端无头导出（read-server）只适合批量/离线场景，保真度低（图表、公式、视频会降级）。

详见 [导出与文件回传](../api-reference/export.md)。

---

### Q7: 引擎镜像里为什么没有文档列表/登录页？

因为文档列表、登录、权限管理是**业务系统自己的职责**，引擎只管「编辑这一篇文档时的实时协同」。引擎默认入口是 `/embed`（纯编辑器页）。

完整示例在仓库的 `demo/` 目录，是一个**瘦客户端源码**（不打包镜像）：演示业务系统如何用 iframe 接引擎，含登录/列表/编辑器页 + 四类交互演示。详见 [瘦客户端示例项目](../samples/demo-project.md)。

---

### Q8: 文件上传需要配置对象存储吗？

**不需要。** embed 模式下，图片等附件直接转 **base64 Data URL 写入 Yjs 文档**，随文档实时同步，无需配置 OSS/S3/MinIO。

> 大文件（视频等）建议外链，避免 base64 膨胀 Yjs 文档体积。

---

### Q9: viewer 角色的只读是前端控制还是服务端强制？

**服务端强制。** JWT role claim 为 `viewer` 时，引擎 `onAuthenticate` hook 会把连接设为只读（`connection.readOnly = true`），Hocuspocus 服务端会**拒绝该连接的所有 update**。即使前端绕过 UI 限制，写入也不会生效。

---

### Q10: 多人同时编辑会冲突吗？

**不会。** 基于 Yjs CRDT 算法，多用户同时编辑同一篇文档会自动无冲突合并。网络断开重连后，离线期间的编辑也会自动合并。

---

### Q11: 如何限制只有特定用户才能编辑某篇文档？

在**业务后端**的权限逻辑里决定。业务后端调引擎 `/api/token` 时传 `role` 参数：

```js
// 业务后端
const role = await checkUserPermission(userId, docId)  // 'editor' 或 'viewer'
const r = await fetch(
  `http://editor-host:9999/api/token?name=${userName}&doc=${docId}&role=${role}`,
  { headers: { 'x-api-key': UMO_API_KEY } }
)
```

引擎根据 `role` 在服务端强制只读。详见 [鉴权对接](./authentication.md)。

---

### Q12: 能否同时部署多个引擎实例做负载均衡？

一阶段是单实例（内存 + SQLite）。后续阶段支持：
- **阶段二**：把 `onStoreDocument/onLoadDocument` 换成真实数据库（MySQL/Postgres）
- **阶段三**：加 `@hocuspocus/extension-redis` 做多实例广播

多实例需要共享文档存储 + Redis pub/sub 广播，否则同一篇文档的协作者连到不同实例会看不到彼此。
