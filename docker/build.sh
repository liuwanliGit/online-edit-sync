#!/usr/bin/env bash
# =============================================================================
# Umo Editor 全栈 Docker 一键构建脚本
# -----------------------------------------------------------------------------
# 用法：
#   bash docker/build.sh          # 仅构建镜像
#   bash docker/build.sh up       # 构建并启动
#   bash docker/build.sh down     # 停止并清理
# =============================================================================

set -euo pipefail

# 定位仓库根（脚本位于 docker/ 目录下）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

cd "$REPO_ROOT"

# ---- 前置检查 ----
if ! command -v docker >/dev/null 2>&1; then
  echo "❌ 未检测到 docker，请先安装 Docker。"
  exit 1
fi

# docker compose v2（plugin）优先，回退到 v1（docker-compose）
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "❌ 未检测到 docker compose（v2 插件或 docker-compose 命令），请安装其一。"
  exit 1
fi

ACTION="${1:-build}"

case "$ACTION" in
  build)
    echo "🏗️  开始构建引擎镜像 umo-editor-engine:latest ..."
    echo "   build context: $REPO_ROOT"
    echo "   compose file : $COMPOSE_FILE"
    $DC -f "$COMPOSE_FILE" build
    echo ""
    echo "✅ 构建完成。"
    echo "   启动：  bash docker/build.sh up"
    echo "   健康检查：curl http://localhost:9999/oes/api/health"
    ;;

  up)
    echo "🚀 构建并启动引擎 ..."
    $DC -f "$COMPOSE_FILE" up -d --build
    echo ""
    echo "✅ 已启动。"
    echo "   健康检查：curl http://localhost:9999/oes/api/health"
    echo "   iframe 嵌入：http://localhost:9999/oes/embed?doc=<docId>&token=<jwt>"
    echo "   查看日志：$DC -f \"$COMPOSE_FILE\" logs -f"
    echo "   停止：    bash docker/build.sh down"
    ;;

  down)
    echo "🛑 停止并清理容器 ..."
    $DC -f "$COMPOSE_FILE" down
    echo "✅ 已停止（数据卷保留）。"
    ;;

  logs)
    $DC -f "$COMPOSE_FILE" logs -f
    ;;

  *)
    echo "用法：bash docker/build.sh [build|up|down|logs]"
    echo "  build （默认）— 仅构建镜像"
    echo "  up             — 构建并后台启动"
    echo "  down           — 停止并清理容器"
    echo "  logs           — 跟踪日志"
    exit 1
    ;;
esac
