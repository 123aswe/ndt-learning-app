@echo off
title NDT-劳人刷题 App · Python 服务
cd /d "%~dp0"

echo ============================================================
echo   NDT-劳人刷题 App · Python 服务启动器
echo ============================================================
echo.

REM -- 1. 检查 Python --
where python >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Python。请先安装 Python 3.10 以上版本，
  echo        安装时记得勾选 "Add Python to PATH"。
  echo        下载：https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('python -V 2^>^&1') do echo [1/4] 已检测到 %%v

REM -- 2. 创建虚拟环境（首次运行） --
if not exist ".venv\Scripts\python.exe" (
  echo [2/4] 首次运行，正在创建虚拟环境 .venv ...
  python -m venv .venv
  if errorlevel 1 (
    echo [错误] 创建虚拟环境失败。
    pause
    exit /b 1
  )
) else (
  echo [2/4] 虚拟环境已存在，跳过创建
)

REM -- 3. 安装依赖（首次或依赖变化后） --
if not exist ".venv\.deps_ok" (
  echo [3/4] 正在安装依赖（首次较慢，请耐心等待）...
  ".venv\Scripts\python.exe" -m pip install --upgrade pip -q
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo 国内镜像安装失败，改用官方源重试 ...
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt -i https://pypi.org/simple
    if errorlevel 1 (
      echo.
      echo [错误] 依赖安装失败，请检查网络后重试。
      pause
      exit /b 1
    )
  )
  echo ok > ".venv\.deps_ok"
) else (
  echo [3/4] 依赖已安装，跳过
)

REM -- 4. 配置文件 --
if not exist "config.json" (
  if exist "config.example.json" (
    copy /y "config.example.json" "config.json" >nul
    echo [4/4] 已生成 config.json（首次）。
  )
) else (
  echo [4/4] config.json 已存在
)

echo.
echo ------------------------------------------------------------
echo   服务即将启动，请不要关闭此窗口
echo   管理后台：http://127.0.0.1:8000/admin/
echo   接口文档：http://127.0.0.1:8000/docs
echo   默认管理员：admin / admin123（请登录后立即修改）
echo ------------------------------------------------------------
echo.

start "" http://127.0.0.1:8000/admin/
".venv\Scripts\python.exe" main.py

pause
