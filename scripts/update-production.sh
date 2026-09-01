#!/usr/bin/env bash
# 一键把 dsh-HSD-usage 更新到最新版并登记到 DeepSeek Harness 生产（默认 ~/.dsh/profiles/web）。
# 用法： bash scripts/update-production.sh
# 说明：会写 ~/.dsh；确保 Clash 代理开着（默认 7897）。执行后自动重启 web 服务。
set -euo pipefail

PROFILE_HOME="${DSH_PROD_HOME:-$HOME/.dsh}"
PROFILE_DIR="$PROFILE_HOME/profiles/web"
PROXY_PORT="${DSH_HSD_PROXY:-7897}"
echo ">> 目标: $PROFILE_DIR"

# 1) git/pnpm 走本地代理（Clash Verge 7897）
export GIT_TERMINAL_PROMPT=0
git config --global http.proxy "http://127.0.0.1:${PROXY_PORT}" 2>/dev/null || true
git config --global https.proxy "http://127.0.0.1:${PROXY_PORT}" 2>/dev/null || true

cd "$PROFILE_DIR"

# 2) 更新插件到最新（GitHub 最新提交）
echo ">> 更新前 rev: $(grep -oE 'rev=[a-z0-9]+' node_modules/dsh-HSD-usage/lib/client.js 2>/dev/null | head -1 || echo none)"
if ! grep -q 'dsh-HSD-usage' package.json; then
  echo ">> 依赖缺失，先加入依赖..."
  dsh plugin --profile web add 'github:ayc299419-art/dsh-HSD-usage' 2>&1 | tail -6
else
  echo ">> pnpm up dsh-HSD-usage ..."
  pnpm up dsh-HSD-usage 2>&1 | tail -6
fi

# 3) 若 pnpm 拦 git 依赖构建，放行后重试
if ! grep -q 'dsh-HSD-usage' package.json 2>/dev/null; then
  WS="$PROFILE_DIR/pnpm-workspace.yaml"
  if [ -f "$WS" ]; then
    python3 - "$WS" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
if 'allowBuilds' not in s:
    s += "\nallowBuilds:\n  dsh-HSD-usage: true\n"
    open(p, 'w', encoding='utf-8').write(s)
    print('>> 已加入 allowBuilds: dsh-HSD-usage')
PY
  fi
  dsh plugin --profile web add 'github:ayc299419-art/dsh-HSD-usage' 2>&1 | tail -6
fi

# 4) 名册登记（dsh.bundle.patch 若未自动应用则手动补上）
if ! grep -q 'hsd-usage' "$PROFILE_DIR/cordis.patch.yml"; then
  cat >> "$PROFILE_DIR/cordis.patch.yml" <<'ROSTER'

# dsh-HSD-usage（涵盛达API用量查询）
- insert:
    - id: hsd-usage
      name: 'dsh-HSD-usage'
ROSTER
  echo ">> 已登记名册 hsd-usage"
fi

# 5) 校验
echo ">> 更新后 rev: $(grep -oE 'rev=[a-z0-9]+' node_modules/dsh-HSD-usage/lib/client.js 2>/dev/null | head -1 || echo none)"
node -e "const p=require('$PROFILE_DIR/package.json'); console.log('  dep:', p.dependencies['dsh-HSD-usage'])"
grep -n 'hsd-usage' "$PROFILE_DIR/cordis.patch.yml" | head -2

# 6) 重启 web 服务（优雅重启：停止当前 3080/3082 进程后重启）
echo ">> 重启 DeepSeek Harness web 服务..."
PID=$(lsof -nP -iTCP:3080 -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -n "$PID" ]; then kill "$PID" 2>/dev/null && echo ">> 已停旧进程 $PID"; sleep 1; fi
nohup dsh web --port 3080 >"$PROFILE_HOME/web-restart.log" 2>&1 &
sleep 4
if curl -s -o /dev/null --max-time 5 http://127.0.0.1:3080/; then
  echo ">> 生产 3080 已重启并可用"
  curl -s http://127.0.0.1:3080/ | grep -oE '"id":"dsh-HSD-usage"[^}]*rev":"[a-z0-9]+"' | head -1
else
  echo ">> 3080 未就绪，请查看 $PROFILE_HOME/web-restart.log"
fi
echo ">> 完成。若仍在用桌面 App，请用它的重启按钮（进程级）以加载最新插件。"