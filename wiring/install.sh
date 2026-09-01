#!/usr/bin/env bash
# 把 deepseek-usage-monitor 接入 DSH web profile（备份 + 写入 + 软链），重启后生效。
set -euo pipefail
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/web}"
TS="$(date +%Y%m%d%H%M%S)"

echo ">> 目标 profile: $PROFILE"
test -d "$PROFILE" || { echo "profile 不存在: $PROFILE"; exit 1; }

# 1) 备份
cp "$PROFILE/package.json" "$PROFILE/package.json.bak-$TS"
cp "$PROFILE/cordis.patch.yml" "$PROFILE/cordis.patch.yml.bak-$TS"
echo ">> 已备份（*.bak-$TS）"

# 2) 添加依赖（幂等）
if ! grep -q '"deepseek-usage-monitor"' "$PROFILE/package.json"; then
  node - "$PROFILE/package.json" "$PLUGIN_DIR" <<'EOF'
const fs=require('fs');
const [f,dir]=process.argv.slice(2);
const j=JSON.parse(fs.readFileSync(f,'utf8'));
j.dependencies=j.dependencies||{};
j.dependencies['deepseek-usage-monitor']='file:'+dir;
fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n');
EOF
  echo ">> 已在 package.json 加入依赖"
fi

# 3) 浏览器插件名册登记（幂等）
if ! grep -q 'usage-monitor' "$PROFILE/cordis.patch.yml"; then
  cat >> "$PROFILE/cordis.patch.yml" <<'EOF'

# --- deepseek-usage-monitor（用量监控插件）---
- insert:
    - id: usage-monitor
      name: 'deepseek-usage-monitor'
EOF
  echo ">> 已在 cordis.patch.yml 登记 usage-monitor"
fi

# 4) 确保 node_modules 可解析（软链，避免完整 pnpm 解析）
mkdir -p "$PROFILE/node_modules"
if [ ! -e "$PROFILE/node_modules/deepseek-usage-monitor" ]; then
  ln -s "$PLUGIN_DIR" "$PROFILE/node_modules/deepseek-usage-monitor"
  echo ">> 已软链 node_modules/deepseek-usage-monitor"
fi

# 5) 校验可解析
node -e "const p=require.resolve('deepseek-usage-monitor',{paths:['"$PROFILE"']}); console.log('>> 可解析:', p)" || echo "!! 解析失败，请检查软链"

echo ""
echo "完成。重启 DeepSeekHarness（GUI 或 dsh web --port 3080）后生效。"
echo "卸载：bash "$(dirname "$0")"/uninstall.sh"
