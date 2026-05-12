@echo off
REM ============================================
REM  Start ai-base gateway
REM  Run this before launching ftre desktop app
REM ============================================

echo Starting ai-base gateway...
echo.
echo Default address: ws://127.0.0.1:18790/
echo Press Ctrl+C to stop.
echo.

REM Try to start the gateway using Python
py -m uvicorn app.main:app --host 127.0.0.1 --port 18790

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start gateway.
    echo Please make sure:
    echo   1. Python is installed and in PATH
    echo   2. ai-base is installed (pip install -e .)
    echo   3. The gateway module is available
    echo.
    pause
)
