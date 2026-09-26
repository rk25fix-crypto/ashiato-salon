#!/bin/bash
# =============================================================
# 共通クラウド環境「dev」用セットアップスクリプト
# -------------------------------------------------------------
# 使い方: このファイルの中身を丸ごとコピーして、
#   クラウド環境の設定画面 >「セットアップスクリプト」欄に貼り付ける。
#
# ・rootで、Claude Codeが起動する前に1回だけ走る
# ・約5分以内に終わると結果がキャッシュされ、次のセッションからは
#   スキップされる(＝起動が速くなる)。約7日ごと・設定変更時に再実行。
# ・途中で失敗してもセッションが止まらないよう、全部 || true にしてある
# =============================================================

export DEBIAN_FRONTEND=noninteractive
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers

log() { echo "[dev-kit setup] $*"; }

# --- 1) wrangler をグローバルに入れておく(apt と並行で走らせて時短) ---
(
  npm install -g wrangler@latest --no-audit --no-fund >/dev/null 2>&1 \
    && log "wrangler: $(wrangler --version 2>/dev/null | head -1)" \
    || log "wrangler のインストールに失敗(各リポジトリの npx wrangler で代用可)"
) &
NPM_PID=$!

# --- 2) 日本語フォント(スクショで文字が□□□になるのを防ぐ) ---
(apt-get update -qq && apt-get install -y -qq fonts-noto-cjk fonts-noto-color-emoji >/dev/null) \
  && fc-cache -f >/dev/null 2>&1 \
  && log "日本語フォント: OK" \
  || log "日本語フォントのインストールに失敗"

# --- 3) Playwright + Chromium(Claudeが画面を開いてスクショ確認するため) ---
#     ※ apt を使うので、フォントの後に順番に実行する
#     ※ ダウンロード元(cdn.playwright.dev 等)をネットワーク許可に足しておくこと
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
timeout 180 npx -y playwright@latest install --with-deps chromium >/dev/null 2>&1 \
  && log "Playwright Chromium: OK" \
  || log "Playwright Chromium のインストールに失敗(許可ドメインを確認)"

wait "$NPM_PID" || true
log "完了"
exit 0
