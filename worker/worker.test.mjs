// Worker本体の自己テスト(API v2)。フレームワーク無し、実行:
//   node worker/worker.test.mjs
// 本物のGitHubは使わず、fetch を小さな偽GitHub(メモリ内、Git Data API)に差し替えて検証する。
// テンプレート/content.json は作業中の実ファイルに依存しないよう、ここで自作したフィクスチャを使う。

import assert from 'node:assert';
import {
  handleLogin, handleGetContent, handleSave, createToken, verifyToken, passwordMatches,
  loginAttempts, RATE_LIMIT_MAX, renderPublic, gitBlobSha as workerBlobSha,
} from './src/lib.js';
import { buildIndex, gitBlobSha } from './build-index.js';

const ENV = { ADMIN_PASSWORD: 'correct-horse-battery', GITHUB_TOKEN: 'gh-token', SESSION_SECRET: 'session-secret' };
const API = 'https://api.github.com/repos/rk25fix-crypto/ashiato-salon';
const RAW = 'https://raw.githubusercontent.com/rk25fix-crypto/ashiato-salon';
const BASE_TAG = '<base href="https://ashiato-salon.pages.dev/">';

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
const RAW_MEDIA = 'application/vnd.github.raw+json';
const HERO = Buffer.from('old hero');
const G1 = Buffer.from('old gallery-1');
const INITIAL_SHAS = { 'images/hero.jpg': gitBlobSha(HERO), 'images/gallery-1.jpg': gitBlobSha(G1) };
// CONTENT と画像の状態に一致した公開用 index.html(整合している状態)
const CONSISTENT_INDEX = renderPublic(TEMPLATE, CONTENT, INITIAL_SHAS);
const contentJson = (c) => Buffer.from(JSON.stringify(c, null, 2) + '\n');

// ---- 偽GitHub(Git Data API) ----
// blob の sha は本物と同じ git hash-object の値。ツリーは { path: blob sha } の平らな辞書で持つ。
// fail: { '<METHOD> <route の先頭>': [status, ...] } を渡すと、該当リクエストが順にそのステータスで失敗する。
// bodies: { '<path>': Buffer } で初期ファイルの中身を差し替える。
// beforePatch: [fn(gh), ...] は ref 更新(PATCH)を処理する直前に1つずつ呼ばれる(別の保存の割り込みを再現)。
// ref の更新は本物と同じく、新しいコミットの親が現在の main でなければ 422(fast-forward でない)。
function fakeGithub({ fail = {}, bodies = {}, beforePatch = [] } = {}) {
  let n = 0;
  const gh = { blobs: {}, trees: {}, commits: {}, head: 'commit-0', calls: [] };
  const addBlob = (buf) => {
    const sha = gitBlobSha(buf);
    gh.blobs[sha] = buf;
    return sha;
  };
  const initial = {
    'data/content.json': contentJson(CONTENT),
    'images/hero.jpg': HERO,
    'images/gallery-1.jpg': G1,
    'images/logo.png': Buffer.from('logo'),
    'index.html': Buffer.from(CONSISTENT_INDEX),
    ...bodies,
  };
  gh.trees['tree-0'] = Object.fromEntries(Object.entries(initial).map(([p, b]) => [p, addBlob(b)]));
  gh.commits['commit-0'] = { tree: 'tree-0', parents: [] };

  const treeOf = (commit = gh.head) => gh.trees[gh.commits[commit].tree];
  gh.file = (path, commit) => gh.blobs[treeOf(commit)[path]];
  // main に直接コミットする(別の保存が割り込んだ状態を作る)
  gh.commit = (changes) => {
    const tree = `tree-${++n}`;
    gh.trees[tree] = { ...treeOf() };
    for (const [p, b] of Object.entries(changes)) gh.trees[tree][p] = addBlob(b);
    const sha = `commit-${++n}`;
    gh.commits[sha] = { tree, parents: [gh.head] };
    gh.head = sha;
  };
  // 2つのコミット間で中身が変わったファイル
  gh.changed = (a, b) => {
    const [ta, tb] = [treeOf(a), treeOf(b)];
    return [...new Set([...Object.keys(ta), ...Object.keys(tb)])].filter((p) => ta[p] !== tb[p]).sort();
  };

  const res = (status, body) => new Response(JSON.stringify(body), { status });

  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    assert.ok(url.startsWith(API), 'GitHub API 以外への通信: ' + url);
    assert.strictEqual(init.headers.Authorization, 'Bearer gh-token');
    const route = url.slice(API.length);
    const call = method + ' ' + route;
    gh.calls.push({ method, route, body });
    for (const [prefix, statuses] of Object.entries(fail)) {
      if (call.startsWith(prefix) && statuses.length) return res(statuses.shift(), { message: 'fail' });
    }
    let m;

    if (call === 'GET /git/ref/heads/main') return res(200, { object: { sha: gh.head } });
    if ((m = call.match(/^GET \/git\/commits\/(.+)$/))) {
      const c = gh.commits[m[1]];
      return c ? res(200, { sha: m[1], tree: { sha: c.tree } }) : res(404, {});
    }
    if ((m = call.match(/^GET \/contents\/([^?]+)\?ref=(.+)$/))) {
      assert.strictEqual(init.headers.Accept, RAW_MEDIA, '中身は raw メディアタイプで取る(1MB制限を受けない)');
      assert.ok(gh.commits[m[2]], 'ref はコミットSHA(読んだコミットに固定する)');
      const buf = gh.file(m[1], m[2]);
      return buf ? new Response(buf, { status: 200 }) : res(404, {});
    }
    if ((m = call.match(/^GET \/git\/trees\/([^?]+)\?recursive=1$/))) {
      const t = gh.trees[m[1]];
      assert.ok(t, 'ツリーSHAで取ること: ' + m[1]);
      const dirs = [...new Set(Object.keys(t).filter((p) => p.includes('/')).map((p) => p.slice(0, p.lastIndexOf('/'))))];
      const tree = [
        ...dirs.map((p) => ({ path: p, mode: '040000', type: 'tree', sha: 'dir-' + p })),
        ...Object.entries(t).map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha })),
      ];
      return res(200, { sha: m[1], tree, truncated: false });
    }
    if (call === 'POST /git/blobs') {
      assert.strictEqual(body.encoding, 'base64');
      return res(201, { sha: addBlob(Buffer.from(body.content, 'base64')) });
    }
    if (call === 'POST /git/trees') {
      assert.ok(gh.trees[body.base_tree], 'base_tree はツリーSHA');
      const t = { ...gh.trees[body.base_tree] };
      for (const e of body.tree) {
        assert.strictEqual(e.mode, '100644');
        assert.strictEqual(e.type, 'blob');
        if (typeof e.content === 'string') t[e.path] = addBlob(Buffer.from(e.content, 'utf8'));
        else assert.ok(gh.blobs[(t[e.path] = e.sha)], '存在しない blob: ' + e.sha);
      }
      const sha = `tree-${++n}`;
      gh.trees[sha] = t;
      return res(201, { sha });
    }
    if (call === 'POST /git/commits') {
      assert.ok(gh.trees[body.tree]);
      assert.strictEqual(body.parents.length, 1);
      assert.ok(gh.commits[body.parents[0]]);
      const sha = `commit-${++n}`;
      gh.commits[sha] = { tree: body.tree, parents: body.parents, message: body.message };
      return res(201, { sha });
    }
    if (call === 'PATCH /git/refs/heads/main') {
      assert.strictEqual(body.force, false, 'force で上書きしない');
      if (beforePatch.length) beforePatch.shift()(gh);
      if (gh.commits[body.sha].parents[0] !== gh.head) return res(422, { message: 'Update is not a fast forward' });
      gh.head = body.sha;
      return res(200, { object: { sha: gh.head } });
    }
    return res(404, {});
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
const getContent = async () => handleGetContent(req('GET', '/content', undefined, await auth()), ENV, TEMPLATE);
const writes = (gh) => gh.calls.filter((c) => c.method !== 'GET').map((c) => c.method + ' ' + c.route);
const patches = (gh) => writes(gh).filter((w) => w.startsWith('PATCH')).length;
const READ = (commit, tree) => [
  'GET /git/ref/heads/main',
  `GET /git/commits/${commit}`,
  `GET /contents/data/content.json?ref=${commit}`,
  `GET /git/trees/${tree}?recursive=1`,
];
const COMMIT = ['POST /git/trees', 'POST /git/commits', 'PATCH /git/refs/heads/main'];
const quiet = async (fn) => {
  const orig = console.error;
  let logged = '';
  console.error = (...a) => { logged += a.join(' '); };
  try {
    return [await fn(), logged];
  } finally {
    console.error = orig;
  }
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
    assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), 'https://ashiato-salon.pages.dev');
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
  await check('最新コミットに固定して content と previewHtml を返す(整合していれば書き込まない)', async () => {
    const gh = fakeGithub();
    gh.commit({ 'images/logo.png': Buffer.from('logo2') }); // head を commit-0 以外にする
    const head = gh.head;
    const res = await getContent();
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body.content, CONTENT);
    assert.deepStrictEqual(gh.calls.map((c) => c.method + ' ' + c.route), READ(head, gh.commits[head].tree));
    const html = body.previewHtml;
    assert.ok(html.startsWith('<!DOCTYPE html><html lang="ja"><head>' + BASE_TAG), '<base> は <head> 直後');
    assert.ok(html.includes('<span data-k="hero.heading">大切な家族に</span>'));
    assert.ok(html.includes('<span class="v" data-k="price.a.set">'));
    assert.ok(html.includes(`src="${RAW}/${head}/images/hero.jpg"`));
    assert.ok(html.includes(`src="${RAW}/${head}/images/gallery-1.jpg"`));
    assert.ok(html.includes('src="images/logo.png"'), '編集対象外の画像は相対パスのまま');
  });

  await check('GitHub 401 → 502', async () => {
    fakeGithub({ fail: { 'GET /contents/data/content.json': [401] } });
    const res = await getContent();
    assert.strictEqual(res.status, 502);
    assert.strictEqual((await res.json()).error, '更新に失敗しました。管理者に連絡してください');
  });

  await check('自己修復: content.json と index.html が食い違っていれば、index.html だけを1コミットで直す', async () => {
    const newer = { ...CONTENT, texts: { ...CONTENT.texts, 'hero.heading': '新しい見出し' } };
    const gh = fakeGithub({ bodies: { 'data/content.json': contentJson(newer) } });
    const res = await getContent();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual((await res.json()).content, newer);
    assert.deepStrictEqual(writes(gh), COMMIT);
    assert.deepStrictEqual(gh.changed('commit-0', gh.head), ['index.html']);
    assert.deepStrictEqual(gh.commits[gh.head].parents, ['commit-0']);
    assert.strictEqual(gh.file('index.html').toString(), renderPublic(TEMPLATE, newer, INITIAL_SHAS));
    // 直った後はもう書き込まない
    const before = gh.calls.length;
    assert.strictEqual((await getContent()).status, 200);
    assert.deepStrictEqual(writes({ calls: gh.calls.slice(before) }), []);
  });

  await check('自己修復: 1MB超の旧 index.html(base64埋め込み版)も置き換える', async () => {
    const gh = fakeGithub({ bodies: { 'index.html': Buffer.alloc(1.3 * MB, 'a') } });
    assert.strictEqual((await getContent()).status, 200);
    assert.strictEqual(patches(gh), 1);
    assert.strictEqual(gh.file('index.html').toString(), CONSISTENT_INDEX);
  });

  await check('自己修復が割り込み(422)・GitHubエラー(500)で失敗しても GET は200。再試行せず、割り込んだ保存を上書きしない', async () => {
    const other = contentJson({ ...CONTENT, texts: { ...CONTENT.texts, 'site.title': '割り込み' } });
    const gh = fakeGithub({
      bodies: { 'index.html': Buffer.from('<html>old</html>') },
      beforePatch: [(g) => g.commit({ 'data/content.json': other })],
    });
    const [res, logged] = await quiet(getContent);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual((await res.json()).content, CONTENT);
    assert.strictEqual(patches(gh), 1, '再試行しない');
    assert.deepStrictEqual(gh.file('data/content.json'), other, '割り込んだ保存がそのまま残る');
    assert.ok(logged.includes('自動修復に失敗'));

    const gh2 = fakeGithub({ bodies: { 'index.html': Buffer.from('<html>old</html>') }, fail: { 'POST /git/trees': [500] } });
    const [res2] = await quiet(getContent);
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(patches(gh2), 0);
  });

  await check('Worker の gitBlobSha は git hash-object と同じ値', async () => {
    assert.strictEqual(await workerBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    assert.strictEqual(await workerBlobSha(CONSISTENT_INDEX), gitBlobSha(Buffer.from(CONSISTENT_INDEX)));
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

  await check('content.texts に無いキー(__proto__ 含む)は400、書き込まない', async () => {
    for (const values of [{ 'hero.heading': 'ok', 'no.such.key': 'x' }, JSON.parse('{"__proto__":"x"}'), { 'hero': 'x' }]) {
      const gh = fakeGithub();
      const res = await save({ type: 'texts', values });
      assert.strictEqual(res.status, 400);
      assert.strictEqual((await res.json()).error, '不正なリクエストです');
      assert.deepStrictEqual(writes(gh), []);
    }
  });

  await check('正常: 1コミット(ref の PATCH 1回)で content.json と index.html を同時に更新。公開HTMLに注釈なし・?v=付き', async () => {
    const gh = fakeGithub();
    const res = await save({ type: 'texts', values: { 'hero.heading': '新しい<見出し>\n2行目', 'price.a.set': '¥4,000（¥4,400）' } });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.message, '保存しました。ホームページには数分後に反映されます');
    assert.deepStrictEqual(gh.calls.map((c) => c.method + ' ' + c.route), [...READ('commit-0', 'tree-0'), ...COMMIT]);
    assert.deepStrictEqual(gh.commits[gh.head].parents, ['commit-0']);
    assert.deepStrictEqual(gh.changed('commit-0', gh.head), ['data/content.json', 'index.html']);
    assert.ok(gh.commits[gh.head].message.includes('hero.heading'));

    const savedJson = JSON.parse(gh.file('data/content.json'));
    assert.strictEqual(savedJson.texts['hero.heading'], '新しい<見出し>\n2行目');
    assert.strictEqual(savedJson.texts['site.title'], 'テストサロン', '他のキーは保持');
    assert.deepStrictEqual(body.content, savedJson);

    const pub = gh.file('index.html').toString();
    assert.ok(!pub.includes('data-k'), '公開HTMLに data-k を入れない');
    assert.ok(!pub.includes('<base'), '公開HTMLに <base> を入れない');
    assert.ok(pub.includes('<h1>新しい&lt;見出し&gt;<br>2行目</h1>'));
    assert.ok(pub.includes(`src="images/hero.jpg?v=${INITIAL_SHAS['images/hero.jpg']}"`));
    assert.ok(pub.includes(`src="images/gallery-1.jpg?v=${INITIAL_SHAS['images/gallery-1.jpg']}"`));
    assert.ok(pub.includes('src="images/logo.png"'), '編集対象外の画像はそのまま');

    const pv = body.previewHtml;
    assert.ok(pv.includes(BASE_TAG));
    assert.ok(pv.includes('data-k="hero.heading"'));
    assert.ok(pv.includes(`src="${RAW}/${gh.head}/images/hero.jpg"`), 'previewHtml は新しいコミットSHAの raw URL');
    assert.ok(!pv.includes('?v='));
  });

  await check('ref 更新が割り込まれたら(422)最初から1回だけやり直す。割り込んだ保存の内容も残る', async () => {
    const other = contentJson({ ...CONTENT, texts: { ...CONTENT.texts, 'site.title': '割り込み' } });
    const gh = fakeGithub({ beforePatch: [(g) => g.commit({ 'data/content.json': other })] });
    const res = await save({ type: 'texts', values: { 'hero.heading': 'x' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(patches(gh), 2);
    assert.strictEqual(gh.calls.filter((c) => c.route === '/git/ref/heads/main' && c.method === 'GET').length, 2, '最新を読み直す');
    const saved = JSON.parse(gh.file('data/content.json'));
    assert.strictEqual(saved.texts['site.title'], '割り込み');
    assert.strictEqual(saved.texts['hero.heading'], 'x');
    assert.ok(gh.file('index.html').toString().includes('<title>割り込み</title>'));
    assert.deepStrictEqual((await res.json()).content, saved);
  });

  await check('割り込みが2回続いたら500(3回目は試さない)', async () => {
    const other = (t) => (g) => g.commit({ 'data/content.json': contentJson({ ...CONTENT, texts: { ...CONTENT.texts, 'site.title': t } }) });
    const gh = fakeGithub({ beforePatch: [other('1'), other('2')] });
    const [res] = await quiet(() => save({ type: 'texts', values: { 'hero.heading': 'x' } }));
    assert.strictEqual(res.status, 500);
    assert.strictEqual((await res.json()).error, '保存できませんでした。しばらくしてからもう一度お試しください');
    assert.strictEqual(patches(gh), 2);
    assert.strictEqual(JSON.parse(gh.file('data/content.json')).texts['site.title'], '2');
  });

  await check('GitHub 401(読み込み・書き込みのどこでも)→ 502', async () => {
    for (const where of ['GET /git/ref', 'POST /git/trees', 'POST /git/commits', 'PATCH /git/refs']) {
      fakeGithub({ fail: { [where]: [401] } });
      const res = await save({ type: 'texts', values: { 'hero.heading': 'x' } });
      assert.strictEqual(res.status, 502, where);
      assert.strictEqual((await res.json()).error, '更新に失敗しました。管理者に連絡してください');
    }
  });

  await check('GitHub のその他のエラー(500)→ 500、main は動かない', async () => {
    for (const where of ['GET /contents/', 'POST /git/commits', 'PATCH /git/refs']) {
      const gh = fakeGithub({ fail: { [where]: [500] } });
      const [res] = await quiet(() => save({ type: 'texts', values: { 'hero.heading': 'x' } }));
      assert.strictEqual(res.status, 500, where);
      assert.strictEqual(gh.head, 'commit-0');
    }
  });

  await check('テンプレートが参照するキーが content.json に無いと500、コミットしない', async () => {
    const broken = { ...CONTENT, texts: { 'site.title': 't', 'hero.heading': 'h' } };
    const gh = fakeGithub({ bodies: { 'data/content.json': contentJson(broken) } });
    const [res] = await quiet(() => save({ type: 'texts', values: { 'hero.heading': 'x' } }));
    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(writes(gh), []);
  });

  console.log('POST /save (image)');
  await check('JPEG以外 / data URLでない / 不正な base64(改行・空白・記号・長さ・途中の=)は400、GitHubに触れない', async () => {
    const b64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]).toString('base64'); // 正しい base64(12文字)を崩していく
    fakeGithub();
    assert.strictEqual((await save({ type: 'image', key: 'hero', dataUrl: 'data:image/jpeg;base64,' + b64 })).status, 200);
    const gh = noGithub();
    const cases = [
      dataUrl(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0])),
      'data:image/jpeg;base64,',
      'https://example.com/x.jpg',
      'data:image/jpeg,' + b64,
      'data:image/jpeg;base64,' + b64.slice(0, 4) + '\n' + b64.slice(4),
      'data:image/jpeg;base64,' + b64.slice(0, 4) + ' ' + b64.slice(4),
      'data:image/jpeg;base64,' + b64 + '\r\n',
      'data:image/jpeg;base64,' + b64.slice(0, 4) + '*' + b64.slice(5),
      'data:image/jpeg;base64,' + b64.slice(0, -1),
      'data:image/jpeg;base64,' + b64.slice(0, 4) + '====' + b64.slice(8),
      'data:image/jpeg;base64,' + b64.slice(0, -2) + '=A',
      'data:image/jpeg;base64,' + b64.slice(0, -4) + '====',
      'data:image/jpeg;base64,' + b64.replace(/\+|\//g, '-'),
    ];
    for (const d of cases) {
      const res = await save({ type: 'image', key: 'hero', dataUrl: d });
      assert.strictEqual(res.status, 400, JSON.stringify(d));
      assert.strictEqual((await res.json()).error, '不正なリクエストです', JSON.stringify(d));
    }
    assert.strictEqual(gh.calls.length, 0);
  });

  await check('1MB超は長さとパディングから判定して「写真のサイズが大きすぎます」、ちょうど1MBは通る', async () => {
    const gh = noGithub();
    for (const size of [MB + 1, MB + 2, MB + 3, 2 * MB]) {
      const big = Buffer.concat([JPEG, Buffer.alloc(size - JPEG.length)]);
      const res = await save({ type: 'image', key: 'hero', dataUrl: dataUrl(big) });
      assert.strictEqual(res.status, 400, String(size));
      assert.strictEqual((await res.json()).error, '写真のサイズが大きすぎます');
    }
    assert.strictEqual(gh.calls.length, 0);
    for (const size of [MB, MB - 1, MB - 2]) {
      fakeGithub();
      const ok = Buffer.concat([JPEG, Buffer.alloc(size - JPEG.length)]);
      assert.strictEqual((await save({ type: 'image', key: 'hero', dataUrl: dataUrl(ok) })).status, 200, String(size));
    }
  });

  await check('写真の base64 はデコード・再エンコードせず、受け取った文字列のまま blob 作成に渡る', async () => {
    const gh = fakeGithub();
    const photo = Buffer.concat([JPEG, Buffer.alloc(MB - JPEG.length, 7)]);
    const b64 = photo.toString('base64');
    const origAtob = globalThis.atob;
    const origBtoa = globalThis.btoa;
    let longest = 0;
    globalThis.atob = (s) => { longest = Math.max(longest, s.length); return origAtob(s); };
    globalThis.btoa = (s) => { longest = Math.max(longest, s.length); return origBtoa(s); };
    let res;
    try {
      res = await save({ type: 'image', key: 'hero', dataUrl: 'data:image/jpeg;base64,' + b64 });
    } finally {
      globalThis.atob = origAtob;
      globalThis.btoa = origBtoa;
    }
    assert.strictEqual(res.status, 200);
    assert.ok(longest < 100, `atob/btoa に渡った最長 ${longest} 文字(写真全体を変換していない)`);
    const blobPost = gh.calls.find((c) => c.method === 'POST' && c.route === '/git/blobs');
    assert.strictEqual(blobPost.body.content, b64);
    assert.strictEqual(blobPost.body.encoding, 'base64');
  });

  await check('content.images に無いキー(テキストのキー・パス文字列を含む)は400、書き込まない', async () => {
    for (const key of ['gallery-9', 'hero.heading', 'images/hero.jpg', '__proto__']) {
      const gh = fakeGithub();
      const res = await save({ type: 'image', key, dataUrl: dataUrl(JPEG) });
      assert.strictEqual(res.status, 400, key);
      assert.deepStrictEqual(writes(gh), []);
    }
  });

  await check('正常: 1コミットで画像と index.html を更新(content.json は変えない)。?v= は新しい blob sha', async () => {
    const gh = fakeGithub();
    const res = await save({ type: 'image', key: 'gallery-1', dataUrl: dataUrl(JPEG) });
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.deepStrictEqual(gh.calls.map((c) => c.method + ' ' + c.route), [...READ('commit-0', 'tree-0'), 'POST /git/blobs', ...COMMIT]);
    assert.deepStrictEqual(gh.changed('commit-0', gh.head), ['images/gallery-1.jpg', 'index.html']);
    assert.deepStrictEqual(gh.file('images/gallery-1.jpg'), JPEG);
    assert.deepStrictEqual(body.content, CONTENT);

    const newSha = gitBlobSha(JPEG);
    const pub = gh.file('index.html').toString();
    assert.ok(pub.includes(`src="images/gallery-1.jpg?v=${newSha}"`));
    assert.ok(pub.includes(`src="images/hero.jpg?v=${INITIAL_SHAS['images/hero.jpg']}"`));
    assert.ok(!pub.includes('data-k'));
    assert.ok(body.previewHtml.includes(`src="${RAW}/${gh.head}/images/gallery-1.jpg"`));
    assert.ok(body.previewHtml.includes('data-k='));
  });

  await check('写真の保存が割り込まれたら、blob は作り直さずに最初からやり直す', async () => {
    const other = contentJson({ ...CONTENT, texts: { ...CONTENT.texts, 'site.title': '割り込み' } });
    const gh = fakeGithub({ beforePatch: [(g) => g.commit({ 'data/content.json': other })] });
    const res = await save({ type: 'image', key: 'hero', dataUrl: dataUrl(JPEG) });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(patches(gh), 2);
    assert.strictEqual(writes(gh).filter((w) => w === 'POST /git/blobs').length, 1);
    assert.deepStrictEqual(gh.file('images/hero.jpg'), JPEG);
    assert.deepStrictEqual(gh.file('data/content.json'), other);
    assert.ok(gh.file('index.html').toString().includes('<title>割り込み</title>'));
  });

  await check('blob 作成で GitHub 401 → 502', async () => {
    fakeGithub({ fail: { 'POST /git/blobs': [401] } });
    const res = await save({ type: 'image', key: 'hero', dataUrl: dataUrl(JPEG) });
    assert.strictEqual(res.status, 502);
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
