#!/bin/bash
# =============================================================
# claude-dev-kit 共通 SessionStart フック
# (クラウドセッションの開始・再開のたびに自動実行)
# -------------------------------------------------------------
# やること:
#   1. 依存パッケージのインストール(足りないときだけ)
#      ※ リポジトリ独自の .claude/hooks/session-start.sh があれば、依存はそちらに任せる
#   2. .dev.vars.example → .dev.vars のコピー(開発用のダミー値)
#   3. D1 マイグレーションを「ローカル」に適用(本番には触らない)
# ここで echo した内容は Claude が読むので、短い状況報告だけ出す。
# 手元PCでは何もしない(CLAUDE_CODE_REMOTE が true のときだけ動く)。
# =============================================================

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

report() { echo "[dev-kit] $*"; }

# リポジトリ独自のフックが依存インストールを担当しているか
OWN_HOOK=0
[ -f .claude/hooks/session-start.sh ] && OWN_HOOK=1

# --- 1) 依存パッケージ ---
install_deps() {
  local dir="$1"
  [ -f "$dir/package.json" ] || return 0
  if (cd "$dir" && npm ls --depth=0 >/dev/null 2>&1); then
    return 0
  fi
  if [ -f "$dir/pnpm-lock.yaml" ]; then
    (cd "$dir" && pnpm install --frozen-lockfile >/dev/null 2>&1)
  elif [ -f "$dir/yarn.lock" ]; then
    (cd "$dir" && yarn install --frozen-lockfile >/dev/null 2>&1)
  elif [ -f "$dir/package-lock.json" ]; then
    (cd "$dir" && npm ci --no-audit --no-fund --loglevel=error >/dev/null 2>&1)
  else
    (cd "$dir" && npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1)
  fi && report "依存関係: $dir をインストールしました" \
     || report "依存関係: $dir のインストールに失敗(手動で確認して)"
}

if [ "$OWN_HOOK" = 0 ]; then
  install_deps "."
fi

# wrangler 設定ファイルがある場所(ルート+3階層まで)を探す
WRANGLER_DIRS=$(find . -maxdepth 3 \( -name node_modules -o -name .git \) -prune -o \
  \( -name 'wrangler.toml' -o -name 'wrangler.json' -o -name 'wrangler.jsonc' \) -print 2>/dev/null \
  | grep -v '/dist/' | xargs -r -n1 dirname | sort -u)

# 独自フックが並行で npm ci している場合に備えて、少し待つ
wait_for_node_modules() {
  local dir="$1" i=0
  [ -f "$dir/package.json" ] || return 0
  while [ $i -lt 60 ] && ! (cd "$dir" && npm ls --depth=0 >/dev/null 2>&1); do
    sleep 2; i=$((i+1))
  done
}

for dir in $WRANGLER_DIRS; do
  if [ "$dir" != "." ] && [ "$OWN_HOOK" = 0 ]; then install_deps "$dir"; fi

  # --- 2) .dev.vars ---
  if [ -f "$dir/.dev.vars.example" ] && [ ! -f "$dir/.dev.vars" ]; then
    cp "$dir/.dev.vars.example" "$dir/.dev.vars"
    report ".dev.vars: $dir に .dev.vars.example からコピーしました"
  fi

  # --- 3) D1 マイグレーション(ローカルのみ) ---
  CONFIG=$(ls "$dir"/wrangler.jsonc "$dir"/wrangler.json "$dir"/wrangler.toml 2>/dev/null | head -1)
  DB_NAMES=$(grep -v '^[[:space:]]*//' "$CONFIG" 2>/dev/null \
    | grep -oE "\"?database_name\"?[[:space:]]*[:=][[:space:]]*[\"'][^\"']+[\"']" \
    | sed -E "s/.*[\"']([^\"']+)[\"'][[:space:]]*$/\1/" | awk '!seen[$0]++')
  [ -n "$DB_NAMES" ] || continue

  wait_for_node_modules "$dir"
  if [ -x "$dir/node_modules/.bin/wrangler" ]; then WR="$(cd "$dir" && pwd)/node_modules/.bin/wrangler"
  elif command -v wrangler >/dev/null 2>&1; then WR="wrangler"
  else report "D1(ローカル): wrangler が見つからないのでスキップ"; continue; fi

  for db in $DB_NAMES; do
    if (cd "$dir" && CI=1 timeout 120 "$WR" d1 migrations apply "$db" --local >/dev/null 2>&1); then
      report "D1(ローカル): $dir の $db にマイグレーション適用済み"
    fi
  done
done

exit 0
