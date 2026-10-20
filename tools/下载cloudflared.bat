@echo off
chcp 936 >nul
title 下载 Cloudflare 隧道客户端 cloudflared
cd /d "%~dp0"

rem ============================================================
rem  下载 Cloudflare 快速隧道客户端到 tools\cloudflared.exe
rem  一般由「启动公网访问.bat」自动调用，也可单独运行
rem  从官方 GitHub Release 拉最新版 Windows amd64
rem ============================================================

set "PY=..\server\.venv\Scripts\python.exe"
if not exist "%PY%" (
  where python >nul 2>nul
  if errorlevel 1 (
    echo.
    echo [错误] 找不到 Python，请先运行 server\启动服务.bat 初始化环境。
    echo.
    pause
    exit /b 1
  )
  set "PY=python"
)

"%PY%" "tunnel.py" --download

if exist "cloudflared.exe" (
  echo.
  echo 完成：%CD%\cloudflared.exe
) else (
  echo.
  echo [错误] 下载未成功，请检查网络后重试。
)
echo.
pause
