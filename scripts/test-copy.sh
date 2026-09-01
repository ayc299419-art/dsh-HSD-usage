#!/usr/bin/env bash
# 创建并启动一个隔离的 DSH 测试副本，用于插件稳定性与冲突测试（不影响生产实例 ~/.dsh:3080）。
#
# 默认行为：完全克隆生产插件环境——整个 web profile（含全部已装插件与 node_modules）、
# 插件名册 cordis.patch.yml、settings.yaml、.credentials.yaml——再叠加被测插件，
# 以便验证"插件可用性"之外还能验证"与生产环境其他插件是否互相冲突"。
#
# 用法：
#   bash scripts/test-copy.sh                 # 克隆生产环境 + 被测插件，端口 3090
#   bash scripts/test-copy.sh --reset         # 删除并重建测试 home（重新克隆）
#   bash scripts/test-copy.sh --stop          # 停止测试实例
#   bash scripts/test-copy.sh --port 3095     # 换端口
#   bash scripts/test-copy.sh --plugin <dir>  # 指定要测试的插件目录（默认本插件）
#   bash scripts/test-copy.sh --fresh         # 不克隆生产环境，用全新最小 profile（旧行为）
#   bash scripts/test-copy.sh --no-credentials # 克隆时不带 .credentials.yaml（默认带）
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DSH_BIN="$(command -v dsh || echo /usr/local/bin/dsh)"
TEST_HOME="${DSH_TEST_HOME:-$HOME/.dsh-test}"
PORT=3090
RESET=0
STOP=0
FRESH=0
NO_CRED=0
PROD_HOME="${DSH_PROD_HOME:-$HOME/.dsh}"
PROD_PROFILE="$PROD_HOME/profiles/web"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2;;
    --reset) RESET=1; shift;;
    --stop) STOP=1; shift;;
    --fresh) FRESH=1; shift;;
    --no-credentials) NO_CRED=1; shift;;
    --copy-settings) shift;;
    --plugin) PLUGIN_DIR="$(cd "$2" && pwd)"; shift 2;;
    *) echo "未知参数: $1"; exit 1;;
  esac
done

stop_by_port() {
  local port="$1" pid
  pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)"
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null && echo ">> 已停止测试实例 (pid $pid, 端口 $port)" || true;
  else echo ">> 端口 $port 无监听进程（未运行）"; fi
}

if [[ "$STOP" == "1" ]]; then stop_by_port "$PORT"; exit 0; fi

if [[ "$RESET" == "1" && -d "$TEST_HOME" ]]; then rm -rf "$TEST_HOME"; echo ">> 已重置 $TEST_HOME"; fi

export DSH_HOME="$TEST_HOME"
mkdir -p "$TEST_HOME"
echo ">> 测试 home: $TEST_HOME"

# 1) 准备 web profile
if [[ "$FRESH" != "1" && -d "$PROD_PROFILE" ]]; then
  if [[ ! -f "$TEST_HOME/profiles/web/package.json" ]]; then
    echo ">> 克隆生产插件环境: $PROD_PROFILE -> $TEST_HOME/profiles/web"
    mkdir -p "$TEST_HOME/profiles"
    cp -Rc "$PROD_PROFILE" "$TEST_HOME/profiles/web" 2>/dev/null || cp -R "$PROD_PROFILE" "$TEST_HOME/profiles/web"
    echo ">> 已复制全部插件与 node_modules（含 cordis.patch.yml 名册）"
  else
    echo ">> 测试 profile 已存在（跳过克隆；--reset 可强制重新克隆）"
  fi
  if [[ -f "$PROD_HOME/settings.yaml" ]]; then
    cp "$PROD_HOME/settings.yaml" "$TEST_HOME/settings.yaml"
    echo ">> 已复制 settings.yaml"
  fi
  if [[ "$NO_CRED" != "1" && -f "$PROD_HOME/.credentials.yaml" ]]; then
    cp "$PROD_HOME/.credentials.yaml" "$TEST_HOME/.credentials.yaml"
    echo ">> 已复制 .credentials.yaml（--no-credentials 可跳过）"
  fi
else
  if [[ ! -f "$TEST_HOME/profiles/web/package.json" ]]; then
    "$DSH_BIN" --profile web --help >/dev/null 2>&1 || true
    echo ">> 已初始化全新 web profile（模板 bundles: dsh-base + dsh-web-app）"
  fi
  if [[ -f "$PROD_HOME/settings.yaml" ]]; then
    cp "$PROD_HOME/settings.yaml" "$TEST_HOME/settings.yaml"
    echo ">> 已复制 settings.yaml"
  fi
fi

# 2) 安装被测插件（纯软链 + 手写 package.json 依赖，完全离线、不动克隆好的环境）
PLUGIN_NAME="$(node -e "console.log(require('$PLUGIN_DIR/package.json').name)")"
cd "$TEST_HOME/profiles/web"
if [[ ! -e "node_modules/$PLUGIN_NAME" ]]; then
  mkdir -p node_modules && ln -sfn "$PLUGIN_DIR" "node_modules/$PLUGIN_NAME"
fi
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.dependencies = p.dependencies || {};
p.dependencies['$PLUGIN_NAME'] = 'file:$PLUGIN_DIR';
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"
echo ">> 插件就绪: node_modules/$PLUGIN_NAME -> $PLUGIN_DIR"

# 3) 插件名册登记（幂等；克隆模式下名册已含生产全部插件，仅追加被测插件）
if ! grep -q "'$PLUGIN_NAME'" cordis.patch.yml; then
  sed -i '' '/^[[:space:]]*\[\][[:space:]]*$/d' cordis.patch.yml 2>/dev/null || true
  cat >> cordis.patch.yml <<ROSTER_EOF

# $PLUGIN_NAME（稳定性/冲突测试）
- insert:
    - id: usage-monitor
      name: '$PLUGIN_NAME'
ROSTER_EOF
  echo ">> 已在 cordis.patch.yml 登记 usage-monitor"
fi

# 4) 启动隔离实例（独立端口，与生产 3080 互不干扰）
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "!! 端口 $PORT 已被占用，请换 --port 或用 --stop 先停旧的"; exit 1
fi
echo ">> 启动: $DSH_BIN --profile web --port $PORT --no-open"
nohup "$DSH_BIN" --profile web --port "$PORT" --no-open >"$TEST_HOME/test-web.log" 2>&1 &
echo ">> pid=$!  日志=$TEST_HOME/test-web.log"

# 5) 等待就绪并验证：被测插件 + 生产全部插件都在 boot manifest（冲突测试）
ok=0
for i in $(seq 1 60); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then ok=1; break; fi
  sleep 0.5
done
if [[ "$ok" != "1" ]]; then
  echo "!! 启动失败，日志: $TEST_HOME/test-web.log"
  tail -30 "$TEST_HOME/test-web.log"
  exit 1
fi
echo ">> 就绪: http://127.0.0.1:$PORT"
BOOT="$(curl -s "http://127.0.0.1:$PORT/")"
if echo "$BOOT" | grep -q "\"id\":\"$PLUGIN_NAME\""; then
  echo ">> 验证通过：$PLUGIN_NAME 已在 boot manifest 中"
else
  echo "!! $PLUGIN_NAME 未出现在 boot manifest，查看日志: $TEST_HOME/test-web.log"
fi
if [[ "$FRESH" != "1" ]]; then
  missing=0
  # 只校验 client 类插件（有 dsh.client 声明）；纯 Node 侧插件本就不进浏览器 manifest
  for dep in $(node -e "
const fs = require('fs'), path = require('path');
const p = require('$PROD_PROFILE/package.json');
const out = [];
for (const name of Object.keys(p.dependencies || {})) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join('$PROD_PROFILE', 'node_modules', name, 'package.json'), 'utf8'));
    if (d.dsh && d.dsh.client) out.push(name);
  } catch (e) {}
}
console.log(out.join(' '));
" 2>/dev/null); do
    if echo "$BOOT" | grep -q "\"id\":\"$dep\""; then
      echo "   OK 生产插件在位: $dep"
    else
      echo "   !! 生产插件缺失: $dep"
      missing=1
    fi
  done
  if [[ "$missing" == "0" ]]; then
    echo ">> 冲突测试环境完整：生产全部插件 + 被测插件同时在线"
  fi
fi
echo ">> 停止: bash "$(dirname "$0")"/test-copy.sh --stop --port "$PORT""
exit 0
