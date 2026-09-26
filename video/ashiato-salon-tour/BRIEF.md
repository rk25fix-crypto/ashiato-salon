---
workflow: product-launch-video
flow: automation
storyboard: no
message: "あしあとさろんのサイトを、上から順にのぞいてみよう"
destination: instagram-reels
aspect: 1080x1920
language: ja
length: 30s
angle: site-tour
---

## Intent

「サイトの様子を動画にして」— あしあとさろん(愛知県豊川市御津町の完全予約制トリミングサロン)の公式サイトを、そのままの見た目で紹介するサイトツアー動画。Instagramリール用の縦長・約30秒。

## Customizations

- Show-it-as-is: feature the site's own captured screens as the video's assets; do not rebuild the site in HTML.
- What to show: whole site top to bottom (ヒーロー → あしあとさろんについて → サロンのようす → サービス → 料金表 → アクセス・予約 → LINE・Instagram).

## Notes

- 本番サイト(ashiato-salon.pages.dev)はこの環境から到達できないため、リポジトリの index.html をローカル配信してキャプチャする(PR #2 マージ後の内容と同一)。
- 途中確認なし・一気に完成まで(storyboard: no, flow: automation)。

## Customizations (round 2)

- BGM added: original gentle-acoustic score composed for this cut (F major, 120 BPM; melody enters at 3.5s, shaker from 9.5s, glockenspiel accents at 14.5s/20.5s, cadence at 25.5s). Source: music/compose.py → FluidR3_GM soundfont → loudnorm −16 LUFS. Placed as root `<audio id="el-bgm">` on track 11 with a volume automation fade-in 0–0.3s / fade-out 28.3–30s. NOTE: re-running assemble-index.mjs rewrites index.html — re-add the `el-bgm` element and re-vendor gsap afterwards.
