@echo off
chcp 65001 >nul
set PYTHONUTF8=1
where python >nul 2>nul && (python build.py %*) || (py build.py %*)
pause
