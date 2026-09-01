#!/usr/bin/env bash
# 卸载 deepseek-usage-monitor：移除依赖行、名册登记、软链。
set -euo pipefail
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/web}"

echo ">> 目标 profile: $PROFILE"
test -d "$PROFILE" || { echo "profile 不存在: $PROFILE"; exit 1; }

# 移除依赖行（保留备份）
node - "$PROFILE/package.json" <<'EOF'
const fs=require('fs');
const f=process.argv[2];
const j=JSON.parse(fs.readFileSync(f,'utf8'));
delete j.dependencies['deepseek-usage-monitor'];
fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n');
EOF

# 移除名册登记（把本文件内我们追加的块删掉）
node - "$PROFILE/cordis.patch.yml" <<'EOF'
const fs=require('fs');
const f=process.argv[2];
let s=fs.readFileSync(f,'utf8');
s=s.replace(/\n?# --- deepseek-usage-monitor[\s\S]*?name: 'deepseek-usage-monitor'[\s\S]*?\n(?=\n?$)/,'\n');
fs.writeFileSync(f,s);
EOF

# 移除软链
rm -f "$PROFILE/node_modules/deepseek-usage-monitor"

echo "完成。重启 DeepSeekHarness 后插件移除。可用备份 cordis.patch.yml.bak-* / package.json.bak-* 恢复。"
