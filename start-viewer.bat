@echo off
chcp 65001 > nul
title Web CAD Studio (server)
cd /d "%~dp0"
rem Web CAD Studio local run. Big DWG files open only with this server.
rem Keep this window open while using http://localhost:5173 - closing the window stops the server.
rem Phones on the same Wi-Fi: open the Network address shown below (http://192.168.x.x:5173).
where node > nul 2>&1
if errorlevel 1 (
  echo [!] Node.js를 찾을 수 없습니다. https://nodejs.org 에서 Node.js 24 이상을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)
if not exist node_modules (
  echo 처음 실행이라 필요한 패키지를 설치합니다...
  call npm install
)
echo.
echo 서버를 시작합니다. 잠시 후 브라우저가 열립니다. (열리지 않으면 http://localhost:5173 을 직접 입력하세요)
echo.
call npm run dev -- --open
echo.
echo 서버가 종료되었습니다. 위 메시지를 확인하세요.
pause
