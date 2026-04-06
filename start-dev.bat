@echo off
REM ============================================
REM ClaudeLink — Local Dev Launcher (Windows)
REM Starts relay + companion + app on LAN
REM Both phone and PC must be on same WiFi
REM ============================================

setlocal enabledelayedexpansion

REM Auto-detect LAN IP (skip virtual adapters like 172.x)
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4" ^| findstr /v "172."') do (
    set "LAN_IP=%%a"
    set "LAN_IP=!LAN_IP: =!"
    goto :found_ip
)
:found_ip

if "%LAN_IP%"=="" set "LAN_IP=127.0.0.1"

set RELAY_PORT=8787
set EXPO_PORT=8081
set RELAY_URL=ws://%LAN_IP%:%RELAY_PORT%
set ROOT_DIR=%~dp0

echo ============================================
echo   ClaudeLink Dev Launcher
echo ============================================
echo.
echo   LAN IP:     %LAN_IP%
echo   Relay:      %RELAY_URL%
echo   Expo:       http://%LAN_IP%:%EXPO_PORT%
echo.
echo ============================================
echo.

REM Kill leftover processes on our ports
echo Cleaning up old processes...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%RELAY_PORT% " ^| findstr "LISTENING"') do (
    echo   Killing leftover on port %RELAY_PORT% (PID: %%p)
    taskkill /F /PID %%p >nul 2>&1
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%EXPO_PORT% " ^| findstr "LISTENING"') do (
    echo   Killing leftover on port %EXPO_PORT% (PID: %%p)
    taskkill /F /PID %%p >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo.

REM Start relay in new window
echo [1/3] Starting relay on port %RELAY_PORT%...
start "ClaudeLink Relay" cmd /c "cd /d %ROOT_DIR%claudelink-server\relay && npx wrangler dev --local --port %RELAY_PORT% --ip 0.0.0.0"
timeout /t 10 /nobreak >nul

REM Start companion in new window (saves QR PNG to project root)
echo [2/3] Starting companion...
start "ClaudeLink Companion" cmd /c "cd /d %ROOT_DIR%claudelink-server && bin\claudelink-companion.exe --relay %RELAY_URL% --qr-dir %ROOT_DIR% --pair-port 8788 && pause"
timeout /t 5 /nobreak >nul

REM Auto-open the QR code PNG
for /f "delims=" %%f in ('dir /b /o-d "%ROOT_DIR%claudelink-qr-*.png" 2^>nul') do (
    echo   Opening QR code: %ROOT_DIR%%%f
    start "" "%ROOT_DIR%%%f"
    goto :qr_opened
)
:qr_opened
echo.

REM Start Expo in new window
echo [3/3] Starting Expo app...
echo.
echo ============================================
echo   ON YOUR PHONE:
echo   1. Scan Expo QR from the Expo window with Expo Go
echo   2. In the app: tap 'Pair Device'
echo   3. Scan the QR PNG (opened on your screen)
echo      Relay URL:  %RELAY_URL%
echo ============================================
echo.
start "ClaudeLink App" cmd /c "cd /d %ROOT_DIR%claudelink-app && npx expo start --lan --port %EXPO_PORT%"

echo All 3 services started in separate windows.
echo Close those windows to stop, or press any key to kill all.
pause

REM Kill all on exit
taskkill /FI "WINDOWTITLE eq ClaudeLink Relay" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq ClaudeLink Companion" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq ClaudeLink App" /F >nul 2>&1
REM Clean up QR code PNGs
del /q "%ROOT_DIR%claudelink-qr-*.png" >nul 2>&1
echo Stopped all services.
