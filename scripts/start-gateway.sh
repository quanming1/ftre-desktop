#!/bin/sh
# macOS/Linux 调试与手工诊断入口。正式客户端由 Electron 主进程直接 spawn，
# 这样可以把路径、进程组和日志管线统一收敛在 BackendSupervisor；本脚本只依赖安装包
# 自带的 runtime，不依赖用户系统 Python。
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKEND_DIR="$SCRIPT_DIR/backend"
PYTHON="$BACKEND_DIR/python/bin/python3.12"

if [ ! -x "$PYTHON" ]; then
  printf '%s\n' "找不到可执行的内置 Python: $PYTHON" >&2
  exit 1
fi

export PYTHONPATH="$BACKEND_DIR/server${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export PYTHONUNBUFFERED=1
export PYTHONNOUSERSITE=1

cd "$BACKEND_DIR/server"
exec "$PYTHON" -m ftre.main gateway "$@"
