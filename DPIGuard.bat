@echo off
title DPIGuard Turkey
cd /d "%~dp0"

:: Check for admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Yonetici izni gerekli, yeniden baslatiliyor...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo   ========================================
echo     DPIGuard Turkey v1.0.0
echo     DPI Bypass - Hiz Kaybi Yok!
echo   ========================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [HATA] Node.js bulunamadi!
    echo Node.js indirin: https://nodejs.org
    pause
    exit /b
)

:: Install deps if needed
if not exist "node_modules" (
    echo Bagimliliklar yukleniyor...
    npm install --production 2>nul
    npm install electron --save-dev 2>nul
)

echo Uygulama baslatiliyor...
echo Bu pencereyi kapatmayin!
echo.

npx electron . 2>nul

pause
