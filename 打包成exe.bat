@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo options: (no arg)=folder   --onefile   --with-models   --dry
backend\venv\Scripts\python.exe build_exe.py %*
echo.
pause
