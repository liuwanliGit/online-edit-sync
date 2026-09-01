# oes-report-mcp 远程服务镜像
# 构建:  docker build -t oes-report-mcp .
# 运行:  docker run -d -p 3100:3100 \
#          -e MCP_API_KEY=<强随机key> \
#          --restart unless-stopped oes-report-mcp
# 下载链接前缀默认按请求头动态推导(反代转发 X-Forwarded-* 即可,内外网多域名通用,
# 见 deploy/nginx.conf);仅单域名且无反代头时才需 -e PUBLIC_BASE_URL=http://<对外地址>:3100 固定。
# 输出目录无需挂载卷:产物走 /dl/<token> 临时链接取回,容器内落盘即可;
# 需要持久留存时再挂 -v <host-dir>:/app/output(可选)。
#
# 基底用 debian slim 而非 alpine:@napi-rs/canvas 的 musl 预编译兼容性未验证,
# glibc 基底 + 其自带静态链接 skia 是稳妥路径。
# 镜像走仓库同源的阿里云镜像仓库(本网络 docker.io 不可达;有代理可换回 node:22-bookworm-slim)
FROM crpi-h7gzaxnskayufpzy.cn-hongkong.personal.cr.aliyuncs.com/1049/node:22-bookworm-slim

WORKDIR /app

# 先装依赖(利用 docker 层缓存)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit

# 中文字体:slim 基底无任何字体,echarts/@napi-rs/canvas 画不出文字(标题/轴标签/图例全丢)
RUN set -eux; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
        /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    apt-get update; \
    apt-get install -y --no-install-recommends fontconfig fonts-noto-cjk; \
    rm -rf /var/lib/apt/lists/*; \
    fc-cache -f

# 再拷业务代码
COPY report.mjs tools.mjs server.mjs http-server.mjs ./

ENV PORT=3100 \
    OUTPUT_DIR=/app/output \
    DOWNLOAD_TTL=300 \
    NODE_ENV=production

EXPOSE 3100

# stdio 模式入口(容器场景一般用 http-server,改 CMD 即可):
#   docker run -i oes-report-mcp node server.mjs
CMD ["node", "http-server.mjs"]
