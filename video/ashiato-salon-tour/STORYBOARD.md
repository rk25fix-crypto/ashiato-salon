---
format: 1080x1920
duration: 30s
message: "あしあとさろんのサイトを、上から順にのぞいてみよう"
arc: Title → Top → Gallery → Service & Price → Reserve → End card
audience: 豊川市周辺で犬を飼っている方(Instagramリールで見る)
mode: autonomous
music: none
---

## Video direction

- **Silent piece.** No narration, no BGM, no SFX (`music: none` + no SCRIPT.md). The on-screen headline above the phone is the "voice": every reveal is paced to the on-screen headline cues listed per frame, never front-loaded.
- **Palette (frame.md):** ground = cream `#FBF1F0`; paper cards = cream-2 `#FFFDFA`; deep rose `green #A8506A` = the brand accent (chips, rules, the soft blob behind the phone); `green-deep #8A3D56` for pressed/deep states; ink `#4A3A3F` for text; light rose `pink #F3D9DF` for text on deep rose. No other hues except those inside the real screenshots/photos.
- **Type (frame.md):** headlines = display ramp (Noto Serif JP 600 — Mincho like the site); small section labels = `label` (JetBrains Mono, uppercase, tracked — echoes the site's own "ABOUT US / PRICE MENU" eyebrows); body lines = Noto Sans JP.
- **The persistent hero is ONE phone** (frames 2–5): a rounded device frame (ink `#4A3A3F` bezel, ~36px corner radius on the screen) whose screen is a 720×1280 window at x=180, y=300 on the 1080×1920 canvas, showing `assets/mobile-full-1080.png` scaled to 720px wide (scale 2/3; a 1280px-tall screen shows 1920 plate px). The phone never moves between frames 2–5 — only the plate scrolls inside it (translateY), so the four frames read as one continuous scroll. Scroll offsets below are in **plate px** (screen px = plate px × 2/3).
- **Headline zone:** y 96–270 above the phone; one `label` eyebrow + one display headline (max 2 short lines). Headlines swap in place (old slides up + fades, new slides up + in) → `discrete-text-sequence`.
- **Motion grammar:** long-tail eases (power3.out for entrances, power2.inOut for scrolls). Scrolls glide then **hold** on each section so the viewer can read it (≥1.0s hold). No bouncy springs except one gentle settle on the title logo. No camera drift on held reads.
- **Held beats:** frame 1's final second and frame 6's last 1.5s are deliberate still reads.
- **Negative list:** no invented UI, no browser chrome, no cursor, no bokeh/gradient "AI" backgrounds, no fake logos, no rebuilt copy of the site (the screenshot is the source of truth). Avoid both failure modes: slideshow (everything dumped at t=0 then frozen) and screensaver (things floating independently). Keep content in the top ~83% (y < 1600).

## Frame 1 — Title

- scene: ロゴと店名が静かに現れる、サイトツアーの入口
- voiceover: ""
- duration: 3.5s
- poster: 2.8s
- transition_in: cut
- status: animated
- src: compositions/frames/01-title.html
- type: hook
- persuasion: Curiosity invitation (a quiet "come take a look" instead of a hard sell — fits a gentle neighborhood salon)
- beat: curiosity + warmth
- blueprint: titlecard-reveal (Adapt)
- asset_candidates: assets/logo.jpg — the salon brand logo tile
- focal: assets/logo.jpg
- roles: logo.jpg = cutout (hero, centered, rounded-square tile)

narrativeRole: opens on the brand so the viewer knows whose site this is before the tour starts.
keyMessage: あしあとさろん — 豊川市御津町の完全予約制トリミングサロン.

Adapt: keep the single restrained reveal + still hold; the "card" is the logo tile + name stack instead of a text line.
Scene 1 (0.0–0.9s): cream ground. The logo tile (≈300px rounded square, subtle 1px line `#EDDADE` ring) fades in and settles from 94%→100% scale at canvas center-upper (centered on y≈700) → `gsap-effects`.
Scene 2 (0.9–1.8s): below the logo, the name 「あしあとさろん」 (display-hero size, ink) slides up + fades in; then the eyebrow `TRIMMING SALON` (label, deep rose) above the name → `discrete-text-sequence`.
Scene 3 (1.8–2.6s): a 2px deep-rose hairline draws left→right under the name, and the sub line 「愛知県豊川市御津町の完全予約制トリミングサロン」 (body, ink) fades up → `svg-path-draw` for the rule.
Scene 4 (2.6–3.5s): a small pill 「公式サイトをのぞいてみよう ↓」 (deep-rose fill, pink text) fades in near y≈1350, its arrow nudges down once; everything else holds still.

## Frame 2 — Top page

- scene: スマホの画面にサイトのトップ。見出しとお店の外観
- voiceover: ""
- duration: 6s
- poster: 2.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/02-top.html
- type: product_intro
- persuasion: Show-don't-tell proof (the real site on a real phone screen)
- beat: clarity + trust
- blueprint: device-surface-showcase (Adapt — static-tour)
- asset_candidates: assets/mobile-full-1080.png — full mobile screenshot plate of the site
- focal: assets/mobile-full-1080.png
- roles: mobile-full-1080.png = the phone screen content (scrolls inside the screen window)
- handoff_out: phone — screen window x=180 y=300 w=720 h=1280, scale 1, opacity 1, static; plate translateY = −2971 plate px (= −1980.67 screen px), not moving at the cut; headline zone shows eyebrow `ABOUT` + 「トリマー歴20年の安心」.

Adapt (static-tour): keep the device settling in + element-level scroll + side-headline swap; the side headline sits ABOVE the phone (9:16), camera static.
Scene 1 (0.0–1.0s): a soft deep-rose blob (≈820px circle, 12% opacity) scales up behind the phone area; the phone slides up from y+160 and settles (power3.out) with the plate at offset 0 (site header + hero headline 「大切な家族に、やさしく丁寧なトリミングを。」 visible on screen) → `3d-page-scroll` (flat, no tilt) + `gsap-effects`.
Scene 2 (1.0–2.4s): headline zone reveals eyebrow `TOP` + 「サイトはこんな感じ」; hold the top of the site ~1.2s so the hero copy reads.
Scene 3 (2.4–3.6s): plate glides to offset 1100 (the storefront photo with round windows fills the screen); headline swaps to 「まるい窓が目印のお店」 → `discrete-text-sequence`.
Scene 4 (3.6–5.0s): plate glides to 2971 (ABOUT section: 「小さなあしあとを、大切に受けとめる場所。」 + the 「トリマー歴20年、大手サロン店長歴9年」 box); headline swaps to eyebrow `ABOUT` + 「トリマー歴20年の安心」.
Scene 5 (5.0–6.0s): hold still (handoff state).

## Frame 3 — Salon gallery

- scene: サロンのようす。写真がスマホから浮かび上がる
- voiceover: ""
- duration: 5s
- poster: 3.4s
- transition_in: cut
- status: animated
- src: compositions/frames/03-gallery.html
- type: key_feature
- persuasion: Show-don't-tell proof (real photos of a trimmed guest, the entrance, the tools)
- beat: warmth + trust
- blueprint: device-surface-showcase (Adapt — page-scroll-spotlight lift)
- asset_candidates: assets/mobile-full-1080.png — full mobile screenshot plate; assets/gallery-1.jpg — trimmed white dog with bow tie; assets/gallery-2.jpg — entrance with WELCOME mat; assets/gallery-3.jpg — pink grooming scissors
- focal: assets/gallery-1.jpg
- roles: mobile-full-1080.png = phone screen content; gallery-1.jpg = cutout (lifted hero card); gallery-2.jpg = supporting; gallery-3.jpg = supporting
- handoff_in: phone — screen window x=180 y=300 w=720 h=1280, scale 1, opacity 1, static; plate translateY = −2971 plate px at t=0; headline zone at t=0 shows eyebrow `ABOUT` + 「トリマー歴20年の安心」.
- handoff_out: phone — same window, scale 1, opacity 1, static; plate translateY = −5588 plate px (gallery heading 「はじめましての一歩を、安心できる場所から。」 at the top of the screen); the three photo cards have exited (opacity 0) by the cut; headline shows eyebrow `GALLERY` + 「サロンのようす」.

Adapt: keep the page-scroll to the section + ONE element lifting off the surface; the lift is a fan of three real photo cards instead of one DOM element.
Scene 1 (0.0–1.2s): plate glides from 2971 to 5588 (gallery heading at the top of the screen, first photo row visible); headline swaps to eyebrow `GALLERY` + 「サロンのようす」.
Scene 2 (1.2–3.0s): the phone dims slightly (screen overlay ink 25%) and three photo cards (paper-white 12px border, 10px radius, soft shadow) rise out of the screen area and fan out over the lower half of the phone, staggered left→right: gallery-2 (tilt −6°), gallery-1 (center, largest ≈440px wide, tilt 0°, in front), gallery-3 (tilt +6°); each with a tiny label chip under it: 「その子らしい表情に」(gallery-1), 「お迎えする入口」(gallery-2), 「丁寧な施術のために」(gallery-3) → `spring-pop-entrance` (low overshoot) + `css-3d-transforms`.
Scene 3 (3.0–4.2s): hold the fan still so the photos read.
Scene 4 (4.2–5.0s): the cards sink back into the screen (scale down + fade), the dim lifts → handoff state.

## Frame 4 — Service & price

- scene: サービス紹介と犬種別の料金表をスクロール
- voiceover: ""
- duration: 6s
- poster: 3.8s
- transition_in: cut
- status: animated
- src: compositions/frames/04-service-price.html
- type: key_feature
- persuasion: Friction reduction (prices are posted up front, by breed)
- beat: clarity + ease
- blueprint: device-surface-showcase (Adapt — static-tour)
- asset_candidates: assets/mobile-full-1080.png — full mobile screenshot plate
- focal: assets/mobile-full-1080.png
- roles: mobile-full-1080.png = phone screen content
- handoff_in: phone — screen window x=180 y=300 w=720 h=1280, scale 1, opacity 1, static; plate translateY = −5588 plate px at t=0; headline at t=0 shows eyebrow `GALLERY` + 「サロンのようす」.
- handoff_out: phone — same window, scale 1, opacity 1, static; plate translateY = −13200 plate px; headline shows eyebrow `PRICE` + 「犬種別の料金表つき」.

Scene 1 (0.0–1.6s): plate glides 5588 → 7552 (deep-rose SERVICE section: シャンプー / カット / お手入れ / その他メニュー); headline swaps to eyebrow `SERVICE` + 「シャンプー・カット・お手入れ」.
Scene 2 (1.6–2.6s): hold on SERVICE. A small paper chip pops beside the headline: 「手洗いにこだわり」 (from the site's shampoo copy 「当店は手で洗うことにこだわっています」) → `spring-pop-entrance` (low overshoot).
Scene 3 (2.6–4.4s): plate glides 7552 → 11000 (PRICE MENU heading + the start of the 犬種別 料金表); headline swaps to eyebrow `PRICE` + 「犬種別の料金表つき」; the chip fades out.
Scene 4 (4.4–5.4s): plate continues slowly 11000 → 13200 through the price rows (トイプードル etc.) — a gentle read-speed scroll, not a whip.
Scene 5 (5.4–6.0s): hold (handoff state).

## Frame 5 — Reserve & access

- scene: 予約・営業時間・電話番号、LINEとInstagramのQR
- voiceover: ""
- duration: 5s
- poster: 2.2s
- transition_in: cut
- status: animated
- src: compositions/frames/05-reserve.html
- type: cta_setup
- persuasion: Friction reduction (hours, phone, LINE, Instagram all in one place)
- beat: ease + control
- blueprint: device-surface-showcase (Adapt — static-tour)
- asset_candidates: assets/mobile-full-1080.png — full mobile screenshot plate
- focal: assets/mobile-full-1080.png
- roles: mobile-full-1080.png = phone screen content
- handoff_in: phone — screen window x=180 y=300 w=720 h=1280, scale 1, opacity 1, static; plate translateY = −13200 plate px at t=0; headline at t=0 shows eyebrow `PRICE` + 「犬種別の料金表つき」.

Scene 1 (0.0–1.4s): plate glides 13200 → 17244 (ご予約・お問い合わせ: 営業時間 9:00–19:00 card and the 営業日 row); headline swaps to eyebrow `RESERVATION` + 「完全予約制です」.
Scene 2 (1.4–2.6s): hold; a paper chip pops beside the headline: 「営業 月・火・金・土 9:00–19:00」 → `spring-pop-entrance` (low overshoot).
Scene 3 (2.6–4.0s): plate glides 17244 → 20758 (LINE・Instagram QR section — the two QR cards visible); headline swaps to eyebrow `ONLINE` + 「LINE・Instagramからも」; the chip swaps to 「070-1678-1525」 with a small phone glyph drawn as inline SVG before the number (no emoji).
Scene 4 (4.0–5.0s): the phone slides down and fades (power2.in) — the device exits before the end card.

## Frame 6 — End card

- scene: ロゴ・Instagramアカウント・「完全予約制」で締める
- voiceover: ""
- duration: 4.5s
- poster: 3.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/06-end.html
- type: cta
- persuasion: Friction reduction (one clear next step: follow / message on Instagram or LINE)
- beat: peace of mind + motivation
- blueprint: titlecard-reveal (Adapt — card chain end card)
- asset_candidates: assets/logo.jpg — the salon brand logo tile; assets/instagram-qr.png — QR to the Instagram account
- focal: assets/logo.jpg
- roles: logo.jpg = cutout (brand lockup); instagram-qr.png = supporting (small QR card)

Adapt: keep the calm end-card register and the logo held to the last frame; one restrained move per element.
Scene 1 (0.0–1.0s): cream ground; the logo tile (≈240px) fades in and settles at y≈520; 「あしあとさろん」 (headline-xl, ink) slides up beneath it.
Scene 2 (1.0–2.2s): a deep-rose card (≈820px wide, radius 8px) rises in below: label `INSTAGRAM` (pink) + handle 「@ashiato.salon」 (display, cream-2) + a small paper-white QR tile (instagram-qr.png, ≈220px) on its right side.
Scene 3 (2.2–3.0s): under the card, 「LINE・お電話でもご予約いただけます」 (body, ink) and 「完全予約制」 pill (deep-rose outline) fade up.
Scene 4 (3.0–4.5s): everything holds still to the last frame.
