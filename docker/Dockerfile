# =============================================================================
# Umo Editor 全栈单镜像 Dockerfile
# -----------------------------------------------------------------------------
# 三阶段构建：
#   1. editor-builder  ：构建编辑器库 dist/（vue + tiptap + less）
#   2. demo-builder    ：构建 demo 前端静态资源 demo/dist/（引用上层 dist）
#   3. runner          ：运行时镜像（nginx + supervisor + 2 个 node 服务）
#
# 对外端口 9999（nginx），容器内：
#   nginx         → 静态资源 + 反代
#   collab-server → :4000（Yjs 协同 WebSocket + /api/token）
#   demo-server   → :4001（文档元数据 REST）
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
COPY types/ ./types/
COPY vite.config.js ./

# 构建脚本需要 src/utils/copyright.js（已在 src/ 内）。
# husky 的 prepare 钩子在容器内无意义，跳过。
RUN npm install --ignore-scripts && npm run build


# ===========================================================================
# Stage 2：构建 demo 前端
# ===========================================================================
FROM crpi-h7gzaxnskayufpzy.cn-hongkong.personal.cr.aliyuncs.com/1049/node:22-bookworm-slim AS demo-builder

WORKDIR /build/demo

# demo 通过 file:.. 引用上层仓库的 dist/，因此需把编辑器库产物放进 demo/node_modules 对应位置
# 先放 demo 自身元信息
COPY demo/package.json demo/package-lock.json ./

# 放编辑器库（package.json + 刚构建的 dist/），让 demo 的 file:.. 能解析
COPY package.json /build/package.json
# 注意：必须放在 demo/node_modules/@umoteam/editor 的位置，npm 才会把 file:.. 解析到它
# 但 file:.. 指向上层目录（/build），npm install 时会把 /build 安装到 node_modules/@umoteam/editor
# 所以上层 package.json + dist 必须在 /build 下
COPY --from=editor-builder /build/dist /build/dist

RUN npm install --ignore-scripts

# demo 源码 + 配置
COPY demo/index.html demo/vite.config.js ./
COPY demo/src/ ./src/

RUN npm run build


# ===========================================================================
# Stage 3：运行时镜像
# ===========================================================================
FROM crpi-h7gzaxnskayufpzy.cn-hongkong.personal.cr.aliyuncs.com/1049/node:22-bookworm-slim AS runner

# 装运行时依赖：nginx（反代入口）+ supervisor（进程管理）
# better-sqlite3 自带 linux-x64 预编译二进制，无需 python/make/g++
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx supervisor ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---------- 协同服务（collab-server）----------
COPY collab-server/package.json collab-server/package-lock.json ./collab-server/
COPY collab-server/server.js collab-server/storage.js ./collab-server/

WORKDIR /app/collab-server
RUN npm install --omit=dev --ignore-scripts
WORKDIR /app

# ---------- 文档管理后端（demo/server）----------
COPY demo/server/package.json demo/server/package-lock.json ./demo/server/
COPY demo/server/index.js ./demo/server/

WORKDIR /app/demo/server
RUN npm install --omit=dev --ignore-scripts
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
