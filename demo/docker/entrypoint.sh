#!/bin/sh
# =============================================================================
# demo 容器入口脚本
# -----------------------------------------------------------------------------
# 启动前根据环境变量生成前端运行时配置 /app/public/config.js，
# 这样部署后改环境变量（UMO_ENGINE_PUBLIC_URL）即可更新引擎地址，无需重新构建镜像。
#
# 应用统一挂在 /oes 前缀下：
#   apiBase    留空 → 前端同源调 /oes/api/*（demo nginx 内部剥前缀转给 demo-server）
#   engineUrl  = UMO_ENGINE_PUBLIC_URL（浏览器加载引擎 iframe 用，必须是浏览器可访问地址）
#              · 无外部 nginx：http://<引擎容器host>:9999/oes
#              · 有外部 nginx：http://<nginx host>:<port>/oes
#   routerBase 固定 '/oes'（Vue Router history 基础路径，与 vite base 一致）
# =============================================================================

# 前端构建产物在 /app/public/oes/ 下（与 URL /oes/ 对应），config.js 同目录
CONFIG_FILE=/app/public/oes/config.js
# 默认指向本机引擎容器；带 /oes 应用前缀
ENGINE_PUBLIC_URL="${UMO_ENGINE_PUBLIC_URL:-http://localhost:9999/oes}"

cat > "$CONFIG_FILE" <<EOF
/**
 * 运行时配置（由容器 entrypoint 根据环境变量自动生成，请勿手动编辑）
 * 修改引擎地址请改容器的 UMO_ENGINE_PUBLIC_URL 环境变量后重启容器。
 */
window.__UMO_CONFIG__ = {
  apiBase: '',
  engineUrl: '${ENGINE_PUBLIC_URL}',
  routerBase: '/oes',
}
EOF

echo "[entrypoint] 已生成 config.js：engineUrl=${ENGINE_PUBLIC_URL}"

exec supervisord -n -c /etc/supervisor/conf.d/supervisord.conf
