# claude-dev-kit

Claude Code の**クラウドセッション**で、どのアプリでも同じ感覚で開発するための共通キット。

例えるなら、**ホテルの会員登録(クラウド環境)** と **各プロジェクトに持っていく共通スーツケース(template)** のセット。

```
claude-dev-kit/             ← GitHubの「テンプレートリポジトリ」。ルートがそのままアプリの雛形
├── CLAUDE.md               アプリ固有メモ(共通ルールを @ で読み込む)
├── .gitignore              .dev.vars などを除外
├── .claude/
│       ├── dev-kit.md      共通ルール(Cloudflare前提・禁止事項・ゲーミフィケーション方針)
│       ├── settings.json   SessionStartフック+本番操作の禁止ルール
│       ├── hooks/dev-kit-session-start.sh   依存インストール・.dev.vars・D1ローカル適用
│       └── scripts/verify-env.sh    環境チェック
└── dev-kit/
    ├── README.md           このファイル
    ├── apply.sh            既存アプリに適用・更新するスクリプト
    └── cloud-environment/  クラウド環境の設定画面に貼るもの(最初に1回だけ)
        ├── setup.sh            セットアップスクリプト欄
        ├── env.txt             環境変数欄
        └── allowed-domains.txt ネットワーク「カスタム」の許可ドメイン欄
```

---

## 1. クラウド環境「dev」を作る(最初に1回だけ)

Claude Code Desktop の Code タブ → 環境の選択 →「クラウド環境を追加」(または claude.ai/code から)。

| 項目 | 入れるもの |
| --- | --- |
| 名前 | `dev` |
| ネットワークアクセス | **カスタム** →「一般的なパッケージマネージャーのデフォルトリストも含める」に**チェック**→ 許可ドメインに `allowed-domains.txt` の中身 |
| 環境変数 | `env.txt` の中身 |
| セットアップスクリプト | `setup.sh` の中身 |

- **トークンは入れない。** 本番反映は GitHub の PR マージ → Cloudflare の自動デプロイで行うので、クラウド環境に Cloudflare の鍵は不要。
- 本番ログを見たい等で必要になったら、**読み取り専用に絞ったトークン**を「API認証情報」側に足す。
- セットアップスクリプトは5分以内に終わればキャッシュされ、2回目以降のセッションはすぐ起動する(約7日ごと・設定変更時に再実行)。

### ルーティン用の環境「routine」(参考)
外部フィードを読む定期実行用。**トークンは絶対に入れない**、ネットワークは「カスタム」で読む先のドメインだけ(デフォルトリストのチェックも外す)、環境変数は `TZ=Asia/Tokyo` のみ。

---

## 2. アプリのリポジトリに入れる

### 新しいアプリ → テンプレートから作る(おすすめ)
GitHub で New repository →「Repository template」で **claude-dev-kit** を選ぶ。最初から全部入った状態で始まる。
作ったら `CLAUDE.md` の「このアプリについて」を埋めるだけ。

### 既存アプリ → apply.sh で適用

手元PCで:

```bash
git clone https://github.com/<you>/claude-dev-kit.git
bash claude-dev-kit/dev-kit/apply.sh ../sync      # アプリのリポジトリのパス
cd ../sync && git diff                              # 確認してコミット → push
```

またはクラウドセッションで Claude に「claude-dev-kit を このリポジトリに適用して」と頼む。

- 何度実行しても安全。dev-kit を更新したら同じコマンドで各アプリに反映できる。
- 既存の `CLAUDE.md` / `.claude/settings.json` は消さずにマージする。
- 適用後、`CLAUDE.md` の「このアプリについて」を埋める。
- Cloudflare の開発用ダミー値は `.dev.vars.example` に置いておくと、セッション開始時に `.dev.vars` が自動で作られる。

---

## 3. 毎回のセッションで自動で起きること

1. (初回のみ)セットアップスクリプト: 日本語フォント・wrangler・Playwright Chromium
2. SessionStart フック(毎回):
   - `node_modules` が無ければ依存をインストール(npm / pnpm / yarn を自動判別)
   - `.dev.vars.example` → `.dev.vars`
   - `wrangler.*` の `database_name` を見つけて、D1 マイグレーションを**ローカルに**適用
3. Claude が `CLAUDE.md` と共通ルールを読んで作業開始

手元PCではフックは何もしない(`CLAUDE_CODE_REMOTE` が `true` のときだけ動く)。

## 4. 本番に触る操作(`settings.json`)

- **毎回確認が出る(ask)**: `wrangler deploy` / `wrangler versions deploy` / `wrangler delete` / `wrangler secret` / `wrangler d1 ... --remote` / `npm run deploy` / main・master への push
- **禁止(deny)**: force push

手動デプロイのアプリ(例: ashiato-salon)でも止まらないよう、デプロイ系は禁止ではなく確認にしている。

## 5. スキルについて

- アプリ専用のスキル → そのリポジトリの `.claude/skills/` に置く
- 全アプリ共通のスキル → **claude.ai で有効にしたスキルはクラウドセッションに自動で読み込まれる**ので、そちらで管理する
- ※ リポジトリの `settings.json` に書いたプラグイン(`enabledPlugins`)はクラウドセッションではインストールされない

## 6. 困ったら

クラウドセッションで Claude に「`bash .claude/scripts/verify-env.sh` を実行して」と頼むと、タイムゾーン・フォント・Playwright・トークンの有無をチェックできる。
