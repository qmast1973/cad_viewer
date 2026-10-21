@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Starts the CAD viewer server (DWG conversion API included) and opens the browser.
start "" http://127.0.0.1:8795/index.html
node --max-old-space-size=4096 tools\server.js
