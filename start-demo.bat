@echo off
chcp 65001 >nul
title 应急助手 · 演示启动器
cd /d "%~dp0"

echo ==========================================
echo   应急助手 · M2.5 演示启动
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 node。请先安装 Node.js 18+。
  pause
  exit /b 1
)

echo [1/3] 启动本地代理（127.0.0.1:8787）...
start "应急助手 · 代理" /D "%~dp0" cmd /k node tools\llm_proxy.mjs

echo [2/3] 启动静态页面（localhost:8899）...
start "应急助手 · 页面" /D "%~dp0app" cmd /k python -m http.server 8899

echo [3/3] 等待服务就绪并打开浏览器...
timeout /t 2 /nobreak >nul
start "" "http://localhost:8899/index.html"

echo.
echo 已启动。演示时不要关闭那两个命令行窗口。
echo 如果页面打不开：等 2 秒刷新一次，或检查 8787 / 8899 是否被占用。
echo.
pause
