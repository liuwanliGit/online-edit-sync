# =============================================================================
# Umo Editor 引擎镜像 Dockerfile（私有化交付）
# -----------------------------------------------------------------------------
# 三阶段构建：
#   1. editor-builder ：构建编辑器库 dist/（vue + tiptap + less）
#   2. embed-builder  ：构建 /embed 纯编辑器页 embed/dist/（引用上层 dist）
#   3. engine         ：运行时镜像（nginx + supervisor + 2 个 node 服务）
#
# 对外端口 9999（nginx），容器内：
#   nginx           → 静态资源（/embed 前端）+ 反代
#   collab-server   → :4000（Yjs 协同 WebSocket + /api/token + /api/health）
#   convert-server  → :4002（HTML → .docx 格式转换）
#
# 不含：demo 前端、demo-server、登录页、文档列表（这些是业务系统自己的职责）。
# 二阶段追加：read-server(:4003)、convert-server docId 无头导出入口。
# =============================================================================


# ===========================================================================
# Stage 1：构建编辑器库
# ===========================================================================
FROM crpi-h7gzaxnskayufpzy.cn-hongkong.personal.cr.aliyuncs.com/1049/node:22-bookworm-slim AS editor-builder

WORKDIR /build

# 先复制 package 元信息，利用层缓存（copyright.js 会 import ../../package.json，
# 因此必须保留完整源码树结构，不能只复制 package.json）
COPY package.json package-lock.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY vite.config.js ./
# 注意：types/ 目录由 unplugin-auto-import / unplugin-vue-components 在构建时
# 自动生成（imports.d.ts / components.d.ts），不再随源码提交，故不 COPY

# 构建脚本需要 src/utils/copyright.js（已在 src/ 内）。
# husky 的 prepare 钩子在容器内无意义，跳过。
# 用国内 npm 镜像加速依赖下载
RUN npm config set registry https://registry.npmmirror.com \
    && npm install --ignore-scripts \
    && npm run build


# ===========================================================================
# Stage 2：构建 /embed 纯编辑器页（iframe 着陆页）
# ===========================================================================
FROM crpi-h7gzaxnskayufpzy.cn-hongkong.personal.cr.aliyuncs.com/1049/node:22-bookworm-slim AS embed-builder

WORKDIR /build/embed

# embed 通过 file:.. 引用上层仓库的编辑器库。但 npm install 在解析 file:.. 时会
# 读取上层 package.json 的 dependencies/devDependencies 并尝试安装上层整棵依赖树，
# 在 slim 镜像里触发脚本 bin 链接失败（exit 127）。
# 解决：install 时先移除 @umoteam/editor 这一行，正常装其余依赖；然后手动把
# Stage 1 构建好的 dist/ + package.json 放进 node_modules/@umoteam/editor，
# vite/vite build 通过包名即可解析。
COPY embed/package.json embed/package-lock.json ./

# install 前剔除 file:.. 依赖，避免 npm 深入上层仓库
RUN node -e "const f='package.json';const p=JSON.parse(require('fs').readFileSync(f,'utf8'));delete p.dependencies['@umoteam/editor'];require('fs').writeFileSync(f,JSON.stringify(p,null,2))" \
    && npm config set registry https://registry.npmmirror.com \
    && npm install --ignore-scripts --no-package-lock

# 放入编辑器库产物（已构建好的 ESM bundle）
RUN mkdir -p node_modules/@umoteam/editor
COPY package.json ./node_modules/@umoteam/editor/package.json
COPY --from=editor-builder /build/dist ./node_modules/@umoteam/editor/dist

# embed 源码 + 配置
COPY embed/index.html embed/vite.config.js ./
COPY embed/src/ ./src/

RUN npm run build


# ===========================================================================
# Stage 3：运行时镜像（引擎）
# ===========================================================================
FROM crpi-h7gzaxnskayufpzy.cn-hongkong.personal.cr.aliyuncs.com/1049/node:22-bookworm-slim AS engine

# 装运行时依赖：nginx（反代入口）+ supervisor（进程管理）
# 同时装 make/g++/python3：better-sqlite3 优先用 prebuild-install 下载预编译二进制，
# 但容器网络无法访问 GitHub releases 时会回退到 node-gyp 源码编译，需要 make/g++/python3。
# 先换国内镜像源加速 apt（容器内访问 deb.debian.org 很慢）
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' \
        /etc/apt/sources.list.d/debian.sources 2>/dev/null \
    || sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null \
    || true
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       nginx supervisor ca-certificates make g++ python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---------- 协同服务（collab-server）----------
COPY collab-server/package.json collab-server/package-lock.json ./collab-server/
COPY collab-server/server.js collab-server/storage.js collab-server/comment-storage.js collab-server/yjs-position.js ./collab-server/

WORKDIR /app/collab-server
# 注意：不能用 --ignore-scripts。better-sqlite3 的 install 脚本负责下载与当前 Node ABI
# 匹配的预编译 .node 二进制（prebuild-install），下载失败时回退到 node-gyp 源码编译。
# 用国内 npm 镜像加速依赖下载
RUN npm config set registry https://registry.npmmirror.com \
    && npm install --omit=dev \
    && npm config delete registry
WORKDIR /app

# ---------- 文档转换服务（convert-server）----------
COPY convert-server/package.json convert-server/package-lock.json ./convert-server/
COPY convert-server/server.js ./convert-server/

WORKDIR /app/convert-server
RUN npm config set registry https://registry.npmmirror.com \
    && npm install --omit=dev \
    && npm config delete registry
WORKDIR /app

# ---------- embed 前端静态资源 ----------
# 放到 /app/public/oes/embed/ 下：URL /oes/embed/assets/x.js 用 root /app/public 自然映射，
# 无需 nginx alias/rewrite 处理前缀（alias 与 try_files/rewrite 有已知兼容问题）。
# 引擎专属前缀 /oes/embed/ 与 demo 的 /oes/ 错开：单域名外层 nginx 按最长前缀匹配分流
# /oes/embed* → 引擎容器，其余 /oes/* → demo 容器，两套 /assets/ 不再冲突。
COPY --from=embed-builder /build/embed/dist /app/public/oes/embed

# ---------- 配置文件 ----------
# nginx.conf 是完整的顶层配置（含 events/http 块），直接覆盖主配置
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# ---------- 数据目录（供卷挂载持久化）----------
RUN mkdir -p /app/collab-server/data

# ---------- 环境变量默认值 ----------
# UMO_API_KEY 留空：未设置时 /api/token 处于 dev 无鉴权模式；生产部署务必通过 -e 注入强随机值
ENV NODE_ENV=production \
    PORT_COLLAB=4000 \
    JWT_SECRET=umo-collab-secret-dev-only \
    JWT_EXPIRES_IN=24h \
    UMO_API_KEY=

EXPOSE 9999

# supervisor 前台运行，托管 nginx + 2 个 node 服务（不再有 demo-server）
CMD ["supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
