@echo off
chcp 936 >nul
title NDT-劳人刷题 App · 公网访问
cd /d "%~dp0"

rem ============================================================
rem  把本机服务发布到公网（Cloudflare 快速隧道）
rem  前置：能跑一次 npm run build；server 依赖已安装
rem  零配置：不用注册、不用填密钥，跑起来就自动分配一个公网地址
rem  注意：快速隧道地址每次重启都会变，重启后请重新获取并发给别人
rem  关闭本窗口 = 公网访问中断（本机不受影响）
rem ============================================================

echo ============================================================
echo   NDT-劳人学习刷题 App · 公网访问（一键）
echo   隧道平台：Cloudflare 快速隧道（TryCloudflare）
echo   本窗口一直开着，别人才能用浏览器访问你的 App
echo ============================================================
echo.

rem ---------- 1/5 前端构建产物 ----------
if not exist "dist\index.html" (
  echo [1/5] 未发现 dist\index.html，正在构建前端（约 1 分钟）...
  call npm run build
  if not exist "dist\index.html" (
    echo.
    echo [错误] 前端构建失败，请先修复构建错误再运行本脚本。
    pause
    exit /b 1
  )
) else (
  echo [1/5] 前端产物就绪
)

rem ---------- 2/5 Python 运行环境 ----------
if not exist "server\.venv\Scripts\python.exe" (
  echo [2/5] Python 虚拟环境不存在，正在新窗口完成初始化 ...
  start "NDT 后端服务" /D "%~dp0server" cmd /c "启动服务.bat"
  echo       等安装完成后，请按提示回到本窗口重新运行本脚本。
  echo.
  pause
  exit /b 0
)
echo [2/5] Python 环境就绪

rem ---------- 3/5 隧道客户端 cloudflared ----------
if not exist "tools\cloudflared.exe" (
  echo [3/5] 未发现 tools\cloudflared.exe，开始下载（约 53MB）...
  call "tools\下载cloudflared.bat"
  if not exist "tools\cloudflared.exe" (
    echo [错误] cloudflared 不可用，无法建立隧道。
    pause
    exit /b 1
  )
) else (
  echo [3/5] 隧道客户端就绪
)

rem ---------- 4/5 后端服务 ----------
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>nul
if errorlevel 1 (
  echo [4/5] 后端未运行，正在新窗口启动 ...
  start "NDT 后端服务" /D "%~dp0server" cmd /c ".venv\Scripts\python.exe main.py"
  call :wait_backend
) else (
  echo [4/5] 后端已在运行
)

rem ---------- 5/5 建立公网隧道 ----------
echo [5/5] 正在建立公网隧道 ...
echo       隧道起来后会把公网地址打印在下面，同时写入「公网地址.txt」。
"server\.venv\Scripts\python.exe" "tools\tunnel.py" 8000

echo.
echo 公网隧道已结束。
echo 提示：若后端窗口仍在运行，请手动停止或关闭「NDT 后端服务」窗口。
pause
exit /b 0

rem ------------------------------------------------------------
rem  轮询等待后端就绪（最多 60 秒）
rem ------------------------------------------------------------
:wait_backend
set /a _wait=0
:wait_loop
set /a _wait+=1
if %_wait% gtr 60 (
  echo        [警告] 等待后端超时，请自行确认后端已启动。
  exit /b 0
)
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try{ Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8000/api/health ^| Out-Null; exit 0 }catch{ exit 1 }" >nul 2>nul
if errorlevel 1 goto wait_loop
echo        后端已就绪
exit /b 0
