@echo off
rem Web CAD Studio 로컬 실행 (큰 DWG 파일은 이 방식으로만 열립니다)
rem 이 창을 켜 둔 동안 브라우저에서 http://localhost:5173 으로 접속할 수 있습니다. 창을 닫으면 종료됩니다.
rem 같은 Wi-Fi의 휴대폰에서는 아래에 표시되는 Network 주소(예: http://192.168.x.x:5173)로 접속하세요.
chcp 65001 > nul
cd /d "%~dp0"
if not exist node_modules (
  echo 처음 실행이라 필요한 패키지를 설치합니다...
  call npm install
)
call npm run dev -- --open
pause
