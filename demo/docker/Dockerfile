# =============================================================================
# Umo Editor 瘦客户端示例镜像（demo 前端 + demo 后端）
# -----------------------------------------------------------------------------
# 两阶段构建：
#   1. demo-frontend-builder ：构建 demo 前端 dist（vue + vite）
#   2. runtime               ：运行时镜像（nginx + supervisor + demo-server）
#
# 对外端口 9998（nginx），容器内：
#   nginx        → 静态资源（demo 前端）+ 反代 /api/ → demo-server
#   demo-server  → :4001（文档元数据 + 代理签 JWT + 接收导出文件）
#
# 引擎是单独的镜像（umo-editor-engine:9999），通过 docker-compose 编排。
# demo-server 通过 UMO_ENGINE_URL 指向引擎；前端 iframe 通过 config.js 的 engineUrl
# 指向浏览器可访问的引擎地址（由 entrypoint.sh 在启动时写入）。
# ============================================================================


# ===========================================================================
# Stage 1：构建 demo 前端
# ===========================================================================
FROM crpi-h7gzaxnskayufpzy.cn-hongkong.personal.cr.aliyuncs.com/1049/node:22-bookworm-slim AS demo-frontend-builder

WORKDIR /build/demo

# 先复制 package 元信息，利用层缓存
COPY demo/package.json demo/package-lock.json ./

# 前端纯 JS 依赖（无原生模块），可跳过 install 脚本加速
RUN npm install --ignore-scripts

# 源码 + 配置（public 含 config.js 模板，构建时原样复制到 dist）
COPY demo/index.html demo/vite.config.js ./
COPY demo/public/ ./public/
COPY demo/src/ ./src/

# docs 目录（DocsView.vue 通过 import.meta.glob('../../../docs/**/*.md') 静态内联文档）
# glob 从 demo/src/views/ 上溯 3 层到 /build/，故 docs 需放在 /build/docs/
COPY docs/ /build/docs/

RUN npm run build


# ===========================================================================
# Stage 2：运行时镜像
# ===========================================================================
FROM crpi-h7gzaxnskayufpzy.cn-hongkong.personal.cr.aliyuncs.com/1049/node:22-bookworm-slim AS runtime

# 装运行时依赖：nginx（反代入口）+ supervisor（进程管理）
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx supervisor ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---------- demo 后端（demo-server）----------
COPY demo/server/package.json demo/server/package-lock.json ./server/

WORKDIR /app/server
# 注意：不能用 --ignore-scripts。better-sqlite3 的 install 脚本负责下载与当前 Node ABI
# 匹配的预编译 .node 二进制（prebuild-install），跳过会导致运行时找不到原生模块。
RUN npm install --omit=dev

# demo-server 源码 + 配置文件
# 注意：index.js 顶部 import 了 ./comments.js（评论 REST + SSE）和 ./config.json（运行配置），
# 若漏 COPY 任一文件，node 启动会抛 ERR_MODULE_NOT_FOUND，进程被 supervisor 反复重启，
# 表现为 nginx 反代 /oes/api/* 时 502（connect() failed (111: Connection refused) on 127.0.0.1:4001）。
COPY demo/server/index.js demo/server/comments.js ./
COPY demo/server/config.json demo/server/config.example.json ./
WORKDIR /app

# ---------- demo 前端静态资源 ----------
# 放到 /app/public/oes/ 下：URL /oes/assets/x.js 用 root /app/public 自然映射，
# 无需 nginx alias/rewrite 处理前缀（alias 与 try_files/rewrite 有已知兼容问题）
COPY --from=demo-frontend-builder /build/demo/dist /app/public/oes

# ---------- 配置文件 ----------
COPY demo/docker/nginx.conf /etc/nginx/nginx.conf
COPY demo/docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY demo/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# ---------- 数据目录（供卷挂载持久化）----------
RUN mkdir -p /app/server/data

# ---------- 环境变量默认值 ----------
# UMO_ENGINE_URL：demo-server 调引擎 /api/token 时用（容器内通信，默认指向 compose 内的引擎服务名）
# UMO_ENGINE_PUBLIC_URL：浏览器访问引擎的地址（写入前端 config.js，iframe 用）
ENV NODE_ENV=production \
    PORT=4001 \
    DB_PATH=/app/server/data/docs.db \
    UMO_ENGINE_URL=http://umo-editor-engine:9999 \
    UMO_API_KEY= \
    UMO_ENGINE_PUBLIC_URL=http://localhost:9999

EXPOSE 9998

# entrypoint 先根据环境变量生成 /app/public/config.js，再启动 supervisor
ENTRYPOINT ["/entrypoint.sh"]
