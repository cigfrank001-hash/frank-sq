@echo off
chcp 65001 >nul
title WorkBuddy + MiniMax Coding Plan Proxy
setlocal

REM ────────────────────────────────────────────────────────────────
REM  WorkBuddy → MiniMax (Anthropic 协议) 协议转换代理
REM  使用前请把下面 sk-cp-... 替换成你自己的 MiniMax Token Plan Key
REM ────────────────────────────────────────────────────────────────

REM 【必填】MiniMax Coding Plan 订阅 Key（以 sk-cp- 开头）
REM 推荐方式：把这行改成你自己的 Key；或者在系统环境变量里设 MINIMAX_API_KEY
REM 安全提醒：不要把真实 Key 提交到 Git！下面这行是占位符示例。
set MINIMAX_API_KEY=sk-cp-REPLACE_ME_WITH_YOUR_MINIMAX_KEY

REM 【可选】监听端口，默认 18000
set PORT=18000

REM 【可选】日志级别：debug / info / warn / error
set LOG_LEVEL=info

echo.
echo ============================================================
echo   WorkBuddy + MiniMax (Anthropic) Protocol Proxy
echo ============================================================
echo   MINIMAX_API_KEY = %MINIMAX_API_KEY:~0,12%...
echo   PORT            = %PORT%
echo   LOG_LEVEL       = %LOG_LEVEL%
echo.

REM ─── 预检查：端口是否被占（避免一闪而过看不到错误） ───
powershell -NoProfile -Command "$p=Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($p) { Write-Host '[ERROR] 端口 %PORT% 已被进程占用 (PID ' $p.OwningProcess ')'; Write-Host '        Get-Process node | Stop-Process -Force'; exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo.
  echo   上面是被占原因。杀进程后双击 start.bat 重试。
  echo ============================================================
  pause
  exit /b 1
)

echo   按 Ctrl+C 退出
echo ============================================================
echo.

node proxy.js --port %PORT% --log %LOG_LEVEL%
set RC=%ERRORLEVEL%

REM 无论成功失败都暂停（避免窗口一闪而过看不到错误）
echo.
echo ============================================================
echo   代理已退出。退出码 = %RC%
echo.
echo   退出码含义：
echo     0   = node 进程主动退出（process.exit(0)，被代码调用）
echo     1   = 启动失败（端口被占 / Key 不合法 / 未捕获异常）
echo     130 = 收到 SIGINT（Ctrl+C 或外部中断）
echo     143 = 收到 SIGTERM（taskkill / 外部终止信号）
echo     3221225786 / -1073741510 = 0xC000013A STATUS_CONTROL_C_EXIT
echo     其他 = 查阅窗口上方 [proxy] === EXIT code=... 那一行看 reason
echo.
echo   下次运行建议：开 PowerShell 运行：
echo     node proxy.js --port %PORT% --log debug
echo   能看到完整的退出原因与堆栈。
echo ============================================================
pause >nul
endlocal
