@echo off
setlocal
chcp 65001 >nul

REM Windows 手工诊断入口。正式客户端由 Electron 主进程直接 spawn；这里也只
REM 使用安装包自带的 Python，不回退到 py/python，避免用户环境缺失时行为漂移。
set "SCRIPT_DIR=%~dp0"
set "PYTHON_EXE=%SCRIPT_DIR%backend\python\python.exe"
set "SERVER_DIR=%SCRIPT_DIR%backend\server"

if not exist "%PYTHON_EXE%" (
    echo [ERROR] 找不到内置 Python: %PYTHON_EXE%
    exit /b 1
)
if not exist "%SERVER_DIR%\ftre" (
    echo [ERROR] 找不到内置 Gateway 源码: %SERVER_DIR%
    exit /b 1
)

set "PYTHONPATH=%SERVER_DIR%;%PYTHONPATH%"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUNBUFFERED=1"
set "PYTHONNOUSERSITE=1"

echo Starting ftre gateway...
pushd "%SERVER_DIR%"
"%PYTHON_EXE%" -m ftre.main gateway %*
set "EXIT_CODE=%ERRORLEVEL%"
popd
if not "%EXIT_CODE%"=="0" echo [ERROR] ftre gateway exited with code %EXIT_CODE%.
exit /b %EXIT_CODE%
