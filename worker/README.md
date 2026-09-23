# あしあとさろん 管理用 Worker

スマホの管理画面(`admin/index.html`)から届いた編集内容を受け取り、
**パスワード確認**と **GitHub への保存(コミット)** だけを行う中継役です。
仕様は [API.md](./API.md) が唯一の正です。

- 保存するたびに、変更したファイル(文章なら `data/content.json` と `index.html`、写真なら写真ファイルと `index.html`)が **1回の保存につき1コミット** で GitHub の main ブランチに記録され、GitHub Pages が数分で公開します。
  (GitHub Pages のビルドは「1時間に10回程度」が目安なので、短時間に何十回も保存し続けると反映が遅れることがあります)
- 編集できる項目は `data/content.json` にあるキーそのものです。項目を増やす時は、テンプレートと content.json にキーを足すだけで Worker の修正は不要です(ただしテンプレートを変えたら再デプロイが必要。下の 8 を参照)。

以下のコマンドは **PowerShell** で、このリポジトリの `worker` フォルダに移動してから実行します。

```powershell
cd <リポジトリの場所>\ashiato-salon\worker
```

---

## 0. 最初の移行手順(開発者が行う。Worker を使い始める前に1回だけ)

いま公開されている `index.html` は画像を base64 で埋め込んだ旧版(約1.3MB)です。
Worker を使う前に、テンプレートから生成した新形式(約42KB、画像は `images/` を参照)に切り替えます。
**この手順は開発者側で行います**(オーナーさんの作業ではありません)。リポジトリ直下で:

1. 生成前の確認(旧版と見た目が同じになるか): `node worker/verify-migration.js` が「すべてのチェックに合格しました」になること
2. `index.html` を生成: `node worker/build-index.js`
   (画像の URL に `?v=<git の blob sha>` が付きます。Worker が保存時に作るものと同じ形式です)
3. もう一度 `node worker/verify-migration.js`(新形式として検証され、「8. index.html が build-index.js の出力と一致」も OK になること)
4. `index.html`, `index.template.html`, `data/`, `images/`, `admin/` をコミットして main に push
5. 数分後に公開サイト <https://rk25fix-crypto.github.io/ashiato-salon/> を開き、文章・料金表・写真・ロゴ・QR が
   以前と同じに表示されることを確認する(スマホでも)
6. 確認できてから、下の 1〜6 で Worker を用意して使い始める

テンプレートや content.json を手で直した時も、`node worker/build-index.js` → コミットで公開用 `index.html` を作り直せます。
(Worker 導入後は、管理画面を開いた時に Worker が自動で作り直すので、生成し忘れても直ります)

## 1. GitHub のトークン(Fine-grained Personal Access Token)を発行する

1. `rk25fix-crypto` アカウントで GitHub にログインし、<https://github.com/settings/personal-access-tokens/new> を開く
2. 次のように設定する
   - **Token name**: `ashiato-salon-worker`(何でもよい)
   - **Expiration**: `Custom` で **1年後**(推奨。無期限にはしない)
   - **Resource owner**: `rk25fix-crypto`
   - **Repository access**: `Only select repositories` → **`ashiato-salon` だけ**を選ぶ
   - **Permissions** → Repository permissions → **Contents: `Read and write`**(これ以外は触らない。`Metadata: Read-only` は自動で付くのでそのままでよい)
3. `Generate token` を押し、表示された `github_pat_...` をコピーしておく(**この画面を閉じると二度と表示されません**。5 で使います。メモ帳などに一時的に貼ったら、5 が終わったら消してください)

## 2. Cloudflare のアカウントを作る

<https://dash.cloudflare.com/sign-up> から無料プラン(Free)で作成します。クレジットカードは不要です。

## 3. wrangler(Cloudflare のコマンド)を入れてログインする

Node.js が入っている前提です(`node --version` で確認)。

```powershell
npm install -g wrangler
wrangler login
```

ブラウザが開くので、2 で作ったアカウントで「Allow」を押します。

## 4. デプロイする

```powershell
wrangler deploy
```

- 初回は workers.dev のサブドメイン名を聞かれることがあります。好きな名前(例: `ashiato`)を入れてください。
- 最後に `https://ashiato-salon-admin.<サブドメイン>.workers.dev` のような URL が表示されます。これが **Worker の URL** です(6 で使います)。
- テンプレート(リポジトリ直下の `index.template.html`)はこの時に Worker に同梱されます。リポジトリ全体がある状態で実行してください。

## 5. 秘密の値(シークレット)を3つ登録する

`wrangler secret put <名前>` を実行すると値の入力を求められるので、貼り付けて Enter します。

### ADMIN_PASSWORD(管理画面のパスワード)

**オーナーさんに決めてもらわず、こちらで長めの合言葉を発行して渡す**のをおすすめします
(短い・推測しやすいパスワードを防ぐため)。次のコマンドで `abcd-efgh-jkmn-pqrs` のような合言葉を作れます
(紛らわしい文字 `i l o 0 1` は除いてあります)。

```powershell
node -e "const c='abcdefghjkmnpqrstuvwxyz23456789';let s='';for(const b of require('crypto').randomBytes(16))s+=c[b%c.length];console.log(s.match(/.{4}/g).join('-'))"
```

```powershell
wrangler secret put ADMIN_PASSWORD
```

ログインは一度すると **30日間** 有効です(同じ端末ならその間は入力不要)。
1分間に5回まちがえると、しばらくログインできなくなります。

### GITHUB_TOKEN(1 で発行したトークン)

```powershell
wrangler secret put GITHUB_TOKEN
```

### SESSION_SECRET(ログイン状態の署名用。ランダムな長い文字列)

次のコマンドで作った値を登録します(人が覚える必要はありません)。

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

```powershell
wrangler secret put SESSION_SECRET
```

登録できたか確認:

```powershell
wrangler secret list
```

`ADMIN_PASSWORD` `GITHUB_TOKEN` `SESSION_SECRET` の3つが出れば OK です。シークレットは登録した時点で反映され、再デプロイは不要です。

## 6. Worker の URL を管理者(開発者)に伝える

4 で表示された URL を開発者に伝えてください。開発者が `admin/index.html` の `WORKER_URL` にその URL を設定して公開します。

動作確認(任意): 次のコマンドで `{"error":"もう一度ログインしてください"}` が返れば Worker は動いています。

```powershell
curl.exe https://ashiato-salon-admin.<サブドメイン>.workers.dev/content
```

---

## 7. トークンの期限切れ(約1年後)と、強制ログアウト

### GitHub トークンの更新

GitHub のトークンは発行から1年で失効します。失効すると、**管理画面を開いた時点で**
**「更新に失敗しました。管理者に連絡してください」** と表示され、編集できなくなります(公開サイトの表示自体は止まりません)。
その時(できれば期限前。GitHub から期限切れ前にメールが届きます)は:

1. <https://github.com/settings/personal-access-tokens> で該当トークンを開き `Regenerate token`(または 1 の手順で新規発行)
2. 新しい `github_pat_...` をコピーして、`worker` フォルダで:

   ```powershell
   wrangler secret put GITHUB_TOKEN
   ```

これだけで直ります(再デプロイ・再ログインは不要)。

### SESSION_SECRET を変えると全端末がログアウトされる

`SESSION_SECRET` を新しい値で `wrangler secret put SESSION_SECRET` し直すと、
**これまでに発行したログインがすべて無効**になり、全端末で再ログインが必要になります。
スマホを紛失した時など、強制的にログアウトさせたい時に使ってください。
パスワード(`ADMIN_PASSWORD`)を変えた時も、あわせて `SESSION_SECRET` を変えると確実です
(パスワードを変えただけでは、ログイン済みの端末は30日間ログインしたままです)。

### パスワードを忘れた / 変えたい

パスワードは Worker に登録したシークレットなので、後から見ることはできません。新しいものに置き換えます。
`worker` フォルダで:

1. 5 のコマンドで新しい合言葉を作る
2. `wrangler secret put ADMIN_PASSWORD` で新しい合言葉を登録する
3. `SESSION_SECRET` も 5 のコマンドで新しい値を作り、`wrangler secret put SESSION_SECRET` で登録する
   (これで全端末がログアウトされます。古いパスワードでログイン済みの端末を残さないため)
4. 新しい合言葉をオーナーさんに渡し、スマホで再ログインしてもらう

再デプロイは不要です。

## セキュリティ上の注意: このGitHubアカウントの Pages に他のサイトを置かない

管理画面のログイン情報(トークン)の保存場所と、Worker の CORS の許可は、
`https://rk25fix-crypto.github.io` という**オリジン単位**です(`/ashiato-salon/` というパス単位ではありません)。
そのため、**同じ `rk25fix-crypto` アカウントの GitHub Pages に他のサイト(別リポジトリ)を置くと、
そのサイトのスクリプトからもトークンが読め、Worker を呼んでホームページを書き換えられてしまいます**。

- このアカウントの GitHub Pages には、あしあとさろん以外のサイトを置かないこと
- どうしても置く必要が出たら、そのサイトは専用の別アカウントに置くか、
  あしあとさろん側をカスタムドメインに移して(CORS の許可オリジンもそのドメインに変えて)分けること

## 8. テンプレートを変えたら再デプロイが必要

`index.template.html` は `wrangler deploy` の時に Worker の中に同梱されます。
テンプレートを変更したら(content.json へのキー追加とセットで)、`worker` フォルダで

```powershell
wrangler deploy
```

を実行してください。再デプロイしないと、管理画面での保存時に古いテンプレートで `index.html` が作られ、
テンプレートの変更が消えてしまいます。**管理画面を開いただけでも**(自己修復の仕組みで)古いテンプレートの
`index.html` に戻されるので、テンプレートの変更を push したら間を空けずに再デプロイしてください。

> 順番の注意: テンプレートに新しいキー `{{text:xxx}}` を足した時は、**先に content.json にそのキーを足してから**再デプロイしてください。
> content.json に無いキーをテンプレートが参照していると、保存時に「保存できませんでした」になります(書き込みは行われないので壊れはしません)。

---

## 開発者向けメモ

- テスト: `node worker.test.mjs`(GitHub へは通信しません。fetch をモックしています)。`node render.test.js` は置換関数のテスト。`node verify-migration.js` はテンプレート・content.json・index.html の整合チェック。
- 公開用 `index.html` のローカル生成: `node build-index.js`(Worker の生成と同じ出力。0 を参照)
- 書き込みは GitHub の Git Data API(blob → tree → commit → ref 更新)で、1回の保存を1コミットにまとめています。途中で失敗しても main は動かない(中途半端な状態が公開されない)。別の保存と同時になった時は1回だけ自動でやり直します。
- 写真は1枚1MBまで(管理画面は縮小してから送るので通常は数百KB)。Cloudflare 無料プランの CPU 時間(1リクエスト10ms)に収めるため、Worker は写真の base64 をデコードせずにそのまま GitHub に渡します(先頭の JPEG 判定とサイズ計算だけ行う)。
- 管理画面を開くと(GET /content)、公開用 index.html が最新の content.json と食い違っていれば Worker が自動で作り直します(content.json やテンプレートを手で直した後の自己修復)。
- ビルド確認だけ: `wrangler deploy --dry-run --outdir <一時フォルダ>`
- ローカル実行: `wrangler dev --var SESSION_SECRET:s --var ADMIN_PASSWORD:pw --var GITHUB_TOKEN:<テスト用PAT>`(CORS は `https://rk25fix-crypto.github.io` 固定なので、ブラウザから叩く場合は注意)
- ログ確認: `wrangler tail`
- 構成: `src/index.js`(ルーティング) / `src/lib.js`(処理本体) / `render.js`(テンプレート置換、Node と共用の CommonJS。`type: module` は付けないこと) / `build-index.js`(ローカル生成)
