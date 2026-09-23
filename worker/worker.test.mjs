// Worker本体の自己テスト(API v2)。フレームワーク無し、実行:
//   node worker/worker.test.mjs
// 本物のGitHubは使わず、fetch を小さな偽GitHub(メモリ内)に差し替えて検証する。
// テンプレート/content.json は作業中の実ファイルに依存しないよう、ここで自作したフィクスチャを使う。

import assert from 'node:assert';
import {
  handleLogin, handleGetContent, handleSave, createToken, verifyToken, passwordMatches,
  loginAttempts, RATE_LIMIT_MAX, renderPublic,
} from './src/lib.js';
import { buildIndex, gitBlobSha } from './build-index.js';

const ENV = { ADMIN_PASSWORD: 'correct-horse-battery', GITHUB_TOKEN: 'gh-token', SESSION_SECRET: 'session-secret' };
const API = 'https://api.github.com/repos/rk25fix-crypto/ashiato-salon';
const RAW = 'https://raw.githubusercontent.com/rk25fix-crypto/ashiato-salon';
const BASE_TAG = '<base href="https://rk25fix-crypto.github.io/ashiato-salon/">';

const TEMPLATE =
  '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>{{plain:site.title}}</title></head><body>' +
  '<h1>{{text:hero.heading}}</h1>' +
  '<table><tr><td>{{price:price.a.set}}</td></tr></table>' +
  '<img data-img="hero" src="{{img:hero}}" alt="{{plain:site.title}}">' +
  '<img data-img="gallery-1" src="{{img:gallery-1}}">' +
  '<img src="images/logo.png">' +
  '</body></html>';

const CONTENT = {
  texts: { 'site.title': 'テストサロン', 'hero.heading': '大切な家族に', 'price.a.set': '¥3,400（¥3,740）' },
  images: { hero: 'images/hero.jpg', 'gallery-1': 'images/gallery-1.jpg' },
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const dataUrl = (buf) => 'data:image/jpeg;base64,' + buf.toString('base64');

const MB = 1024 * 1024;
const OBJECT_MEDIA = 'application/vnd.github.object+json';
const INITIAL_SHAS = { 'images/hero.jpg': 'hero-sha-0', 'images/gallery-1.jpg': 'g1-sha-0' };
// CONTENT と画像の状態に一致した公開用 index.html(整合している状態)
const CONSISTENT_INDEX = renderPublic(TEMPLATE, CONTENT, INITIAL_SHAS);

// ---- 偽GitHub ----
// failPut: { '<path>': [status, ...] } を渡すと、そのパスへのPUTが順にそのステータスで失敗する。
// failGet: 同様にGETを失敗させる。
// bodies: { '<path>': Buffer } で初期ファイルの中身を差し替える(sha はそのまま)。
// 本物と同じく、1MB超のファイルは既定のメディアタイプで GET すると 403 too_large、
// object メディアタイプなら sha だけ返す(content は空、encoding "none")。
function fakeGithub({ failPut = {}, failGet = {}, bodies = {} } = {}) {
  let n = 0;
  const sha = (p) => `${p}-sha-${++n}`;
  const files = {
    'data/content.json': { sha: 'content-sha-0', body: Buffer.from(JSON.stringify(CONTENT, null, 2)) },
    'images/hero.jpg': { sha: 'hero-sha-0', body: Buffer.from('old') },
    'images/gallery-1.jpg': { sha: 'g1-sha-0', body: Buffer.from('old') },
    'images/logo.png': { sha: 'logo-sha-0', body: Buffer.from('logo') },
    'index.html': { sha: 'index-sha-0', body: Buffer.from(CONSISTENT_INDEX) },
  };
  for (const [p, body] of Object.entries(bodies)) files[p].body = body;
  const gh = { files, head: 'commit-0', calls: [] };
  const res = (status, body) => new Response(JSON.stringify(body), { status });

  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    assert.ok(url.startsWith(API), 'GitHub API 以外への通信: ' + url);
    assert.strictEqual(init.headers.Authorization, 'Bearer gh-token');
    const route = url.slice(API.length);
    gh.calls.push({ method, route, body });

    if (route === '/git/ref/heads/main') return res(200, { object: { sha: gh.head } });
    const m = route.match(/^\/contents\/([^?]*)(?:\?ref=(.+))?$/);
    if (!m) return res(404, {});
    const path = m[1];
    if (method === 'GET') {
      if (failGet[path] && failGet[path].length) return res(failGet[path].shift(), { message: 'fail' });
      const objectMedia = init.headers.Accept === OBJECT_MEDIA;
      const f = files[path];
      if (f) {
        const big = f.body.length > MB;
        if (big && !objectMedia) return res(403, { message: 'too large', errors: [{ code: 'too_large' }] });
        return res(200, {
          type: 'file', sha: f.sha, size: f.body.length, encoding: big ? 'none' : 'base64',
          content: big ? '' : f.body.toString('base64').replace(/(.{60})/g, '$1\n'),
        });
      }
      assert.ok(!objectMedia, 'ディレクトリ一覧は既定のメディアタイプで取ること(object だと形が変わる)');
      const list = Object.entries(files)
        .filter(([p]) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
        .map(([p, f]) => ({ type: 'file', path: p, sha: f.sha }));
      return list.length ? res(200, list) : res(404, { message: 'Not Found' });
    }
    if (method === 'PUT') {
      if (failPut[path] && failPut[path].length) return res(failPut[path].shift(), { message: 'fail' });
      if (files[path] && body.sha !== files[path].sha) return res(409, { message: 'sha mismatch' });
      assert.strictEqual(body.branch, 'main');
      files[path] = { sha: sha(path), body: Buffer.from(body.content, 'base64') };
      gh.head = `commit-${n}`;
      return res(200, { content: { sha: files[path].sha }, commit: { sha: gh.head } });
    }
    return res(405, {});
  };
  return gh;
}

// fetch が呼ばれたら失敗させる
function noGithub() {
  const gh = { calls: [] };
  globalThis.fetch = async (url) => {
    gh.calls.push(url);
    throw new Error('GitHubにアクセスしてはいけない: ' + url);
  };
  return gh;
}

function req(method, path, body, headers = {}) {
  return new Request('https://worker.example' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const auth = async () => ({ Authorization: 'Bearer ' + (await createToken(ENV)).token });
const save = async (body) => handleSave(req('POST', '/save', body, await auth()), ENV, TEMPLATE);
const puts = (gh) => gh.calls.filter((c) => c.method === 'PUT').map((c) => c.route);
const putBody = (gh, path) => {
  const c = gh.calls.filter((x) => x.method === 'PUT' && x.route === '/contents/' + path).pop();
  return Buffer.from(c.body.content, 'base64').toString('utf8');
};

let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log('  ok - ' + name);
}

async function main() {
  console.log('login / token');
  await check('正しいパスワードで200、token と 約30日後の expiresAt が返る', async () => {
    const res = await handleLogin(req('POST', '/login', { password: ENV.ADMIN_PASSWORD }, { 'CF-Connecting-IP': '10.0.0.1' }), ENV);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), 'https://rk25fix-crypto.github.io');
    const body = await res.json();
    assert.ok(await verifyToken(ENV, body.token));
    const days = (body.expiresAt - Date.now()) / 86400000;
    assert.ok(days > 29.9 && days <= 30, 'expiresAt = ' + days + '日後');
  });

  await check('誤ったパスワードは1秒待ってから401', async () => {
    const t = Date.now();
    const res = await handleLogin(req('POST', '/login', { password: 'nope' }, { 'CF-Connecting-IP': '10.0.0.2' }), ENV);
    assert.strictEqual(res.status, 401);
    assert.strictEqual((await res.json()).error, 'パスワードが違います');
    assert.ok(Date.now() - t >= 950);
  });

  await check('同一IPの1分5回失敗で429(同時送信でもすり抜けない)、正しいパスワードでも429、別IPは影響なし', async () => {
    loginAttempts.clear();
    const ip = { 'CF-Connecting-IP': '1.2.3.4' };
    const results = await Promise.all(
      Array.from({ length: RATE_LIMIT_MAX + 2 }, () => handleLogin(req('POST', '/login', { password: 'nope' }, ip), ENV))
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepStrictEqual(statuses, [...Array(RATE_LIMIT_MAX).fill(401), 429, 429]);
    const blocked = await handleLogin(req('POST', '/login', { password: ENV.ADMIN_PASSWORD }, ip), ENV);
    assert.strictEqual(blocked.status, 429);
    assert.strictEqual((await blocked.json()).error, 'しばらくしてからもう一度お試しください');
    const other = await handleLogin(req('POST', '/login', { password: ENV.ADMIN_PASSWORD }, { 'CF-Connecting-IP': '5.6.7.8' }), ENV);
    assert.strictEqual(other.status, 200);
    loginAttempts.clear();
  });

  await check('Content-Length が1KB超の /login は body を読まずに即400(試行回数にも数えない)', async () => {
    loginAttempts.clear();
    const t = Date.now();
    const password = ENV.ADMIN_PASSWORD + ' '.repeat(1100);
    const res = await handleLogin(req('POST', '/login', { password }, { 'CF-Connecting-IP': '10.0.0.3', 'Content-Length': '1200' }), ENV);
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).error, '不正なリクエストです');
    assert.ok(Date.now() - t < 500, '1秒待たない');
    assert.strictEqual(loginAttempts.size, 0);
    const ok = await handleLogin(req('POST', '/login', { password: ENV.ADMIN_PASSWORD }, { 'CF-Connecting-IP': '10.0.0.3', 'Content-Length': '1024' }), ENV);
    assert.strictEqual(ok.status, 200, 'ちょうど1KBは通る');
  });

  await check('ADMIN_PASSWORD 未設定なら空パスワードでも通らない', async () => {
    assert.strictEqual(await passwordMatches({ ...ENV, ADMIN_PASSWORD: undefined }, ''), false);
    assert.strictEqual(await passwordMatches(ENV, ''), false);
  });

  await check('期限切れトークンは無効、/content は401', async () => {
    const { token } = await createToken(ENV, Date.now() - 31 * 86400000);
    assert.strictEqual(await verifyToken(ENV, token), null);
    const gh = noGithub();
    const res = await handleGetContent(req('GET', '/content', undefined, { Authorization: 'Bearer ' + token }), ENV, TEMPLATE);
    assert.strictEqual(res.status, 401);
    assert.strictEqual((await res.json()).error, 'もう一度ログインしてください');
    assert.strictEqual(gh.calls.length, 0);
  });

  await check('改ざん・別シークレット・形式不正のトークンは無効', async () => {
    const { token } = await createToken(ENV);
    const [p, s] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ exp: Date.now() + 1e12 })).toString('base64url');
    assert.strictEqual(await verifyToken(ENV, forgedPayload + '.' + s), null);
    assert.strictEqual(await verifyToken(ENV, p + '.' + s.slice(0, -2) + (s.endsWith('AA') ? 'BB' : 'AA')), null);
    assert.strictEqual(await verifyToken({ ...ENV, SESSION_SECRET: 'rotated' }, token), null);
    assert.strictEqual(await verifyToken(ENV, 'garbage'), null);
    assert.strictEqual(await verifyToken(ENV, '!!.!!'), null);
  });

  console.log('GET /content');
  await check('最新コミットSHAで content と previewHtml を返す', async () => {
    const gh = fakeGithub();
    gh.head = 'abc123';
    const res = await handleGetContent(req('GET', '/content', undefined, await auth()), ENV, TEMPLATE);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body.content, CONTENT);
    assert.deepStrictEqual(gh.calls.map((c) => c.method + ' ' + c.route), [
      'GET /git/ref/heads/main',
      'GET /contents/data/content.json?ref=abc123',
      'GET /contents/index.html?ref=abc123', // 自己修復チェック(同じコミットで比較)
      'GET /contents/images?ref=abc123',
    ], 'index.html が最新なら PUT しない');
    const html = body.previewHtml;
    assert.ok(html.startsWith('<!DOCTYPE html><html lang="ja"><head>' + BASE_TAG), '<base> は <head> 直後');
    assert.ok(html.includes('<span data-k="hero.heading">大切な家族に</span>'));
    assert.ok(html.includes('<span class="v" data-k="price.a.set">'));
    assert.ok(html.includes(`src="${RAW}/abc123/images/hero.jpg"`));
    assert.ok(html.includes(`src="${RAW}/abc123/images/gallery-1.jpg"`));
    assert.ok(html.includes('src="images/logo.png"'), '編集対象外の画像は相対パスのまま');
  });

  await check('GitHub 401 → 502', async () => {
    fakeGithub({ failGet: { 'data/content.json': [401] } });
    const res = await handleGetContent(req('GET', '/content', undefined, await auth()), ENV, TEMPLATE);
    assert.strictEqual(res.status, 502);
    assert.strictEqual((await res.json()).error, '更新に失敗しました。管理者に連絡してください');
  });

  const getContent = async () => handleGetContent(req('GET', '/content', undefined, await auth()), ENV, TEMPLATE);

  await check('自己修復: content.json だけ新しく index.html が古い(保存の途中失敗)なら、index.html をPUTして直す', async () => {
    const newer = { ...CONTENT, texts: { ...CONTENT.texts, 'hero.heading': '新しい見出し' } };
    const gh = fakeGithub({ bodies: { 'data/content.json': Buffer.from(JSON.stringify(newer)) } });
    const res = await getContent();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual((await res.json()).content, newer);
    assert.deepStrictEqual(puts(gh), ['/contents/index.html']);
    const put = gh.calls.find((c) => c.method === 'PUT');
    assert.strictEqual(put.body.sha, 'index-sha-0');
    assert.strictEqual(putBody(gh, 'index.html'), renderPublic(TEMPLATE, newer, INITIAL_SHAS));
    // 直った後はもう PUT しない
    const gh2Calls = gh.calls.length;
    assert.strictEqual((await getContent()).status, 200);
    assert.deepStrictEqual(gh.calls.slice(gh2Calls).filter((c) => c.method === 'PUT'), []);
  });

  await check('自己修復: 1MB超の旧 index.html(base64埋め込み版)も object メディアタイプで sha を取って置き換える', async () => {
    const gh = fakeGithub({ bodies: { 'index.html': Buffer.alloc(1.3 * MB, 'a') } });
    const res = await getContent();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(puts(gh), ['/contents/index.html']);
    assert.strictEqual(gh.calls.find((c) => c.method === 'PUT').body.sha, 'index-sha-0');
    assert.strictEqual(gh.files['index.html'].body.toString(), CONSISTENT_INDEX);
  });

  await check('自己修復のPUTが失敗(409=保存が割り込んだ / 500)しても GET は200。409でも再試行しない(古い内容で上書きしない)', async () => {
    for (const status of [409, 500]) {
      const gh = fakeGithub({ bodies: { 'index.html': Buffer.from('<html>old</html>') }, failPut: { 'index.html': [status] } });
      const origError = console.error;
      console.error = () => {};
      const res = await getContent().finally(() => { console.error = origError; });
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual((await res.json()).content, CONTENT);
      assert.deepStrictEqual(puts(gh), ['/contents/index.html'], String(status));
    }
  });

  await check('content.json の中身が空(1MB超)なら明示的なエラーで500', async () => {
    fakeGithub({ bodies: { 'data/content.json': Buffer.alloc(MB + 1, ' ') } });
    const origError = console.error;
    let logged = '';
    console.error = (...a) => { logged += a.join(' '); };
    const res = await getContent().finally(() => { console.error = origError; });
    assert.strictEqual(res.status, 500);
    assert.ok(logged.includes('大きすぎて'), logged);
  });

  console.log('POST /save (texts)');
  await check('トークン無しは401でGitHubに触れない', async () => {
    const gh = noGithub();
    const res = await handleSave(req('POST', '/save', { type: 'texts', values: { 'hero.heading': 'x' } }), ENV, TEMPLATE);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(gh.calls.length, 0);
  });

  await check('形式違反(2000文字超/0キー/21キー/値が文字列でない/未知のtype)は400でGitHubに触れない', async () => {
    const gh = noGithub();
    const cases = [
      [{ type: 'texts', values: { 'hero.heading': 'a'.repeat(2001) } }, '文字数が多すぎます'],
      [{ type: 'texts', values: {} }, '不正なリクエストです'],
      [{ type: 'texts', values: Object.fromEntries(Array.from({ length: 21 }, (_, i) => ['k' + i, 'x'])) }, '不正なリクエストです'],
      [{ type: 'texts', values: { 'hero.heading': 1 } }, '不正なリクエストです'],
      [{ type: 'texts', values: ['x'] }, '不正なリクエストです'],
      [{ type: 'text', key: 'hero.heading', value: 'x' }, '不正なリクエストです'],
    ];
    for (const [body, error] of cases) {
      const res = await save(body);
      assert.strictEqual(res.status, 400, JSON.stringify(body).slice(0, 80));
      assert.strictEqual((await res.json()).error, error);
    }
    assert.strictEqual(gh.calls.length, 0);
    // ちょうど2000文字は通る(形式チェックの境界)
    fakeGithub();
    assert.strictEqual((await save({ type: 'texts', values: { 'hero.heading': 'a'.repeat(2000) } })).status, 200);
  });

  await check('content.texts に無いキー(__proto__ 含む)は400、PUTしない', async () => {
    for (const values of [{ 'hero.heading': 'ok', 'no.such.key': 'x' }, JSON.parse('{"__proto__":"x"}'), { 'hero': 'x' }]) {
      const gh = fakeGithub();
      const res = await save({ type: 'texts', values });
      assert.strictEqual(res.status, 400);
      assert.strictEqual((await res.json()).error, '不正なリクエストです');
      assert.deepStrictEqual(puts(gh), []);
    }
  });

  await check('正常: content.json → index.html の順にPUT、各PUT直前にsha取得。公開HTMLに注釈なし・?v=付き', async () => {
    const gh = fakeGithub();
    const res = await save({ type: 'texts', values: { 'hero.heading': '新しい<見出し>\n2行目', 'price.a.set': '¥4,000（¥4,400）' } });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.message, '保存しました。ホームページには数分後に反映されます');
    assert.deepStrictEqual(gh.calls.map((c) => c.method + ' ' + c.route), [
      'GET /contents/data/content.json?ref=main', // キー検証
      'GET /contents/data/content.json?ref=main', // PUT直前のsha取得
      'PUT /contents/data/content.json',
      'GET /contents/images?ref=main', // 画像のblob sha
      'GET /contents/index.html?ref=main',
      'PUT /contents/index.html',
    ]);
    assert.strictEqual(gh.calls[2].body.sha, 'content-sha-0');
    assert.strictEqual(gh.calls[5].body.sha, 'index-sha-0');

    const savedJson = JSON.parse(putBody(gh, 'data/content.json'));
    assert.strictEqual(savedJson.texts['hero.heading'], '新しい<見出し>\n2行目');
    assert.strictEqual(savedJson.texts['site.title'], 'テストサロン', '他のキーは保持');
    assert.deepStrictEqual(body.content, savedJson);

    const pub = putBody(gh, 'index.html');
    assert.ok(!pub.includes('data-k'), '公開HTMLに data-k を入れない');
    assert.ok(!pub.includes('<base'), '公開HTMLに <base> を入れない');
    assert.ok(pub.includes('<h1>新しい&lt;見出し&gt;<br>2行目</h1>'));
    assert.ok(pub.includes('src="images/hero.jpg?v=hero-sha-0"'));
    assert.ok(pub.includes('src="images/gallery-1.jpg?v=g1-sha-0"'));
    assert.ok(pub.includes('src="images/logo.png"'), '編集対象外の画像はそのまま');

    const pv = body.previewHtml;
    assert.ok(pv.includes(BASE_TAG));
    assert.ok(pv.includes('data-k="hero.heading"'));
    assert.ok(pv.includes(`src="${RAW}/${gh.head}/images/hero.jpg"`), 'previewHtml は最後のコミットSHAの raw URL');
    assert.ok(!pv.includes('?v='));
  });

  await check('content.json のPUTが409なら、shaを取り直して1回だけ再PUT', async () => {
    const gh = fakeGithub({ failPut: { 'data/content.json': [409] } });
    const res = await save({ type: 'texts', values: { 'hero.heading': 'x' } });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(puts(gh), ['/contents/data/content.json', '/contents/data/content.json', '/contents/index.html']);
    const cjCalls = gh.calls.filter((c) => c.route.startsWith('/contents/data/content.json'));
    assert.deepStrictEqual(cjCalls.map((c) => c.method), ['GET', 'GET', 'PUT', 'GET', 'PUT']);
  });

  await check('既存の index.html が1MB超(旧版)でも上書きできる', async () => {
    const gh = fakeGithub({ bodies: { 'index.html': Buffer.alloc(1.3 * MB, 'a') } });
    const res = await save({ type: 'texts', values: { 'hero.heading': 'x' } });
    assert.strictEqual(res.status, 200, JSON.stringify(await res.clone().json()));
    const put = gh.calls.find((c) => c.method === 'PUT' && c.route === '/contents/index.html');
    assert.strictEqual(put.body.sha, 'index-sha-0');
    assert.ok(gh.files['index.html'].body.toString().includes('<h1>x</h1>'));
  });

  await check('409/422 が2回続いたら再試行は1回だけで500', async () => {
    const gh = fakeGithub({ failPut: { 'index.html': [422, 409] } });
    const res = await save({ type: 'texts', values: { 'hero.heading': 'x' } });
    assert.strictEqual(res.status, 500);
    assert.strictEqual((await res.json()).error, '保存できませんでした。しばらくしてからもう一度お試しください');
    assert.strictEqual(puts(gh).filter((p) => p === '/contents/index.html').length, 2);
  });

  await check('GitHub PUT が401 → 502', async () => {
    fakeGithub({ failPut: { 'data/content.json': [401] } });
    const res = await save({ type: 'texts', values: { 'hero.heading': 'x' } });
    assert.strictEqual(res.status, 502);
    assert.strictEqual((await res.json()).error, '更新に失敗しました。管理者に連絡してください');
  });

  await check('GitHub のその他のエラー(500)→ 500', async () => {
    fakeGithub({ failGet: { 'data/content.json': [500] } });
    assert.strictEqual((await save({ type: 'texts', values: { 'hero.heading': 'x' } })).status, 500);
  });

  console.log('POST /save (image)');
  await check('JPEG以外 / data URLでない は400、1MB超は「写真のサイズが大きすぎます」、GitHubに触れない', async () => {
    const gh = noGithub();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]);
    for (const d of [dataUrl(png), 'data:image/jpeg;base64,', 'https://example.com/x.jpg', 'data:image/jpeg,' + JPEG.toString('base64')]) {
      const res = await save({ type: 'image', key: 'hero', dataUrl: d });
      assert.strictEqual(res.status, 400);
      assert.strictEqual((await res.json()).error, '不正なリクエストです');
    }
    const big = Buffer.concat([JPEG, Buffer.alloc(MB - JPEG.length + 1)]);
    const res = await save({ type: 'image', key: 'hero', dataUrl: dataUrl(big) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).error, '写真のサイズが大きすぎます');
    assert.strictEqual(gh.calls.length, 0);
    // ちょうど1MBは通る
    fakeGithub();
    const ok = Buffer.concat([JPEG, Buffer.alloc(MB - JPEG.length)]);
    assert.strictEqual((await save({ type: 'image', key: 'hero', dataUrl: dataUrl(ok) })).status, 200);
  });

  await check('既存の写真が1MB超(旧上限で保存済み)でも上書きでき、その後も更新し続けられる', async () => {
    const gh = fakeGithub({ bodies: { 'images/gallery-1.jpg': Buffer.alloc(1.5 * MB, 1) } });
    for (let i = 0; i < 2; i++) {
      const before = gh.files['images/gallery-1.jpg'].sha;
      const res = await save({ type: 'image', key: 'gallery-1', dataUrl: dataUrl(JPEG) });
      assert.strictEqual(res.status, 200);
      const put = gh.calls.filter((c) => c.method === 'PUT' && c.route === '/contents/images/gallery-1.jpg').pop();
      assert.strictEqual(put.body.sha, before);
    }
  });

  await check('content.images に無いキー(テキストのキー・パス文字列を含む)は400、PUTしない', async () => {
    for (const key of ['gallery-9', 'hero.heading', 'images/hero.jpg', '__proto__']) {
      const gh = fakeGithub();
      const res = await save({ type: 'image', key, dataUrl: dataUrl(JPEG) });
      assert.strictEqual(res.status, 400, key);
      assert.deepStrictEqual(puts(gh), []);
    }
  });

  await check('正常: 画像 → index.html の順(content.json は変わらないので書かない)。保存先は content.images[key]、公開HTMLは新しいblob shaで ?v=', async () => {
    const gh = fakeGithub();
    const res = await save({ type: 'image', key: 'gallery-1', dataUrl: dataUrl(JPEG) });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.deepStrictEqual(puts(gh), ['/contents/images/gallery-1.jpg', '/contents/index.html']);
    const imgPut = gh.calls.find((c) => c.method === 'PUT' && c.route === '/contents/images/gallery-1.jpg');
    assert.strictEqual(imgPut.body.sha, 'g1-sha-0');
    assert.deepStrictEqual(Buffer.from(imgPut.body.content, 'base64'), JPEG);
    assert.deepStrictEqual(body.content, CONTENT);

    const newSha = gh.files['images/gallery-1.jpg'].sha;
    const pub = putBody(gh, 'index.html');
    assert.ok(pub.includes(`src="images/gallery-1.jpg?v=${newSha}"`));
    assert.ok(pub.includes('src="images/hero.jpg?v=hero-sha-0"'));
    assert.ok(!pub.includes('data-k'));
    assert.ok(body.previewHtml.includes(`src="${RAW}/${gh.head}/images/gallery-1.jpg"`));
    assert.ok(body.previewHtml.includes('data-k='));
  });

  console.log('build-index.js');
  await check('gitBlobSha は git hash-object と同じ値', async () => {
    assert.strictEqual(gitBlobSha(Buffer.from('')), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    assert.strictEqual(gitBlobSha(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
  });

  await check('buildIndex の出力は Worker の renderPublic と同じ(同じ blob sha なら)', async () => {
    assert.strictEqual(buildIndex(TEMPLATE, CONTENT, (p) => INITIAL_SHAS[p]), CONSISTENT_INDEX);
  });

  console.log(`\nworker.test.mjs: ${passed} checks passed`);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
