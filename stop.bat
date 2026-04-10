@echo off
echo =^> Stopping Bionic Brain...

echo =^> Stopping backend (port 8000)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 " ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)

echo =^> Stopping frontend (port 3000)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)

echo =^> Stopped.
