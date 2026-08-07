@echo off
REM ============================================================
REM  Umo Editor 瘦客户端验证脚本
REM  分阶段验证：前端构建 → 后端启动 → 引擎连通 → 接口自检
REM ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul

set "ROOT=%~dp0"
set "DEMO=%ROOT%demo"
set "SERVER=%DEMO%\server"
set /a STEP=0
set /a FAIL=0

echo ============================================================
echo   Umo Editor 瘦客户端验证
echo   %date% %time%
echo ============================================================
echo.

REM ---- 1. 前端依赖安装 ----
set /a STEP+=1
echo [%STEP%] 安装前端依赖...
cd /d "%DEMO%"
call npm install
if errorlevel 1 (
  echo [FAIL] 前端 npm install 失败
  set /a FAIL+=1
  goto :step2
)
echo [OK] 前端依赖安装成功
echo.

REM ---- 2. 前端构建（验证无 import 错误）----
:step2
set /a STEP+=1
echo [%STEP%] 构建前端（验证无断链 import）...
cd /d "%DEMO%"
call npm run build
if errorlevel 1 (
  echo [FAIL] 前端构建失败 —— 存在断链 import 或语法错误
  set /a FAIL+=1
  goto :step3
)
echo [OK] 前端构建成功，无 import 错误
echo.

REM ---- 3. 后端依赖安装 ----
:step3
set /a STEP+=1
echo [%STEP%] 安装后端依赖...
cd /d "%SERVER%"
call npm install
if errorlevel 1 (
  echo [FAIL] 后端 npm install 失败
  set /a FAIL+=1
  goto :step4
)
echo [OK] 后端依赖安装成功
echo.

REM ---- 4. 后端启动 + 接口自检 ----
:step4
set /a STEP+=1
echo [%STEP%] 启动示例后端并自检接口...
cd /d "%SERVER%"

REM 后台启动后端
start "umo-demo-server" /min cmd /c "node index.js"

REM 等待启动
echo   等待后端就绪...
set /a WAIT=0
:waitloop
timeout /t 1 /nobreak >nul
set /a WAIT+=1
curl -s http://localhost:4001/api/health >nul 2>&1
if errorlevel 1 (
  if !WAIT! lss 10 goto :waitloop
  echo [FAIL] 后端 10s 内未响应
  set /a FAIL+=1
  goto :step5
)

echo   [OK] 后端已启动 (http://localhost:4001)

REM 健康检查
echo   - GET /api/health
curl -s http://localhost:4001/api/health
echo.

REM 文档列表
echo   - GET /api/documents
curl -s http://localhost:4001/api/documents
echo.

REM 新建文档
echo   - POST /api/documents
curl -s -X POST http://localhost:4001/api/documents -H "Content-Type: application/json" -d "{\"title\":\"验证测试文档\",\"createdBy\":\"verify-script\"}"
echo.

REM 代理签 token（需引擎运行，否则预期失败）
echo   - POST /api/doc-token (需引擎 :9999 运行)
curl -s -X POST http://localhost:4001/api/doc-token -H "Content-Type: application/json" -d "{\"doc\":\"test-doc\",\"name\":\"测试用户\",\"role\":\"editor\"}"
echo.
echo.

REM ---- 5. 引擎连通性 ----
:step5
set /a STEP+=1
echo [%STEP%] 检查引擎镜像 (http://localhost:9999)...
curl -s http://localhost:9999/api/health >nul 2>&1
if errorlevel 1 (
  echo [SKIP] 引擎未运行 —— 跳过引擎相关验证
  echo   如需端到端验证，请先启动引擎：docker\build.bat
  set /a FAIL+=1
  goto :summary
)
echo   [OK] 引擎运行中
echo   - GET /api/health
curl -s http://localhost:9999/api/health
echo.
echo   - GET /embed?doc=test^&token=test (应返回 HTML 页)
curl -s -o nul -w "  HTTP %%{http_code}" "http://localhost:9999/embed?doc=test&token=test"
echo.
echo.

REM ---- 6. 端到端：代理签 token ----
set /a STEP+=1
echo [%STEP%] 端到端：通过示例后端代理签 JWT...
echo   - POST http://localhost:4001/api/doc-token
curl -s -X POST http://localhost:4001/api/doc-token -H "Content-Type: application/json" -d "{\"doc\":\"verify-doc\",\"name\":\"测试\",\"role\":\"editor\"}"
echo.
echo.

:summary
REM ---- 关闭后端 ----
taskkill /fi "windowtitle eq umo-demo-server*" /f >nul 2>&1

echo ============================================================
if !FAIL! equ 0 (
  echo   全部验证通过
) else (
  echo   有 !FAIL! 项未通过（见上方 [FAIL]/[SKIP]）
)
echo.
echo   下一步：
echo   1. 启动引擎：  docker\build.bat
echo   2. 启动后端：  cd demo\server ^&^& npm start
echo   3. 启动前端：  cd demo ^&^& npm run dev
echo   4. 浏览器打开 http://localhost:5173 体验完整流程
echo ============================================================
pause
endlocal
