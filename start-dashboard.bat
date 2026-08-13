@echo off
REM Run this by double-clicking it, placed inside your lead-agent-saas project
REM folder (same folder as server.js and package.json).

set PROJECT_DIR=%~dp0
set DOWNLOADED_FILE=%USERPROFILE%\Downloads\dashboard_2.html

echo Copying dashboard file into place...
if exist "%DOWNLOADED_FILE%" (
    copy /Y "%DOWNLOADED_FILE%" "%PROJECT_DIR%public\dashboard.html"
) else (
    echo Could not find %DOWNLOADED_FILE% - skipping copy.
    echo If your downloaded file has a different name, copy it manually into the public folder as dashboard.html.
)

cd /d "%PROJECT_DIR%"

echo Starting the server...
start "Lead Agent Server" cmd /k "node server.js"

echo Waiting for it to boot...
timeout /t 3 /nobreak >nul

echo Opening the dashboard in your browser...
start http://localhost:3000/dashboard.html

echo Done. Leave the server window open - closing it stops the app.
pause
