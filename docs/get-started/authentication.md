# 鉴权对接

> 本页说明业务系统如何与引擎对接鉴权：业务后端持有 API Key，代为签发 JWT；前端只拿到短时 JWT，放进 iframe URL。

---

## 鉴权模型

引擎采用 **JWT + API Key 双层鉴权**：

```
┌──────────┐   ① GET /oes/api/token  ┌──────────┐
│ 业务后端  │ ──── (x-api-key) ────→ │   引擎    │
│          │ ←──── JWT ────────────  │          │
└────┬─────┘                        └──────────┘
     │ ② JWT 返回给前端
     ▼
┌──────────┐   ③ iframe /oes/embed?token=<JWT>
│ 业务前端  │ ─────────────────────→ ┌──────────┐
│          │                        │   引擎    │
└──────────┘   ④ WS /oes/collab     │          │
                                 ←→  │          │
                                      └──────────┘
```

| 层级 | 凭据 | 持有者 | 用途 |
| --- | --- | --- | --- |
| **API Key** | `UMO_API_KEY`（环境变量） | 业务后端 | 调 `/oes/api/token` 签发 JWT。**绝不暴露给前端** |
| **JWT** | 短时令牌（默认 24h） | 业务前端 → iframe URL | 协同连接鉴权。包含用户名、文档 id、角色 |

> **dev 无鉴权模式**：引擎未配置 `UMO_API_KEY`（留空）时，`/oes/api/token` 不校验 `x-api-key`（启动日志会打印警告）。这仅用于本地开发/联调；生产环境务必设置 `UMO_API_KEY`。

---

## 为什么需要业务后端代理

引擎的 `/oes/api/token` 需要 `UMO_API_KEY`。如果前端直接持有 API Key，任何人都能签发任意 JWT 访问任意文档。

所以鉴权链路必须是：

1. **业务前端**调业务后端（走业务系统原有的登录态鉴权）
2. **业务后端**校验用户权限，决定角色（editor/commenter/viewer）
3. **业务后端**持 `UMO_API_KEY` 调引擎 `/oes/api/token` 签发 JWT
4. **业务后端**把 JWT 返回给前端
5. **业务前端**把 JWT 放进 iframe URL

---

## JWT claims 说明

引擎签发的 JWT（HS256）包含以下 claims：

| claim | 说明 |
| --- | --- |
| `name` | 用户名，用于协同光标显示 |
| `doc` | 文档 id。**必须与 iframe 的 `doc` 参数一致**，引擎会校验 |
| `role` | `editor`（可编辑）/ `commenter`（只读 + 可评论，mark 由服务端代写）/ `viewer`（纯只读）。引擎服务端会强制拒绝 commenter / viewer 的文档内容编辑 |
| `exp` | 过期时间（由 `JWT_EXPIRES_IN` 控制） |

> 角色由业务后端决定，前端不能篡改（篡改需持 API Key）。

---

## 业务后端实现

核心逻辑：业务后端新增一个接口，给前端用。这个接口：

1. 校验业务系统自己的登录态（原有鉴权逻辑）
2. 决定用户对该文档的角色（`editor` / `commenter` / `viewer`）—— 业务原有权限逻辑
3. 调引擎 `/oes/api/token` 签发 JWT，返回给前端

### Node.js 示例

```js
// 业务后端
app.get('/my-doc-token', authMiddleware, async (req, res) => {
  const docId = req.query.doc
  const userId = req.user.id
  const userName = req.user.name

  // 1. 校验用户能否访问该文档（业务原有逻辑）
  const role = await checkUserPermission(userId, docId)  // 'editor' / 'commenter' / 'viewer'

  // 2. 调引擎签 JWT（带上 UMO_API_KEY；注意路径带 /oes 前缀）
  const r = await fetch(
    `http://editor-host:9999/oes/api/token?name=${encodeURIComponent(userName)}&doc=${encodeURIComponent(docId)}&role=${role}`,
    { headers: { 'x-api-key': process.env.UMO_API_KEY } }
  )
  const { token } = await r.json()

  // 3. 返回给前端
  res.json({ token, doc: docId, role })
})
```

### Java 示例（Spring Boot）

```java
@RestController
public class DocTokenController {

    @Value("${umo.engine-url}")
    private String engineUrl;   // 如 http://editor-host:9999/oes

    @Value("${umo.api-key}")
    private String apiKey;

    @GetMapping("/my-doc-token")
    public Map<String, String> getToken(
            @RequestParam String doc,
            @AuthenticationPrincipal User user) {

        // 1. 校验权限，决定角色
        String role = permissionService.checkRole(user.getId(), doc); // "editor" / "commenter" / "viewer"

        // 2. 调引擎签 JWT
        String url = UriComponentsBuilder.fromHttpUrl(engineUrl + "/api/token")
                .queryParam("name", user.getName())
                .queryParam("doc", doc)
                .queryParam("role", role)
                .toUriString();

        HttpHeaders headers = new HttpHeaders();
        headers.set("x-api-key", apiKey);

        ResponseEntity<Map> resp = new RestTemplate().exchange(
                url, HttpMethod.GET, new HttpEntity<>(headers), Map.class);

        // 3. 返回给前端
        Map<String, String> result = new HashMap<>();
        result.put("token", (String) resp.getBody().get("token"));
        result.put("doc", doc);
        result.put("role", role);
        return result;
    }
}
```

### Python 示例（FastAPI）

```python
from fastapi import APIRouter, Depends, HTTPException
import httpx

router = APIRouter()
ENGINE_URL = "http://editor-host:9999/oes"   # 注意带 /oes 前缀
UMO_API_KEY = "..."  # 从环境变量读

@router.get("/my-doc-token")
async def get_token(doc: str, user: User = Depends(get_current_user)):
    # 1. 校验权限，决定角色
    role = await check_user_permission(user.id, doc)  # "editor" / "commenter" / "viewer"

    # 2. 调引擎签 JWT
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{ENGINE_URL}/api/token",
            params={"name": user.name, "doc": doc, "role": role},
            headers={"x-api-key": UMO_API_KEY},
        )
        r.raise_for_status()
        token = r.json()["token"]

    # 3. 返回给前端
    return {"token": token, "doc": doc, "role": role}
```

---

## token 过期处理

JWT 默认 24h 过期。建议：

- **方案 A（主动刷新）**：业务前端在 iframe 加载前检查 token 剩余有效期，临近过期（如剩余 < 1h）重新调业务后端换 token
- **方案 B（被动刷新）**：协同连接断开/鉴权失败时（iframe 内显示「协同鉴权失败」错误态），重新走「换 token → 重设 iframe src」流程。业务前端可通过轮询 `iframe.contentWindow.__UMO_EDITOR__` 是否存在或监听错误消息来判断

```js
// 主动刷新示例：在 iframe 加载前确保 token 新鲜
async function ensureFreshToken(docId) {
  const { token, exp } = await fetch(`/my-doc-token?doc=${docId}`).then(r => r.json())
  if (exp - Math.floor(Date.now() / 1000) < 3600) {
    // 剩余不足 1 小时：重新调业务后端签发（后端可短签）
    return (await fetch(`/my-doc-token?doc=${docId}`).then(r => r.json())).token
  }
  return token
}

// 被动刷新示例：感知编辑器挂掉后重载
let retries = 0
setInterval(() => {
  const ok = iframe.contentWindow.__UMO_EDITOR__ || editorReady
  if (!ok && retries < 3) {
    retries++
    loadTokenAndReload(docId)   // 重新签发 token → 重设 iframe.src
  }
}, 5000)
```

---

## 下一步

鉴权打通后，下一步是 [前端 iframe 嵌入](./embedding.md) —— 构造 `/oes/embed` URL。
