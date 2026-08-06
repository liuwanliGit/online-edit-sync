@echo off
REM ============================================================
REM  Umo Editor full-stack Docker build & run (one command)
REM  Builds the image and starts the container on port 9999.
REM ============================================================
setlocal

set "COMPOSE_FILE=%~dp0docker-compose.yml"

echo Building and starting Umo Editor ...
echo.

docker compose -f "%COMPOSE_FILE%" up -d --build
if errorlevel 1 (
  echo.
  echo [FAILED] Build or start failed. See messages above.
  pause
  exit /b 1
)

echo.
echo [OK] Started. Opening http://localhost:9999 ...
start "" http://localhost:9999

endlocal
