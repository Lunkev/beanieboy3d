@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installerar paket...
  call npm install
)
echo Hamtar 3D-modeller och bilder som saknas...
call node scripts\fetch-assets.mjs
call npm run dev
