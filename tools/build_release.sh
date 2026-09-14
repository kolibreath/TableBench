#!/usr/bin/env bash
# build_release.sh — 插件发版一键脚本（语法检查 → 打包 7z → 归档核对）
#
# 用法：
#   bash tools/build_release.sh                       # 日常发版：拉取远端 + 插件包
#   bash tools/build_release.sh --no-pull             # 跳过 git pull（离线/本地调试）
#   bash tools/build_release.sh --with-backend        # 完整包（插件+后端源码+安装脚本）
#   bash tools/build_release.sh --with-backend --with-wheels   # 首次发布完整包
#
# 前置依赖：node（语法检查，缺失时降级为警告）、7z CLI 或 py7zr（打包脚本自处理）。

set -euo pipefail

# ── 定位 ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"          # filechecker-extension/
ROOT_DIR="$(dirname "$EXT_DIR")"            # 2026S3/（产物输出目录）
BRANCH="feature/v3.2"

PULL=1
PASS_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --with-backend|--with-wheels) PASS_ARGS+=("$arg") ;;
    *) echo "未知参数：$arg"; exit 1 ;;
  esac
done

cd "$EXT_DIR"

echo "════════════════════════════════════════"
echo " 插件发版打包  $(date '+%F %T')"
echo "════════════════════════════════════════"

# ── 步骤 1：同步远端 ──
if [ "$PULL" -eq 1 ]; then
  echo "[1/4] 同步远端 $BRANCH …"
  git fetch origin "$BRANCH" --quiet
  LOCAL="$(git rev-parse HEAD)"
  REMOTE="$(git rev-parse "origin/$BRANCH")"
  if [ "$LOCAL" != "$REMOTE" ]; then
    # 本地未推送的提交与远端新提交并存时，ff-only 会拒绝——绝不自动合并发版
    git pull --ff-only origin "$BRANCH" --quiet
    echo "      已快进到 $(git rev-parse --short HEAD)"
  else
    echo "      已是最新 $(git rev-parse --short HEAD)"
  fi
else
  echo "[1/4] 跳过 git pull（--no-pull）"
fi

# 未提交改动提醒（不阻断：collect_data 等本地产物常态存在）
DIRTY="$(git status --porcelain | grep -v 'collect_data' || true)"
if [ -n "$DIRTY" ]; then
  echo "      ⚠ 有未提交改动（不入包，仅提醒）："
  echo "$DIRTY" | sed 's/^/        /'
fi

# ── 步骤 2：语法检查 ──
echo "[2/4] JS 语法检查 …"
if ! command -v node >/dev/null 2>&1; then
  echo "      ⚠ 未找到 node，跳过语法检查（建议安装：brew install node）"
else
  FAIL=0
  # manifest 引用的脚本 + 发版关键脚本，全部过一遍 node --check
  MAPFILE_JS=$(python3 - <<'PY'
import json
m = json.load(open('manifest.json', encoding='utf-8'))
js = set(m.get('background', {}).get('service_worker', '').split())
for cs in m.get('content_scripts', []):
    js.update(cs.get('js', []))
for a in m.get('action', {}).get('default_popup', '').split():
    pass
print('\n'.join(sorted(js)))
PY
)
  CHECK_LIST="$MAPFILE_JS
popup.js
history.js
workbench.js
workbench.mock.js
workbench.html"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in *.html) continue ;; esac
    [ -f "$f" ] || { echo "      ✗ manifest 引用的文件缺失：$f"; FAIL=1; continue; }
    node --check "$f" 2>/tmp/build_release_check || { echo "      ✗ 语法错误：$f"; cat /tmp/build_release_check; FAIL=1; }
  done <<< "$CHECK_LIST"
  # 非 manifest 直引的页面级脚本（动态注入/扩展页加载）
  for f in estimation.js estimation.render.js estimation.ita-search.js estimation.mock.js \
           collect-sync.js tracker-watch.js tools/backend/check_docs.py; do
    if [[ "$f" == *.py ]]; then
      python3 -m py_compile "$f" 2>/dev/null || { echo "      ✗ 语法错误：$f"; FAIL=1; }
    elif [ -f "$f" ]; then
      node --check "$f" 2>/dev/null || { echo "      ✗ 语法错误：$f"; FAIL=1; }
    fi
  done
  [ "$FAIL" -eq 1 ] && { echo "      语法检查未通过，终止打包。"; exit 1; }
  echo "      全部通过"
fi

# ── 步骤 3：打包（透传 --with-backend / --with-wheels） ──
echo "[3/4] 打包 7z …"
python3 "$SCRIPT_DIR/package_extension.py" "${PASS_ARGS[@]+"${PASS_ARGS[@]}"}"

# ── 步骤 4：归档核对 ──
echo "[4/4] 归档核对 …"
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json',encoding='utf-8'))['version'])")
ARCHIVE="$ROOT_DIR/项目管理工具_v${VERSION}_插件.7z"
[ -f "$ARCHIVE" ] || { echo "      ✗ 未找到产物：$ARCHIVE"; exit 1; }

MUST_HAVE=("manifest.json" "content.js" "tracker-watch.js" "collect-sync.js" "background.js"
           "workbench.js" "estimation.js" "mock-data/tracker-mock-data.js")
MISSING=0
for f in "${MUST_HAVE[@]}"; do
  7z l -p1234 "$ARCHIVE" 2>/dev/null | grep -q " $f\$" || { echo "      ✗ 包内缺失：$f"; MISSING=1; }
done
[ "$MISSING" -eq 1 ] && exit 1

COUNT=$(7z l -p1234 "$ARCHIVE" 2>/dev/null | grep -cE "\.(js|json|html|css|py|bat|md)$" || true)
SIZE=$(du -h "$ARCHIVE" | cut -f1 | tr -d ' ')
echo "      ✓ 关键文件齐全；代码/配置文件 $COUNT 个；归档 $SIZE"
echo ""
echo "✅ 发版包就绪：$ARCHIVE"
echo "   部署要点：解压（密码 1234）→ chrome://extensions 刷新扩展"
echo "   （本版本含新增权限 downloads/alarms/notifications，刷新后如提示已停用需手动启用）→ 刷新 ITA 页面重新注入悬浮球"
