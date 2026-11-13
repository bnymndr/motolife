@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules call npm install
echo.
echo Telefonda (ayni Wi-Fi) su adreslerden birini ac:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo    http://%%b:3000
echo.
echo Durdurmak icin Ctrl + C
echo.
npm start
