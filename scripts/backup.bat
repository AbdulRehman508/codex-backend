@echo off
REM Nightly database backup. Registered in Windows Task Scheduler as
REM "Codex DB Backup" — see README. Logs beside the backups themselves.
setlocal

set "APP_DIR=%~dp0.."
cd /d "%APP_DIR%"

if not exist "backups" mkdir "backups"

echo [%date% %time%] backup starting >> "backups\backup.log"
call npm run backup >> "backups\backup.log" 2>&1

if errorlevel 1 (
  echo [%date% %time%] BACKUP FAILED - check the lines above >> "backups\backup.log"
  exit /b 1
)

echo [%date% %time%] backup done >> "backups\backup.log"
endlocal
