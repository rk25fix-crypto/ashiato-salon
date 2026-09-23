# あしあとさろん 編集ツール 共通仕様(v2)

管理画面・Worker・テンプレートの3者が守る契約。ここに無いことは各担当が合理的に決めてよいが、ここに書いてあることからはズレないこと。

## 全体の考え方

- サイトの「編集できる中身」は `data/content.json` の2つの辞書だけ:
  - `texts`: 画面に表示されるテキスト全部(キー → 文字列)
  - `images`: 差し替え可能な写真(キー → リポジトリ内パス)
- `index.template.html` はレイアウト固定のテンプレート。中身は `worker/render.js` のプレースホルダで差し込む。
- **編集できるキー = content.json に既に存在するキー**。Worker もクライアントも、キーの一覧をハードコードしない。新しい項目を編集可能にしたい時は、テンプレートと content.json にキーを足すだけで、管理画面とWorkerは修正不要。
- 管理画面は本物のページをそのまま(プレビュー用HTMLとして)表示し、`data-k` / `data-img` が付いた部分をタップすると編集する。

## content.json

```json
{
  "texts": {
    "hero.kicker": "愛知県豊川市御津町の完全予約制サロン",
    "hero.heading.1": "大切な家族に、",
    "price.a.name": "A. スムースチワワ、…",
    "price.a.set": "¥3,400（¥3,740）",
    "license.operatorName": "中野 聖美"
  },
  "images": {
    "hero": "images/hero.jpg",
    "gallery-1": "images/gallery-1.jpg",
    "gallery-2": "images/gallery-2.jpg",
    "gallery-3": "images/gallery-3.jpg"
  }
}
```

### キーの命名規則(管理画面が見出しや注意書きの出し分けに使う)

- ドット区切り、`セクション.項目` 形式、英小文字・数字・ハイフン。一度決めたら変えない。
- `price.` で始まるキー = 料金表の値(管理画面は「料金を編集」として、税込を（ ）で書く例を表示する)。
- `license.` で始まるキー = 第一種動物取扱業の登録表示(法定表示)。管理画面は編集シートに必ず次の警告を出す:「保健所の登録証に記載の内容と一致させてください。内容が正しくないと、無許可営業とみなされる可能性があります。」
- それ以外 = 通常の文章。

## テンプレート(`index.template.html`)

プレースホルダは `worker/render.js` の通り:

| 書き方 | 用途 |
|---|---|
| `{{text:KEY}}` | 要素の中身のテキスト。改行は `<br>` になる |
| `{{price:KEY}}` | 料金セル(`<span class="v">本体<span class="tax">(税込)</span></span>`) |
| `{{plain:KEY}}` | 属性値(alt など)。注釈なし |
| `{{tel:KEY}}` | `href="tel:..."` 用。数字だけ取り出す |
| `{{img:KEY}}` | `<img data-img="KEY" src="{{img:KEY}}">` の形で使う。**`data-img` 属性は必ず付ける** |

- `{{text:}}` と `{{price:}}` は要素の中身の位置にだけ使う(属性の中や `<title>` の中では使わない。そこは `{{plain:}}`)。
- プレビュー時(`annotate: true`)、`{{text:}}` は `<span data-k="KEY">…</span>` に包まれ、`{{price:}}` の `.v` には `data-k` が付く。公開用 index.html には注釈は入らない。
- 同じキーをテンプレート内で複数回使ってよい(例: 電話番号の表示と `tel:` リンク)。

## Worker API

共通:
- レスポンスは `Content-Type: application/json`。
- CORS の `Access-Control-Allow-Origin` は `https://rk25fix-crypto.github.io` 固定。`OPTIONS` にも同じヘッダで200。
- 認証が必要なエンドポイントは `Authorization: Bearer <token>`。不正・期限切れは `401 {"error":"もう一度ログインしてください"}`。

### POST /login

Request `{ "password": string }`

- `Content-Length` が1KBを超えるリクエストは body を読まずに `400 { "error": "不正なリクエストです" }`
- 成功 `200 { "token": string, "expiresAt": number }`(HMAC署名、payloadに `exp`)
- 失敗 `401 { "error": "パスワードが違います" }`(判定前に1秒待つ)
- 直近1分に5回失敗 `429 { "error": "しばらくしてからもう一度お試しください" }`

### GET /content

- GitHub API から常に最新の `data/content.json` を取得して返す(Pages の反映待ちの影響を受けないため)。
- `200 { "content": {...content.json...}, "previewHtml": string }`
- `previewHtml` = テンプレートを `annotate: true` で描画し、`<head>` の直後(`<head>` が無ければ先頭)に `<base href="https://rk25fix-crypto.github.io/ashiato-salon/">` を入れたもの(`<!DOCTYPE>` より前に置くと quirks mode になるため)。`content.images` の画像は **最新コミットのSHAを使った raw URL**(`https://raw.githubusercontent.com/rk25fix-crypto/ashiato-salon/<commitSha>/images/hero.jpg`)にする(保存直後でも必ず新しい画像が出るように)。編集対象外の画像(ロゴ・QR)は相対パスのまま `<base>` で Pages から読む。
- **自己修復**: 同じコミットの content.json から作った公開用 index.html(POST /save の手順3と同じ作り方)と、そのコミットの `index.html` を比べ、違っていれば `index.html` をPUTし直す(保存が content.json まで書けて index.html で失敗した場合に、公開サイトだけ古いまま固定されるのを防ぐ)。PUT にはそのコミット時点の sha を使い再試行しない(保存が割り込んでいたら 409 で諦め、古い内容で上書きしない)。修復に失敗しても GET 自体は 200 を返す(ログのみ)。
- GitHub が 401(トークン失効など) `502 { "error": "更新に失敗しました。管理者に連絡してください" }`。管理画面を開いた時点でこの文言が出る。

### POST /save

どちらか一方:

```
{ "type": "texts", "values": { "<key>": "<value>", ... } }      // 1〜20キー、1回の保存=1回の公開
{ "type": "image", "key": "<images のキー>", "dataUrl": "data:image/jpeg;base64,..." }
```

検証(違反は `400`):
- texts: すべてのキーが現在の `content.texts` に存在すること(新規キーは作れない) → `{"error":"不正なリクエストです"}`。各値は2000文字以内 → `{"error":"文字数が多すぎます"}`。
- image: キーが現在の `content.images` に存在すること。先頭バイトが JPEG(`FF D8 FF`)であること。デコード後1MB以下(GitHub Contents API の既定メディアタイプの上限に合わせる) → 超過は `{"error":"写真のサイズが大きすぎます"}`。保存先パスは `content.images[key]` を使い、クライアントからパスは受け取らない。

処理(各PUTの直前にそのファイルのshaを取得、409/422は1回だけsha再取得して再PUT。単一ファイルの取得は `Accept: application/vnd.github.object+json` を使う。既定のメディアタイプでは1MB超のファイルが 403 `too_large` になり sha も取れないため。ディレクトリ一覧は既定のメディアタイプのまま):
1. (image のみ)画像ファイルをPUT
2. (texts のみ)`data/content.json` をPUT。image では content.json は変わらないので書かない
3. テンプレート + 新しい content.json から `index.html` を生成してPUT。編集可能な画像のsrcには `?v=<その画像ファイルのblob sha>` を付けて、訪問者のブラウザキャッシュを回避する。

応答:
- 成功 `200 { "ok": true, "message": "保存しました。ホームページには数分後に反映されます", "content": {...}, "previewHtml": string }`(previewHtml は GET /content と同じ作り方。管理画面はこれでプレビューを差し替える)
- GitHub が 401(トークン失効など) `502 { "error": "更新に失敗しました。管理者に連絡してください" }`
- その他 `500 { "error": "保存できませんでした。しばらくしてからもう一度お試しください" }`

## 管理画面の約束事

- 保存中はボタンを無効化(二重送信防止)。
- 画像は送信前に Canvas で縮小(hero 長辺1600px、それ以外1000px、JPEG品質0.82、`createImageBitmap(file, {imageOrientation:'from-image'})`)。縮小後に1MB(1024×1024バイト)を超えたら品質を0.7→0.6→0.5→0.4と下げて作り直す。読めない形式は「この写真は使えません。別の写真を選んでください」。
- エラー文言は Worker が返す `error` をそのまま表示する。
