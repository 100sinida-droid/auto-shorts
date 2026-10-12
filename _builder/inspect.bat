@echo off
chcp 65001 >nul
set PYTHONUTF8=1
where python >/dev/null 2>/dev/null && (python build.py --inspect) || (py build.py --inspect)
pause
