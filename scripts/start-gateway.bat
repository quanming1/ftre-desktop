@echo off
REM ============================================
REM  Start ftre gateway (embedded Python runtime)
REM  Run this before launching ftre desktop app
REM ============================================

REM Resolve script directory (works in packaged exe and dev)
set "SCRIPT_DIR=%~dp0"

REM Use embedded Python from backend/python/
set "PYTHON_EXE=%SCRIPT_DIR%backend\python\python.exe"

REM Fallback to system Python if embedded not found
if not exist "%PYTHON_EXE%" (
    set "PYTHON_EXE=py"
)

echo Starting ftre gateway...
echo.

REM Read port from config.json (fallback 48650)
set "GATEWAY_PORT=48650"
for /f "delims=" %%P in ('"%PYTHON_EXE%" -c "import json,os; c=json.load(open(os.path.join(os.environ.get('USERPROFILE',os.path.expanduser('~')),'.ftre','config.json'))); print(c.get('servers',{}).get('gateway',{}).get('port',48650))" 2^>nul') do set "GATEWAY_PORT=%%P"

echo Gateway address: ws://127.0.0.1:%GATEWAY_PORT%/
echo Press Ctrl+C to stop.
echo.

REM Set working directory to backend/server (where ftre source lives)
set "SERVER_DIR=%SCRIPT_DIR%backend\server"
if not exist "%SERVER_DIR%\ftre" set "SERVER_DIR=%SCRIPT_DIR%.."

REM Start the gateway
"%PYTHON_EXE%" -m ftre.main gateway

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start ftre gateway.
    echo Please make sure:
    echo   1. ~/.ftre/config.json exists and has a valid api_key
    echo   2. The backend was bundled correctly (run: node scripts/bundle-backend.js)
    echo.
    pause
)
