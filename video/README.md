# 動画

## ashiato-salon-tour/ — サイト紹介リール(9:16・30秒・BGM付き)

公式サイトをスマホ画面でスクロールしながら紹介する Instagram リール用の動画です。
[HyperFrames](https://hyperframes.heygen.com)(HTMLで動画を作るツール)のプロジェクトで、
`index.html` と `compositions/frames/` の6シーンから MP4 を書き出します。

| ファイル | 中身 |
|---|---|
| `index.html` | 全体の構成(6シーンの並び・切り替え・BGMトラック) |
| `compositions/frames/01〜06-*.html` | 各シーン(タイトル / トップ / ギャラリー / サービス・料金 / 予約 / 締め) |
| `assets/` | サイトの全体スクショ(スマホ幅)、写真、ロゴ、QR、フォント、GSAP、BGM |
| `BRIEF.md` `STORYBOARD.md` `frame.md` | 依頼内容・シーン構成・デザイン設定 |
| `music/compose.py` | BGM(オリジナル曲)の楽譜を作るスクリプト |

### 書き出し方

Node.js と FFmpeg が入っている環境で:

```bash
cd video/ashiato-salon-tour
npx hyperframes check                              # 構成チェック
npx hyperframes render --output renders/reel.mp4   # 書き出し(約1分)
```

`renders/` はリポジトリに入れていません(書き出すたびに作られるため)。

### BGM を作り直すとき

`music/compose.py` は楽譜(MIDI)を作り、FluidSynth で音にしてから音量をそろえます:

```bash
cd video/ashiato-salon-tour/music
python3 compose.py                                  # → bgm.mid(要 mido)
fluidsynth -ni -g 0.7 -r 44100 -F bgm-raw.wav /usr/share/sounds/sf2/FluidR3_GM.sf2 bgm.mid
ffmpeg -i bgm-raw.wav -af "atrim=0:30,highpass=f=40,loudnorm=I=-16:TP=-1.5:LRA=11" ../assets/audio/bgm.wav
```

曲の雰囲気を変えたい・別の動画に曲をつけたいときは、「インスタリール仕上げ」スキル
(insta-reel-finisher)を使うと、作曲から合成・カバー画像・投稿文まで一度にできます。

### 注意

- シーンの見出し(y 104〜260px)と予約シーンの営業時間・電話番号チップ(y 100〜160px)が、
  リール画面上部の表示(「リール」の文字・カメラアイコン)に少し重なる位置にあります。
  直すなら各シーンの見出しを 60〜80px ほど下げてから書き出してください。
- GSAP とフォントは `assets/` に同梱しています(ネットにつながらない環境でも書き出せるように)。
