@echo off
setlocal
cd /d "%~dp0"
uv run --no-sync python main.py browser-server
if errorlevel 1 pause
