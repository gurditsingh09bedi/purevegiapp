@echo off
rem Pure Vegi on this Windows PC: double-click this file.
rem Starts the API (8000), notification worker, staff app (3000) and customer website (5173).
rem First run installs everything (5-10 minutes). Later runs start in under a minute.
title Pure Vegi starter
cd /d "%~dp0"

set PY=
where py >nul 2>nul && set PY=py -3
if not defined PY where python >nul 2>nul && set PY=python
if not defined PY (
  echo Python is not installed. Install Python 3.12 from https://www.python.org/downloads/
  echo IMPORTANT: tick "Add python.exe to PATH" in the installer, then run this file again.
  start https://www.python.org/downloads/
  pause & exit /b 1
)
where npm >nul 2>nul || (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org/ then run this file again.
  start https://nodejs.org/
  pause & exit /b 1
)

cd backend
if not exist .venv (
  echo [1/4] Making the Python environment...
  %PY% -m venv .venv || (echo Could not make the Python environment. & pause & exit /b 1)
)
set VPY=%cd%\.venv\Scripts\python.exe
"%VPY%" -c "import fastapi, sqlalchemy, cryptography, stripe" 2>nul || (
  echo [2/4] Installing the server packages, first time only...
  "%VPY%" -m pip install --quiet --upgrade pip
  "%VPY%" -m pip install --quiet . || (echo Package install failed, see the message above. & pause & exit /b 1)
)
if not exist .env (
  echo PV_ENV=dev> .env
  echo PV_DATABASE_URL=sqlite:///./purevegi.db>> .env
  "%VPY%" -c "import secrets; print('PV_JWT_SECRET=' + secrets.token_urlsafe(48))" >> .env
  echo PV_DEV_PAYMENTS=true>> .env
  "%VPY%" -m app.vapid >> .env
)
"%VPY%" -m app.seed --owner-email owner@purevegi.co.uk --owner-password Test12345
"%VPY%" -m app.menu_import --if-sample
cd ..

for %%d in (admin web) do (
  if not exist %%d\.env copy %%d\.env.example %%d\.env >nul
  if not exist %%d\node_modules (
    echo [3/4] Installing %%d, first time only...
    pushd %%d & call npm install --no-audit --no-fund & popd
  )
)

echo [4/4] Starting Pure Vegi in four windows (close them to stop)...
start "Pure Vegi API (port 8000)" /d "%~dp0backend" cmd /k ""%VPY%" -m uvicorn app.main:app --port 8000 --reload"
start "Pure Vegi notifications" /d "%~dp0backend" cmd /k ""%VPY%" -m app.worker"
start "Pure Vegi staff app (port 3000)" /d "%~dp0admin" cmd /k "npm run dev"
start "Pure Vegi website (port 5173)" /d "%~dp0web" cmd /k "npm run dev"

timeout /t 10 /nobreak >nul
start http://localhost:5173
start http://localhost:3000
echo.
echo Pure Vegi is running:
echo   Customer website: http://localhost:5173
echo   Staff app (kitchen + admin): http://localhost:3000   login owner@purevegi.co.uk / Test12345
echo   API docs: http://localhost:8000/docs
echo.
echo To stop: close the four Pure Vegi windows.
pause
