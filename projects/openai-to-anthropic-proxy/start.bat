@echo off
REM ============================================================
REM  WorkBuddy → MiniMax (Anthropic) Protocol Proxy Launcher
REM  中文输出全部委托给 PowerShell，避免 cmd 解析器误识别括号
REM ============================================================
REM 切到本脚本所在目录（避免 cmd /c start.bat 时 cwd 不是项目目录）
cd /d "%~dp0"
chcp 65001 >nul 2>&1
setlocal
title WorkBuddy + MiniMax Proxy

REM ---- 1. 配置：MINIMAX_API_KEY 必填 ----
REM 【必填】MiniMax Coding Plan 订阅 Key（以 sk-cp- 开头）
REM 推荐方式：把这行改成你自己的 Key；或者在系统环境变量里设 MINIMAX_API_KEY
set MINIMAX_API_KEY=sk-cp-REPLACE_ME_WITH_YOUR_MINIMAX_KEY

REM 【可选】监听端口，默认 18000
set PORT=18000

REM 【可选】日志级别：debug / info / warn / error
set LOG_LEVEL=info

REM ---- 2. ASCII 横幅（cmd 安全，避免中文解析 bug） ----
echo.
echo ============================================================
echo   WorkBuddy + MiniMax Protocol Proxy Launcher
echo ============================================================
echo   PORT            = %PORT%
echo   LOG_LEVEL       = %LOG_LEVEL%
echo.

REM ---- 3. 预检查：端口是否被占 ----
powershell -NoProfile -Command "$p=Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($p) { Write-Host '[ERROR] port %PORT% occupied by PID' $p.OwningProcess; Write-Host '        fix: Get-Process node | Stop-Process -Force'; exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [ERROR] Port %PORT% is already in use.
  echo   fix: Get-Process node | Stop-Process -Force
  echo   then re-run this start.bat
  echo ============================================================
  pause
  exit /b 1
)

echo   Press Ctrl+C to stop
echo ============================================================
echo.

REM ---- 4. 启动代理 ----
node proxy.js --port %PORT% --log %LOG_LEVEL%
set RC=%ERRORLEVEL%

REM ---- 5. 退出横幅（全部委托给 PowerShell，中文安全） ----
powershell -NoProfile -Command ^
  "Write-Host '';" ^
  "Write-Host '============================================================';" ^
  "Write-Host ('  Proxy exited. Exit code = ' + %RC%);" ^
  "Write-Host '';" ^
  "Write-Host '  Exit code reference:';" ^
  "Write-Host '    0   = node process exited normally';" ^
  "Write-Host '    1   = startup failed (port in use / invalid key / uncaught exception)';" ^
  "Write-Host '    130 = received SIGINT (Ctrl+C or external interrupt)';" ^
  "Write-Host '    143 = received SIGTERM (taskkill or external signal)';" ^
  "Write-Host '    3221225786 / -1073741510 = STATUS_CONTROL_C_EXIT (Win32 console close)';" ^
  "Write-Host '    other = check the [proxy] === EXIT code=... line above for reason';" ^
  "Write-Host '';" ^
  "Write-Host '  Next time for full debug output, run from PowerShell:';" ^
  "Write-Host '    node proxy.js --port %PORT% --log debug';" ^
  "Write-Host '============================================================';"

pause >nul
endlocal
