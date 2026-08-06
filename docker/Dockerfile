# =============================================================================
# Umo Editor 全栈单镜像 Dockerfile
# -----------------------------------------------------------------------------
# 三阶段构建：
#   1. editor-builder  ：构建编辑器库 dist/（vue + tiptap + less）
#   2. demo-builder    ：构建 demo 前端静态资源 demo/dist/（引用上层 dist）
#   3. runner          ：运行时镜像（nginx + supervisor + 2 个 node 服务）
#
# 对外端口 9999（nginx），容器内：
#   nginx           → 静态资源 + 反代
#   collab-server   → :4000（Yjs 协同 WebSocket + /api/token）
#   demo-server     → :4001（文档元数据 REST）
#   convert-server  → :4002（HTML → .docx 格式转换）
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
RUN npm install --ignore-scripts && npm run build


# ===========================================================================
# Stage 2：构建 demo 前端
# ===========================================================================
FROM crpi-h7gzaxnskayufpzy.cn-hongkong.personal.cr.aliyuncs.com/1049/node:22-bookworm-slim AS demo-builder

WORKDIR /build/demo

# demo 通过 file:.. 引用上层仓库的编辑器库。但 npm install 在解析 file:.. 时会
# 读取上层 package.json 的 dependencies/devDependencies 并尝试安装上层整棵依赖树，
# 在 slim 镜像里触发脚本 bin 链接失败（exit 127）。
# 解决：install 时先移除 @umoteam/editor 这一行，正常装其余依赖；然后手动把
# Stage 1 构建好的 dist/ + package.json 放进 node_modules/@umoteam/editor，
# vite/vite build 通过包名即可解析。
COPY demo/package.json demo/package-lock.json ./

# install 前剔除 file:.. 依赖，避免 npm 深入上层仓库
RUN node -e "const f='package.json';const p=JSON.parse(require('fs').readFileSync(f,'utf8'));delete p.dependencies['@umoteam/editor'];require('fs').writeFileSync(f,JSON.stringify(p,null,2))" \
    && npm install --ignore-scripts --no-package-lock

# 放入编辑器库产物（已构建好的 ESM bundle）
RUN mkdir -p node_modules/@umoteam/editor
COPY package.json ./node_modules/@umoteam/editor/package.json
COPY --from=editor-builder /build/dist ./node_modules/@umoteam/editor/dist

# demo 源码 + 配置
COPY demo/index.html demo/vite.config.js ./
COPY demo/src/ ./src/

RUN npm run build


# ===========================================================================
# Stage 3：运行时镜像
# ===========================================================================
FROM crpi-h7gzaxnskayufpzy.cn-hongkong.personal.cr.aliyuncs.com/1049/node:22-bookworm-slim AS runner

# 装运行时依赖：nginx（反代入口）+ supervisor（进程管理）
# better-sqlite3 通过 install 脚本（prebuild-install）下载预编译二进制，无需 python/make/g++
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx supervisor ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---------- 协同服务（collab-server）----------
COPY collab-server/package.json collab-server/package-lock.json ./collab-server/
COPY collab-server/server.js collab-server/storage.js ./collab-server/

WORKDIR /app/collab-server
# 注意：不能用 --ignore-scripts。better-sqlite3 的 install 脚本负责下载与当前 Node ABI
# 匹配的预编译 .node 二进制（prebuild-install），跳过会导致运行时找不到原生模块。
RUN npm install --omit=dev
WORKDIR /app

# ---------- 文档管理后端（demo/server）----------
COPY demo/server/package.json demo/server/package-lock.json ./demo/server/
COPY demo/server/index.js ./demo/server/

WORKDIR /app/demo/server
RUN npm install --omit=dev
WORKDIR /app

# ---------- 文档转换服务（convert-server）----------
COPY convert-server/package.json convert-server/package-lock.json ./convert-server/
COPY convert-server/server.js ./convert-server/

WORKDIR /app/convert-server
RUN npm install --omit=dev
WORKDIR /app

# ---------- 前端静态资源 ----------
COPY --from=demo-builder /build/demo/dist /app/public

# ---------- 配置文件 ----------
# nginx.conf 是完整的顶层配置（含 events/http 块），直接覆盖主配置
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# ---------- 数据目录（供卷挂载持久化）----------
RUN mkdir -p /app/collab-server/data /app/demo/server/data

# ---------- 环境变量默认值 ----------
ENV NODE_ENV=production \
    PORT_COLLAB=4000 \
    PORT_DEMO=4001 \
    JWT_SECRET=umo-collab-secret-dev-only \
    JWT_EXPIRES_IN=24h

EXPOSE 9999

# supervisor 前台运行，托管 nginx + 2 个 node 服务
CMD ["supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
