#!/bin/bash
# =============================================================
# claude-dev-kit のテンプレートをアプリのリポジトリに適用する
# -------------------------------------------------------------
# 使い方:  bash dev-kit/apply.sh <アプリのリポジトリのパス>
#   例)   bash dev-kit/apply.sh ../sync
#
# ※ 新しいアプリは GitHub で「claude-dev-kit をテンプレートにして作成」すれば
#   最初から入っているので、このスクリプトは既存アプリ用。
#
# 何度実行しても安全(冪等)。更新したいときも同じコマンドでOK。
#   - dev-kit が管理するファイル(dev-kit.md / hooks / scripts)は上書き
#   - CLAUDE.md は既存を残し、先頭に @.claude/dev-kit.md の読み込みだけ足す
#   - settings.json は既存を残し、フックと確認・禁止ルールだけマージ
#   - .gitignore に .dev.vars を追加
# 実行後は git diff で確認してコミットする。
# =============================================================
set -euo pipefail

KIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TPL="$KIT_DIR"   # リポジトリのルートがそのままテンプレート
TARGET="${1:-}"

if [ -z "$TARGET" ] || [ ! -d "$TARGET" ]; then
  echo "使い方: bash dev-kit/apply.sh <アプリのリポジトリのパス>" >&2
  exit 1
fi
TARGET="$(cd "$TARGET" && pwd)"
[ -d "$TARGET/.git" ] || echo "⚠️  $TARGET は git リポジトリのルートではなさそう(続行します)"

mkdir -p "$TARGET/.claude/hooks" "$TARGET/.claude/scripts"

# 1) dev-kit 管理ファイル(上書き)
cp "$TPL/.claude/dev-kit.md"               "$TARGET/.claude/dev-kit.md"
cp "$TPL/.claude/hooks/dev-kit-session-start.sh"   "$TARGET/.claude/hooks/dev-kit-session-start.sh"
cp "$TPL/.claude/scripts/verify-env.sh"    "$TARGET/.claude/scripts/verify-env.sh"
chmod +x "$TARGET/.claude/hooks/dev-kit-session-start.sh" "$TARGET/.claude/scripts/verify-env.sh"
echo "✅ .claude/dev-kit.md, hooks, scripts を配置"
if [ "$TARGET" != "$KIT_DIR" ]; then rm -rf "$TARGET/dev-kit" && cp -R "$KIT_DIR/dev-kit" "$TARGET/dev-kit"; echo "✅ dev-kit/ フォルダを配置"; fi

# 2) CLAUDE.md
if [ ! -f "$TARGET/CLAUDE.md" ]; then
  cp "$TPL/CLAUDE.md" "$TARGET/CLAUDE.md"
  echo "✅ CLAUDE.md を新規作成(「このアプリについて」を埋めてね)"
elif ! grep -q "@.claude/dev-kit.md" "$TARGET/CLAUDE.md"; then
  { printf '@.claude/dev-kit.md\n\n'; cat "$TARGET/CLAUDE.md"; } > "$TARGET/CLAUDE.md.tmp"
  mv "$TARGET/CLAUDE.md.tmp" "$TARGET/CLAUDE.md"
  echo "✅ 既存の CLAUDE.md の先頭に共通ルールの読み込みを追加"
else
  echo "ℹ️  CLAUDE.md は適用済み"
fi

# 3) settings.json(マージ)
node - "$TPL/.claude/settings.json" "$TARGET/.claude/settings.json" <<'NODE'
const fs = require('fs');
const [tplPath, dstPath] = process.argv.slice(2);
const tpl = JSON.parse(fs.readFileSync(tplPath, 'utf8'));
let dst = {};
if (fs.existsSync(dstPath)) {
  try { dst = JSON.parse(fs.readFileSync(dstPath, 'utf8')); }
  catch (e) { console.error('❌ 既存の settings.json が JSON として読めない: ' + e.message); process.exit(1); }
}
dst.$schema ??= tpl.$schema;

// フック: 同じ command が無ければ追加
dst.hooks ??= {};
for (const [event, groups] of Object.entries(tpl.hooks)) {
  dst.hooks[event] ??= [];
  const existing = new Set(dst.hooks[event].flatMap(g => (g.hooks || []).map(h => h.command)));
  for (const g of groups) {
    if (!g.hooks.every(h => existing.has(h.command))) dst.hooks[event].push(g);
  }
}

// 確認(ask)・禁止(deny)ルール: 和集合
dst.permissions ??= {};
for (const key of ['ask', 'deny']) {
  if (!tpl.permissions[key]) continue;
  dst.permissions[key] = [...new Set([...(dst.permissions[key] || []), ...tpl.permissions[key]])];
}

fs.writeFileSync(dstPath, JSON.stringify(dst, null, 2) + '\n');
console.log('✅ .claude/settings.json にフックと確認・禁止ルールをマージ');
NODE

# 4) .gitignore
touch "$TARGET/.gitignore"
if ! grep -qxF ".dev.vars" "$TARGET/.gitignore"; then
  printf '\n# Cloudflare 開発用シークレット(claude-dev-kit)\n.dev.vars\n' >> "$TARGET/.gitignore"
  echo "✅ .gitignore に .dev.vars を追加"
fi

echo ""
echo "完了!  cd \"$TARGET\" && git diff  で確認してコミットしてね。"
