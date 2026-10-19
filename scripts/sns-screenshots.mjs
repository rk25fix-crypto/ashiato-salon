// sns/index.html(SNS投稿をつくる)のスクリーンショットを撮る開発用スクリプト。
// Worker は呼ばず、Playwright で /login と /caption の応答を差し替える。
//   node scripts/sns-screenshots.mjs            → docs/sns-screenshots/*.png(375×812、2倍)
//   node scripts/sns-screenshots.mjs --check    → 合格ラインの自動チェックだけ(横スクロール・ボタンの高さ・文字サイズ)
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// playwright はグローバルに入っている前提(NODE_PATH)。ESM の import は NODE_PATH を見ないので require で読む
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'sns-screenshots');
const WORKER = 'https://ashiato-salon-admin.sync-app-2026.workers.dev';
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.js': 'text/javascript' };
const CAPTION = {
  caption: 'トイプードルのモカちゃん、今日はテディベアカットでふんわり仕上がりました🐶 お耳をまるく整えて、より優しい表情に。トリミング中もとってもおりこうさんで、スタッフみんなが癒されました。おうちでのブラッシングは毛の流れに沿ってやさしくがコツです。ご予約はプロフィールのリンクからどうぞ。',
  hashtags: '#あしあとさろん #トリミング #トリミングサロン #豊川市 #トイプードル #テディベアカット',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function newPage(browser, base, { loggedIn = true, captionStatus = 200 } = {}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP',
  });
  if (loggedIn) {
    await context.addInitScript(() => {
      localStorage.setItem('ashiatoAdminSession', JSON.stringify({ token: 'test.token', expiresAt: Date.now() + 86400000 }));
    });
  }
  await context.route(`${WORKER}/**`, async (route) => {
    const url = new URL(route.request().url());
    await new Promise((r) => setTimeout(r, 150));
    if (url.pathname === '/login') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'test.token', expiresAt: Date.now() + 86400000 }) });
    if (url.pathname === '/caption') {
      if (captionStatus === 200) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPTION) });
      if (captionStatus === 429) return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: '混み合っています。少し待ってから、もう一度お試しください' }) });
      return route.abort('failed'); // 通信エラー
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
  // Google Fonts はネットに出ない(なくても見た目の確認はできる)
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${base}/sns/`);
  return page;
}

// 合格ラインのうち、機械で確かめられるもの
async function audit(page, name) {
  const r = await page.evaluate(() => {
    const vis = (el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const small = [...document.querySelectorAll('button, a.btn, .chip span, label.pick')].filter(vis).filter((el) => el.getBoundingClientRect().height < 44).map((el) => el.textContent.trim().slice(0, 20) + ':' + Math.round(el.getBoundingClientRect().height));
    // 文字色と背景色のコントラスト(WCAG AA: 通常の文字 4.5:1 以上)。背景は一番近い「透明でない背景」の要素から取る
    const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; if (bg && !/rgba\(.*, 0\)$/.test(bg) && bg !== 'transparent') return bg; } return 'rgb(255,255,255)'; };
    const lowContrast = [...document.querySelectorAll('body *')].filter(vis).filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((el) => {
      const st = getComputedStyle(el); const l1 = lum(st.color), l2 = lum(bgOf(el)); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      return { t: el.textContent.trim().slice(0, 14), ratio: Math.round(ratio * 10) / 10 };
    }).filter((x) => x.ratio < 4.5);
    const fonts = [...document.querySelectorAll('body *')].filter(vis).filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((el) => parseFloat(getComputedStyle(el).fontSize)).filter((f) => f < 14);
    const jargon = ['API', '生成', 'キャプション', 'トークン', 'エラー', 'JSON', 'Worker'].filter((w) => document.body.innerText.includes(w));
    return { hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth, small, minFont: Math.min(...fonts, 99), jargon, lowContrast };
  });
  const ok = !r.hscroll && r.small.length === 0 && r.minFont >= 14 && r.jargon.length === 0 && r.lowContrast.length === 0;
  console.log(`${ok ? 'ok ' : 'NG '} ${name}: 横スクロール=${r.hscroll} 44px未満のボタン=${JSON.stringify(r.small)} 14px未満の文字=${r.minFont < 99 ? r.minFont : 'なし'} 専門用語=${JSON.stringify(r.jargon)} コントラスト不足=${JSON.stringify(r.lowContrast)}`);
  return ok;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  fs.mkdirSync(OUT, { recursive: true });
  const { server, base } = await serve();
  const browser = await chromium.launch();
  let allOk = true;
  const shot = async (page, name) => {
    allOk = (await audit(page, name)) && allOk;
    if (!checkOnly) await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  };
  try {
    // 0. ログイン画面
    let page = await newPage(browser, base, { loggedIn: false });
    await shot(page, '00-login');
    await page.context().close();

    // 1. 初期画面
    page = await newPage(browser, base);
    await page.waitForSelector('#app:not([hidden])');
    await shot(page, '01-initial');

    // 2. 写真を選んだあと
    await page.setInputFiles('#file', path.join(ROOT, 'images', 'gallery-1.jpg'));
    await page.waitForSelector('#preview.show');
    await page.fill('#memo', 'トイプードルのモカちゃん、テディベアカット');
    await shot(page, '02-photo-selected');

    // 3. 文章ができたあと
    await page.click('#make-btn');
    await page.waitForSelector('#result:not([hidden])');
    await page.waitForTimeout(400);
    await shot(page, '03-result');

    // 3b. つくっている最中(待ち表示)
    const busy = await newPage(browser, base);
    await busy.context().route(`${WORKER}/caption`, () => {}); // 応答しない
    await busy.fill('#memo', 'モカちゃん');
    await busy.click('#make-btn');
    await busy.waitForTimeout(300);
    const disabled = await busy.$eval('#make-btn', (b) => b.disabled);
    const label = await busy.$eval('#make-label', (b) => b.textContent);
    console.log(`${disabled && label.includes('つくっています') ? 'ok ' : 'NG '} 待ち表示: disabled=${disabled} label=${label}`);
    allOk = allOk && disabled;
    if (!checkOnly) await busy.screenshot({ path: path.join(OUT, '03b-making.png'), fullPage: true });
    await busy.context().close();

    // 4. 通信エラー
    page = await newPage(browser, base, { captionStatus: 0 });
    await page.fill('#memo', 'モカちゃん');
    await page.click('#make-btn');
    await page.waitForSelector('#make-error:not(:empty)');
    const err = await page.$eval('#make-error', (e) => e.textContent);
    console.log(`    エラー文: ${err}`);
    await shot(page, '04-error');
    await page.context().close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(allOk ? '\n自動チェック: すべて合格' : '\n自動チェック: 不合格あり');
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
