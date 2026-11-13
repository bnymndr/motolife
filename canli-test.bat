@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules call npm install
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared kurulu degil. Once su komutu calistir, sonra bu dosyayi tekrar ac:
  echo    winget install --id Cloudflare.cloudflared
  pause
  exit /b
)
start "Moto Interkom Sunucu" cmd /k npm start
timeout /t 3 >nul
echo.
echo Asagida cikan https://....trycloudflare.com adresini telefonda ac.
echo Durdurmak icin Ctrl + C (sunucu penceresini de kapat)
echo.
cloudflared tunnel --url http://localhost:3000
