@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 脱稿训练场 · 环境配置
cd /d "%~dp0"

set "REQ=backend\requirements.txt"
set "VENV=backend\venv"
set "VPY=%VENV%\Scripts\python.exe"
set "MIN_VER=3.11"

:home
cls
echo ============================================================
echo            脱稿训练场 · 一键环境配置
echo ============================================================
echo.
echo  本脚本将依次完成：
echo    1. 检查 Python（要求 %MIN_VER% 或更高版本）
echo       未安装 / 版本过低时，可自动安装或手动引导
echo    2. 创建虚拟环境 %VENV%
echo    3. 选择下载源并安装项目依赖
echo       （FastAPI / sherpa-onnx / faster-whisper 等）
echo.
echo  按 Y 开始，按 N 退出。
choice /c YN /n /m "[Y/N]: "
if errorlevel 2 (
  echo 已取消，未做任何修改。
  exit /b 0
)

echo.
echo [1/3] 正在检测 Python ...
call :detect_python
if not defined PYEXE goto no_python
echo       已找到 Python !PYVER!
echo       解释器: !PYEXE!
goto py_ok

REM ============================================================
REM  未检测到可用 Python：自动安装 / 手动引导
REM ============================================================
:no_python
echo       未检测到 Python %MIN_VER%+（未安装或版本过低）。
echo.
echo  请选择安装方式：
echo    [1] 自动安装（winget 安装 Python 3.12，用户级安装，无需管理员权限）
echo    [2] 手动安装（打开官网下载页，附操作指引）
echo    [3] 退出
choice /c 123 /n /m "请输入选项 [1-3]: "
if errorlevel 3 exit /b 1
if errorlevel 2 goto manual_install
goto winget_install

:winget_install
echo.
echo [安装] 正在检查 winget 是否可用 ...
winget --version >nul 2>nul
if errorlevel 1 (
  echo [安装] 当前系统没有 winget（Win10 1809+ / Win11 自带，老系统需先装应用安装器）。
  echo        改用手动方式。
  pause
  goto manual_install
)
echo [安装] 开始安装 Python 3.12，如弹出系统确认窗口请点“是” ...
echo.
winget install -e --id Python.Python.3.12 --source winget --scope user --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
  echo.
  echo [安装] winget 自动安装未成功，改用手动方式。
  pause
  goto manual_install
)
echo.
echo [安装] 安装完成，正在重新检测 ...
REM 新装 Python 在当前会话的 PATH 里还没生效，先临时注入用户级默认目录
set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"
call :detect_python
if not defined PYEXE (
  echo.
  echo [安装] 仍未检测到 Python。请关闭本窗口后重新运行一次（让 PATH 生效），
  echo        或重新运行后选择 [2] 手动安装。
  pause
  exit /b 1
)
echo       已找到 Python !PYVER!
echo       解释器: !PYEXE!
goto py_ok

:manual_install
echo.
echo ------------------------------------------------------------
echo  手动安装步骤：
echo    1. 浏览器打开 https://www.python.org/downloads/
echo    2. 下载 Python %MIN_VER% 或更高版本（推荐 3.12）
echo    3. 运行安装器，第一步务必勾选 "Add python.exe to PATH"
echo    4. 安装完成后重新双击运行本脚本
echo ------------------------------------------------------------
echo.
choice /c YN /n /m "现在打开 Python 下载页面吗？ [Y/N]: "
if errorlevel 2 (
  pause
  exit /b 1
)
start "" "https://www.python.org/downloads/"
echo 已在浏览器打开下载页，装好后重新运行本脚本。
pause
exit /b 1

REM ============================================================
REM  Python 已就绪：创建 / 复用虚拟环境
REM ============================================================
:py_ok
echo.
echo [2/3] 配置虚拟环境 %VENV% ...
if exist "%VPY%" goto venv_exists
goto create_venv

:venv_exists
echo       发现已存在的虚拟环境：
echo         [U] 直接使用（更新 / 补装依赖，推荐）
echo         [R] 删除后重建（环境损坏时选这个）
echo         [C] 取消退出
choice /c URC /n /m "请选择 [U/R/C]: "
if errorlevel 3 exit /b 0
if errorlevel 2 (
  echo       正在删除旧虚拟环境 ...
  rmdir /s /q "%VENV%"
  if exist "%VPY%" (
    echo       删除失败，可能有程序正在占用该目录，请先关闭相关窗口后重试。
    pause
    exit /b 1
  )
  goto create_venv
)
goto venv_ready

:create_venv
if not exist "%REQ%" (
  echo [错误] 找不到依赖清单 %REQ%，请确认脚本位于项目根目录。
  pause
  exit /b 1
)
echo       正在创建虚拟环境（首次约需 10-30 秒）...
"%PYEXE%" -m venv "%VENV%"
if errorlevel 1 (
  echo [错误] 虚拟环境创建失败，请检查上方报错信息。
  pause
  exit /b 1
)

:venv_ready
if not exist "%VPY%" (
  echo [错误] 虚拟环境异常：未找到 %VPY%
  pause
  exit /b 1
)
echo       正在升级 pip ...
"%VPY%" -m pip install --upgrade pip -i https://mirrors.aliyun.com/pypi/simple/ >nul 2>nul

REM ============================================================
REM  选择下载源并安装依赖
REM ============================================================
echo.
echo [3/3] 安装项目依赖 ...
echo    依赖包含 sherpa-onnx（中文语音引擎），体积较大，请耐心等待。
echo.
echo  选择 pip 下载源：
echo    [1] 阿里云镜像（国内网络推荐）
echo    [2] 清华大学镜像
echo    [3] 官方源 pypi.org
choice /c 123 /n /m "请输入选项 [1-3]: "
if errorlevel 3 (set "IDX=" & goto do_install)
if errorlevel 2 (set "IDX=-i https://pypi.tuna.tsinghua.edu.cn/simple" & goto do_install)
set "IDX=-i https://mirrors.aliyun.com/pypi/simple/"

:do_install
echo.
"%VPY%" -m pip install -r "%REQ%" %IDX%
if errorlevel 1 (
  echo.
  echo [错误] 依赖安装失败。可检查网络后重新运行本脚本，已有虚拟环境时选择 [U] 并换一个下载源重试。
  pause
  exit /b 1
)

echo.
echo       正在验证核心依赖 ...
"%VPY%" -c "import fastapi, uvicorn, sherpa_onnx, faster_whisper, openai, numpy, yaml; print('core deps OK')"
if errorlevel 1 (
  echo [警告] 部分依赖导入异常，请回看上方安装日志。
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   环境配置完成！
echo.
echo   启动方式：双击「启动.bat」
echo   访问地址：http://localhost:8642
echo   首次使用：在网页「设置 - 语音模型」中按需下载语音模型
echo ============================================================
echo.
choice /c YN /n /m "是否立即启动服务？ [Y/N]: "
if errorlevel 2 exit /b 0
start "" "启动.bat"
exit /b 0

REM ============================================================
REM  子程序：检测可用的 Python 3.11+，成功则设置
REM    PYEXE = python.exe 绝对路径，PYVER = x.y.z
REM  注意：for /f 不直接执行带多层引号的命令，统一写临时文件
REM  再以 usebackq 读取，避免引号嵌套导致的解析错误
REM ============================================================
:detect_python
set "PYEXE="
set "PYVER="
set "_TMP=%TEMP%\_et_pyinfo.txt"

REM ① py 启动器（最可靠，可绕开 Microsoft Store 的 python 占位符）
if exist "%SystemRoot%\py.exe" (
  "%SystemRoot%\py.exe" -3 -c "import sys;sys.exit(0 if sys.version_info>=(3,11) else 1)" >nul 2>nul
  if !errorlevel!==0 (
    "%SystemRoot%\py.exe" -3 -c "import sys;print('%%d.%%d.%%d'%%sys.version_info[:3]);print(sys.executable)" >"!_TMP!" 2>nul
    for /f "usebackq delims=" %%a in ("!_TMP!") do if not defined PYVER set "PYVER=%%a"
    for /f "usebackq skip=1 delims=" %%a in ("!_TMP!") do set "PYEXE=%%a"
  )
)
if defined PYEXE goto det_done

REM ② PATH 中的 python（排除 WindowsApps 商店占位别名）
for /f "delims=" %%p in ('where python 2^>nul') do (
  echo %%p | findstr /i /c:"WindowsApps" >nul
  if errorlevel 1 if not defined PYEXE call :try_exe "%%p"
)

REM ③ 常见安装目录（用户级 / 系统级，3.13 - 3.11）
for %%V in (313 312 311) do if not defined PYEXE call :try_exe "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
for %%V in (313 312 311) do if not defined PYEXE call :try_exe "%ProgramFiles%\Python%%V\python.exe"

:det_done
if exist "!_TMP!" del "!_TMP!" >nul 2>nul
goto :eof

:try_exe
if defined PYEXE goto :eof
if not exist "%~1" goto :eof
"%~1" -c "import sys;sys.exit(0 if sys.version_info>=(3,11) else 1)" >nul 2>nul
if errorlevel 1 goto :eof
"%~1" -c "import sys;print('%%d.%%d.%%d'%%sys.version_info[:3])" >"%TEMP%\_et_pyver.txt" 2>nul
for /f "usebackq delims=" %%a in ("%TEMP%\_et_pyver.txt") do set "PYVER=%%a"
if exist "%TEMP%\_et_pyver.txt" del "%TEMP%\_et_pyver.txt" >nul 2>nul
set "PYEXE=%~1"
goto :eof
