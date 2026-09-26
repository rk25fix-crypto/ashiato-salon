# 新しいお店のHPを立ち上げる手順書

あしあとさろん(1号案件)の仕組みを、2店舗目以降にそのまま使うための手順です。
「オーナーがスマホで文章と写真を直せる」「A4・1枚の使い方説明」まで含めて、同じ形で渡せるようにします。

- Worker の設定コマンドの細かい手順は [worker/README.md](../worker/README.md) の 1〜6 にあります。この手順書は全体の順番と、店ごとに書き換える場所をまとめたものです。
- 価格・見積もり・ヒアリングの中身は公開リポジトリに置かず、Obsidian の `wiki/entities/HP制作事業.md` で管理します(理由は「落とし穴」の 3)。

---

## 全体の流れ

| # | やること | 目安 |
|---|---|---|
| 1 | ヒアリングして素材を集める | 初回打ち合わせ |
| 2 | リポジトリを複製する | 10分 |
| 3 | ページを作る(テンプレートと中身) | 数日 |
| 4 | Cloudflare Pages で公開する | 15分 |
| 5 | 編集用 Worker を用意する | 30分 |
| 6 | 管理画面をつなぐ | 5分 |
| 7 | iPhone 実機で確認する | 30分 |
| 8 | 使い方説明を作る | 30分 |
| 9 | オーナーに渡す | 打ち合わせ |

---

## 1. ヒアリングして素材を集める

最初にまとめてもらうもの:

- 店名、ロゴ(なければ店名の文字で作る)
- メニューと料金、営業時間、定休日、住所・地図、駐車場、電話、予約方法
- Instagram などの SNS の URL
- 写真(外観・店内・作品やサービスの例)。スマホ写真でよい
- **オーナーが自分で直したい所**(料金・お知らせ・写真の入れ替えなど)。ここが編集できる項目になります
- 事例として紹介してよいか、紹介をお願いしてよいか

## 2. リポジトリを複製する

1. GitHub で新しいリポジトリを作る(例: `<店名>-site`)。**Public** にする(非公開にすると管理画面のプレビュー写真が出なくなるため。落とし穴 3)
2. このリポジトリの中身を丸ごとコピーして、新しいリポジトリに push する。
   ただし `.claude/`、`worker/.wrangler/`、`docs/owner-guide.pdf`、`docs/architecture*`、`images/` の中の写真はお店ごとに作り直すので持っていかない

## 3. 店ごとに書き換える場所

URL が決まる前に書き換えてよい所と、4〜5 で URL が決まってから書き換える所があります。

| ファイル | 場所 | 書き換える内容 | タイミング |
|---|---|---|---|
| `index.template.html` | ページ全体 | デザイン・構成・SNS の URL・`<title>`・`apple-touch-icon` | 3 |
| `data/content.json` | `texts` / `images` | 文章と写真のファイル名(オーナーが直せる項目 = ここにあるキー) | 3 |
| `images/` | — | 写真・ロゴ(JPEG) | 3 |
| `admin/index.html` | `<title>` と `brand-name` | 店名 | 3 |
| `admin/index.html` | `SESSION_KEY` | 店ごとに別の名前(例: `xxxAdminSession`) | 3 |
| `worker/wrangler.toml` | `name` | Worker の名前(例: `<店名>-admin`) | 5 の前 |
| `worker/src/lib.js` | `GITHUB_REPO` | 新しいリポジトリ名 | 5 の前 |
| `worker/src/lib.js` | `SITE_ORIGIN` | 4 で決まった `https://<プロジェクト名>.pages.dev` | 5 の前 |
| `worker/src/lib.js` | `User-Agent` | `<店名>-worker`(なくても動くが、ログで見分けるため) | 5 の前 |
| `worker/worker.test.mjs` | 先頭の `API` `RAW` `BASE_TAG` と CORS の期待値 | 上の2つに合わせる | 5 の前 |
| `admin/index.html` | `WORKER_URL` | 5 で表示された Worker の URL | 6 |
| `docs/owner-guide.html` | 店名・URL・QR・連絡先 | 8 を参照 | 8 |

書き換え漏れの確認(リポジトリ直下で):

```bash
grep -rn "ashiato\|あしあと" --include=*.html --include=*.js --include=*.mjs --include=*.json --include=*.toml . | grep -v .wrangler
```

何も出なければ OK です。

### テンプレートの作り方(要点)

- 編集させたい文章は `{{text:キー}}`、料金は `{{price:キー}}`、電話は `{{tel:キー}}`、写真は `{{img:キー}}` にして、同じキーを `data/content.json` に入れる
- キーを増やしても Worker のコードは直さなくてよい(Worker は content.json にあるキーをそのまま編集対象にする)
- 公開用の `index.html` は `node worker/build-index.js` で作る。`node worker/verify-migration.js` で整合を確認する
- 古い表示が残る対策(5分以上たって画面に戻ったら読み直すスクリプト)はテンプレートの末尾に入っているので、消さない

## 4. Cloudflare Pages で公開する

1. Cloudflare のダッシュボードで **「Workers & Pages」→「作成」→ Pages タブ →「Git に接続」** を選ぶ
   (Workers の作成画面から始めないこと。落とし穴 4)
2. 新しいリポジトリを選び、ビルドコマンドは空欄、出力ディレクトリも空欄(ルート)のまま保存
3. 表示された `https://<プロジェクト名>.pages.dev` を開いて、ページが出ることを確認する
4. この URL を `worker/src/lib.js` の `SITE_ORIGIN` に書く

## 5. 編集用 Worker を用意する

[worker/README.md](../worker/README.md) の 1〜5 のとおり。店ごとに変わる所だけ:

- GitHub トークンは **店ごとに新しく発行** し、Repository access で **その店のリポジトリだけ** を選ぶ
- `ADMIN_PASSWORD`(オーナーに渡す合言葉)と `SESSION_SECRET` も店ごとに新しく作る。使い回さない
- `cd worker` → `node worker.test.mjs` が全部通ってから `wrangler deploy`

## 6. 管理画面をつなぐ

1. 5 で表示された Worker の URL を `admin/index.html` の `WORKER_URL` に書く
2. commit して push → 数分で `https://<プロジェクト名>.pages.dev/admin/` に反映される

## 7. iPhone 実機で確認する

PC のブラウザだけで済ませないこと(落とし穴 1)。iPhone の Safari で次をすべて確認します。

- [ ] `/admin/` で合言葉を入れてログインできる
- [ ] 点線で囲まれた文章をタップ → 直して保存 → 数分後に公開ページに反映される
- [ ] 写真をタップ → カメラロールから選んで保存 → 反映される
- [ ] 暗い色のボタンの上でも点線の枠が見える
- [ ] 公開ページを「ホーム画面に追加」して開き、編集後に開き直すと新しい内容になる
- [ ] 公開ページの電話番号をタップすると電話がかけられる

## 8. 使い方説明を作る

`docs/owner-guide.html` を書き換えて、A4・1枚の PDF にします。

1. 書き換える所
   - `<title>` と「〇〇 オーナーさま用」の店名
   - 管理画面の URL(`https://<プロジェクト名>.pages.dev/admin/`)
   - QR コード画像(`<div class="qr">` の中の `data:image/png;base64,...`)
   - 連絡先(「LINE：けんじ」。有償の客は LINE公式アカウントにする)
2. QR コードを作る(Python の `qrcode` を使う場合):

   ```bash
   python -c "import qrcode,base64,io;b=io.BytesIO();qrcode.make('https://<プロジェクト名>.pages.dev/admin/').save(b,'PNG');print(base64.b64encode(b.getvalue()).decode())"
   ```

   出てきた文字列を `data:image/png;base64,` の後ろに貼る。**スマホで読み取って管理画面が開くことを必ず確認する**
3. PDF にする: Chrome で開いて印刷 →「PDF に保存」、用紙 A4、余白なし、ヘッダーとフッターはオフ。
   1枚に収まっていることを確認して `docs/owner-guide.pdf` として保存する

## 9. オーナーに渡す

- 使い方説明(PDF か印刷)と合言葉を渡す。**合言葉は紙か対面で。LINE などに残さない**
- その場でオーナー自身のスマホでログインしてもらい、文章を1か所直してもらう(ログインは30日間保たれる)
- 事例掲載の了解、ひと言の感想、Instagram などで公開されたときのスクショをもらう(次の営業の材料)

---

## 落とし穴(1号案件で実際に踏んだもの)

1. **iPhone だけ動かないことがある。** 管理画面の iframe に `sandbox` を付けると、iPhone の Safari では点線をタップしても反応しなくなる。今は sandbox を外し、CSP の meta タグで中のスクリプトを止めている。この部分は変えない。PC のブラウザでの確認だけでは見つからない
2. **テンプレートを変えたら、push の後すぐ `wrangler deploy`。** テンプレートは Worker の中に同梱されているので、再デプロイしないと、オーナーが保存したときや管理画面を開いたときに古いテンプレートで上書きされる(worker/README.md の 8)
3. **Cloudflare Pages はリポジトリの全ファイルを公開する。** 価格・見積もり・メモなどを置かない。リポジトリを非公開にしてもサイトからは見えるうえ、管理画面のプレビュー写真(raw.githubusercontent.com から読んでいる)が出なくなる
4. **Cloudflare の画面は Pages から。** Workers の作成画面から始めると Git 連携の画面にたどり着けない
5. **オーナーが編集していると push が拒否される。** オーナーの保存も main へのコミットになるので、自分が push する前に `git pull --rebase --autostash` で取り込む
6. **ホーム画面から開いたページは古い内容のまま残る。** テンプレート末尾の読み直しスクリプトで対策済み。消さない
7. **Cloudflare Pages の無料プランは月500ビルドまで。** オーナーの保存1回 = 1ビルド。1店舗ならまず超えないが、同じアカウントで店が増えたら合計に注意する
