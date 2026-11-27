@echo off
cd /d "%~dp0"
where py >nul 2>&1
if not errorlevel 1 goto launcher
where python >nul 2>&1
if not errorlevel 1 goto python
echo Python 3 is required for local use. See README.md for GitHub Pages setup.
pause
exit /b 1
:launcher
py -3 serve-local.py
goto end
:python
python serve-local.py
:end
pause
