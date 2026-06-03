#!/bin/bash
# 一键启动：带 CDP 调试端口启动官方 OpenCode，并挂上 hover 消息预览外挂。
# 用法：双击本文件，或终端执行  bash start-opencode-hover.command
# 停用：关闭本终端窗口 / Ctrl+C（只停外挂，不影响 OpenCode）。
export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"
set -u

APP="/Applications/OpenCode.app"
DIR="$(cd "$(dirname "$0")" && pwd)"
BUN="${HOME}/.bun/bin/bun"
PORT=9222
VER_URL="http://127.0.0.1:${PORT}/json/version"

[ -x "${BUN}" ] || BUN="$(command -v bun || true)"
if [ -z "${BUN:-}" ] || [ ! -x "${BUN}" ]; then echo "找不到 bun，请先安装。"; exit 1; fi
if [ ! -d "${APP}" ]; then echo "找不到 ${APP}"; exit 1; fi

# 先停掉已有的助手，保证全局只有一个（重复运行 = 自动替换旧的）
pkill -f "hover-helper.js" 2>/dev/null && { echo "已停止旧的注入助手。"; sleep 1; }

# 1) 已在运行但没带调试端口 -> 退出后用调试端口重启
if pgrep -f "OpenCode.app/Contents/MacOS/OpenCode" >/dev/null 2>&1; then
  if curl -s "${VER_URL}" >/dev/null 2>&1; then
    echo "OpenCode 已带调试端口在运行，直接挂外挂。"
  else
    echo "OpenCode 正在普通运行（无调试端口），退出后重启..."
    osascript -e 'quit app "OpenCode"' 2>/dev/null
    for i in $(seq 1 20); do pgrep -f "OpenCode.app/Contents/MacOS/OpenCode" >/dev/null 2>&1 || break; sleep 0.5; done
    pgrep -f "OpenCode.app/Contents/MacOS/OpenCode" >/dev/null 2>&1 && { pkill -f "OpenCode.app/Contents/MacOS/OpenCode"; sleep 2; }
  fi
fi

# 2) 未运行则启动（带调试端口）
if ! curl -s "${VER_URL}" >/dev/null 2>&1; then
  echo "启动 OpenCode 调试端口 ${PORT} ..."
  open -a "${APP}" --args --remote-debugging-port="${PORT}"
fi

# 3) 等端口就绪（首启加载库较慢，最多约 90 秒）
ready=0
for i in $(seq 1 180); do
  curl -s "${VER_URL}" >/dev/null 2>&1 && { ready=1; break; }
  sleep 0.5
done
if [ "${ready}" != "1" ]; then
  echo "调试端口未就绪，此版本可能禁用了远程调试，外挂无法注入。"
  exit 1
fi

echo "已就绪，挂载 hover 外挂。保持本窗口开着即生效，关闭窗口或 Ctrl+C 即停用。"
exec "${BUN}" "${DIR}/hover-helper.js"
