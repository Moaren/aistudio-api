@echo off
setlocal
cd /d "%~dp0"
uv run --no-sync python main.py server --port 8080
if errorlevel 1 pause
