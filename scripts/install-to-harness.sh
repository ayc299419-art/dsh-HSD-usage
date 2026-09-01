#!/usr/bin/env bash
# 把 dsh-HSD-usage 安装到 DeepSeek Harness 生产环境（默认 ~/.dsh/profiles/web）。
# 用法： bash scripts/install-to-harness.sh
# 说明：会写入 ~/.dsh（生产 profile）；安装前请确保你的 Clash 代理端口（默认 7897）可用。
set -euo pipefail

PLUGIN_REPO='github:ayc299419-art/dsh-HSD-usage'
PROXY_PORT="${DSH_HSD_PROXY:-7897}"
PROFILE_HOME="${DSH_PROD_HOME:-$HOME/.dsh}"
PROFILE_DIR="$PROFILE_HOME/profiles/web"

echo ">> 目标 profile: $PROFILE_DIR"

# 1) git 走本地代理（Clash Verge 7897），克隆 GitHub 用
export GIT_TERMINAL_PROMPT=0
git config --global http.proxy "http://127.0.0.1:${PROXY_PORT}" 2>/dev/null || true
git config --global https.proxy "http://127.0.0.1:${PROXY_PORT}" 2>/dev/null || true

# 2) 安装插件（dsh 会把 github 依赖加到 package.json，并按 dsh.bundle.patch 自动登记名册）
echo ">> 安装 $PLUGIN_REPO ..."
dsh plugin --profile web add "$PLUGIN_REPO" 2>&1 | tail -20

# 3) 若 pnpm 报 allowBuilds 拦截，放行本包后重试
if ! node -e "const p=require('$PROFILE_DIR/package.json'); process.exit('dsh-HSD-usage' in (p.dependencies||{})?0:1)" 2>/dev/null; then
  echo ">> pnpm 拦截 git 依赖构建，加入 allowBuilds 后重试..."
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
  dsh plugin --profile web add "$PLUGIN_REPO" 2>&1 | tail -20
fi

# 4) 校验
echo ">> 校验 package.json:"
node -e "const p=require('$PROFILE_DIR/package.json'); console.log('  dsh-HSD-usage in deps:', 'dsh-HSD-usage' in (p.dependencies||{}))"
echo ">> 校验名册:"
grep -n 'hsd-usage' "$PROFILE_DIR/cordis.patch.yml" || echo '  !! 名册未登记，请检查 dsh.bundle.patch'
echo
echo ">> 完成！请在 DeepSeek Harness 里重启，然后 设置 → HSD 用量监控 添加实例。"