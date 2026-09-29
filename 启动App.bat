@echo off
chcp 936 >nul
title NDT-劳人 学习刷题 App
cd /d "%~dp0"

rem ============================================
rem  NDT-劳人 学习刷题 App 一键启动
rem  1. 检查 Node.js 是否已安装
rem  2. 首次运行自动安装依赖
rem  3. 启动开发服务器并自动打开浏览器
rem  关闭本窗口 = 停止服务
rem ============================================

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js。
    echo         请先到 https://nodejs.org 下载并安装 LTS 版本，装完再双击本文件。
    echo.
    pause
    exit /b 1
)

rem 端口 8443 若已在运行（例如服务器已开），直接打开浏览器
netstat -ano | findstr ":8443" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo 服务已经在运行，正在打开浏览器 http://localhost:8443 ...
    start "" "http://localhost:8443"
    echo.
    echo 如需停止服务，请找到对应的黑色命令行窗口并关闭它。
    echo.
    pause
    exit /b 0
)

rem 首次运行：安装依赖
if not exist node_modules (
    echo 首次运行，正在安装依赖（约 1~3 分钟，请耐心等待）...
    echo.
    call npm install
    echo.
    echo 依赖安装完成。
)

echo 正在启动开发服务器 ...
echo 稍候会自动打开浏览器，若未自动打开请手动访问 http://localhost:8443
echo.
echo 提示：本窗口请保持开启，关闭窗口即停止服务。
echo.

rem 后台延时 5 秒后打开浏览器
start "" /min cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:8443"

call npm run dev

echo.
echo 服务已停止。
pause
