@echo off
chcp 65001 >nul
title 脱稿训练场
cd /d "%~dp0"

echo ==============================================
echo   脱稿训练场 · 启动中
echo ==============================================

if not exist "backend\venv\Scripts\python.exe" (
  echo [错误] 未找到虚拟环境，请先安装依赖：
  echo   cd backend
  echo   python -m venv venv
  echo   venv\Scripts\pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/
  pause
  exit /b 1
)

netstat -ano | findstr ":8642" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo [提示] 8642 端口已被占用——服务可能已经在运行。
  echo 直接为你打开页面...
  start "" http://localhost:8642
  pause
  exit /b 0
)

echo 本机访问:    http://localhost:8642
echo 局域网访问:  http://你的IP:8642
echo.
echo 本机局域网 IP:
ipconfig | findstr /i "IPv4"
echo.

timeout /t 2 /nobreak >nul
start "" http://localhost:8642

backend\venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8642 --app-dir backend

echo.
echo [服务已退出] 如果上方有报错信息，请截图反馈；正常使用中不要关闭本窗口。
pause
