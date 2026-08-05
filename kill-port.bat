@echo off
REM ============================================================
REM  Kill process(es) listening on a given port.
REM  Usage:
REM    kill-port.bat 4000        (command line)
REM    double-click -> enter port when prompted
REM ============================================================
setlocal enabledelayedexpansion

set "PORT=%~1"
if "%PORT%"=="" (
  set /p PORT=Enter port number to free (e.g. 4000)
)

if "!PORT!"=="" (
  echo [ERROR] No port given. Usage: kill-port.bat 4000
  exit /b 1
)

echo !PORT!| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo [ERROR] Port must be numeric, got: !PORT!
  exit /b 1
)

echo Looking up processes on port !PORT! ...

set "FOUND=0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":!PORT! "') do (
  set "PIDVAL=%%P"
  if not "!PIDVAL!"=="0" (
    set "FOUND=1"
    set "NAME="
    for /f "tokens=1 delims= " %%N in ('tasklist /FI "PID eq !PIDVAL!" /NH 2^>nul') do (
      if "!NAME!"=="" set "NAME=%%N"
    )
    echo Found: PID=!PIDVAL!  Name=!NAME!
    taskkill /PID !PIDVAL! /F >nul 2>&1
    if !errorlevel! equ 0 (
      echo Killed PID !PIDVAL! ^( !NAME! ^)
    ) else (
      echo [WARN] Failed to kill PID !PIDVAL! ^(try running as Administrator^)
    )
  )
)

if "!FOUND!"=="0" (
  echo No process is listening on port !PORT!.
)

echo Done.
endlocal
