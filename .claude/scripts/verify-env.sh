#!/bin/bash
# クラウドセッションの中で「環境がちゃんと整っているか」を確認するスクリプト。
# セッション内で Claude に「dev-kit の verify.sh を実行して」と頼めばOK。

ok()  { echo "✅ $*"; }
ng()  { echo "❌ $*"; }

echo "== dev 環境チェック =="

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && ok "クラウドセッション上で実行中" || ng "クラウドセッションではない(手元で実行中?)"

if [ "$(date +%Z)" = "JST" ]; then ok "タイムゾーン: JST ($(date '+%Y-%m-%d %H:%M'))"; else ng "タイムゾーンが $(date +%Z)。環境変数に TZ=Asia/Tokyo を追加"; fi

if fc-list 2>/dev/null | grep -qi "Noto Sans CJK"; then ok "日本語フォントあり"; else ng "日本語フォントなし(セットアップスクリプトを確認)"; fi

if command -v wrangler >/dev/null 2>&1; then ok "wrangler: $(wrangler --version 2>/dev/null | head -1)"; else ng "wrangler がグローバルにない(npx wrangler で代用可)"; fi

PW_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
if ls "$PW_PATH" 2>/dev/null | grep -q chromium; then ok "Playwright Chromium あり ($PW_PATH)"; else ng "Playwright Chromium なし(許可ドメインとセットアップスクリプトを確認)"; fi

if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then echo "⚠️  CLOUDFLARE_API_TOKEN が環境変数に入っている(本番操作できる状態。意図通りか確認)"; else ok "Cloudflare トークンなし(本番は触れない安全な状態)"; fi
