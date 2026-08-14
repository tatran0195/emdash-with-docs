@echo off
REM Quick launcher for the apps/bun demo.
REM   start.cmd
REM   start.cmd prod
REM   start.cmd check
setlocal
cd /d "%~dp0"
node scripts\start.mjs %*
exit /b %ERRORLEVEL%
