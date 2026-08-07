@echo off
REM ============================================================
REM  Umo Editor 引擎镜像 Docker 一键构建启动
REM  构建并启动引擎容器，对外端口 9999。
REM ============================================================
setlocal

set "COMPOSE_FILE=%~dp0docker-compose.yml"

echo Building and starting Umo Editor engine ...
echo.

docker compose -f "%COMPOSE_FILE%" up -d --build
if errorlevel 1 (
  echo.
  echo [FAILED] Build or start failed. See messages above.
  pause
  exit /b 1
)

echo.
echo [OK] Engine started on http://localhost:9999
echo.
echo   Health check : http://localhost:9999/api/health
echo   iframe embed : http://localhost:9999/embed?doc=^<docId^>^&token=^<jwt^>
echo.
echo   (Engine root returns the embed page; a doc/token pair is required to mount the editor.)
echo.
pause

endlocal
