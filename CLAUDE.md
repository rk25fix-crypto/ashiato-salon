# CLAUDE.md

@.claude/dev-kit.md

## このアプリについて
<!-- アプリ名・目的・主要ディレクトリ・よく使うコマンド(npm run dev 等)をここに書く -->
- Worker は `worker/`(設定は `worker/wrangler.toml`、手順は `worker/README.md`)。
- **デプロイは手動の `wrangler deploy`**(PRマージでの自動デプロイではない)。クラウドセッションには Cloudflare のトークンが無いので、デプロイはユーザーが手元で実行する。
