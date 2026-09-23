// Worker本体のロジック(仕様: worker/API.md v2)。
// Cloudflare Workersのモジュール形式では「エントリポイントのnamed exportは
// ハンドラ等に限る」制約があるため、ロジックはここに分離し、src/index.js は薄いルーティングだけにする。
// index.template.html は Wrangler の Text module rule でしか import できないので、
// テンプレート文字列は呼び出し元(src/index.js / worker.test.mjs)から引数で渡す。
//
// 編集できるキー = 現在の data/content.json に存在するキー。キー一覧はハードコードしない。
//
// 書き込みは Git Data API で「1回の保存 = 1コミット」(Pages のビルド回数を抑え、途中失敗を無くす)。
// 写真は CPU 時間(無料プランは1リクエスト10ms)を抑えるため、base64 のままデコードせず GitHub に渡す。

import { renderTemplate } from '../render.js';

const GITHUB_OWNER = 'rk25fix-crypto';
const GITHUB_REPO = 'ashiato-salon';
const GITHUB_BRANCH = 'main';
// 公開サイト(Cloudflare Pages)。管理画面もここから配信されるので、CORS はこのオリジンだけを許可する
const SITE_ORIGIN = 'https://ashiato-salon.pages.dev';
const ALLOWED_ORIGIN = SITE_ORIGIN;
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
const PAGES_BASE = `${SITE_ORIGIN}/`;
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
const CONTENT_PATH = 'data/content.json';
const INDEX_PATH = 'index.html';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日(オーナーが頻繁に入力し直さずに済むように)
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const RATE_LIMIT_MAX = 5;
const LOGIN_DELAY_MS = 1000;
const MAX_TEXT_LEN = 2000;
const MAX_TEXT_KEYS = 20;
// 写真は管理画面で縮小済み(通常数百KB)。リクエストの大きさと処理時間を抑えるため1MBまで。
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_LOGIN_BODY = 1024; // /login は未認証で body を読むので小さく制限

const ERR_BAD = '不正なリクエストです';
const ERR_AUTH = 'もう一度ログインしてください';
const ERR_GH_AUTH = '更新に失敗しました。管理者に連絡してください';
const ERR_SAVE = '保存できませんでした。しばらくしてからもう一度お試しください';
const ERR_SIZE = '写真のサイズが大きすぎます';

// ponytail: isolate は頻繁に作り直されるので「無いよりマシ」程度のレート制限。
// 実質的な防御は 1秒wait + 長い合言葉。永続化が要るなら KV / Durable Object に載せ替える。
export const loginAttempts = new Map();

export class GithubAuthError extends Error {}
export class GithubApiError extends Error {
  constructor(status) {
    super('github api error ' + status);
    this.status = status;
  }
}
// main の更新が fast-forward にならなかった(読んだ後に別の保存が割り込んだ)
export class RefConflictError extends Error {}

// ---- 汎用ヘルパー ----

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hasOwn = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const toBase64Url = (bytes) => bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fromBase64Url(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return base64ToBytes(s);
}

export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

// git hash-object と同じ blob sha(build-index.js の gitBlobSha と同じ値)
export async function gitBlobSha(text) {
  const body = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(header.length + body.length);
  buf.set(header);
  buf.set(body, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- パスワード照合(HMACしてから固定長digestを定数時間比較) ----
export async function passwordMatches(env, password) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || !password) return false;
  const [a, b] = await Promise.all([
    hmacSign(env.SESSION_SECRET, password),
    hmacSign(env.SESSION_SECRET, env.ADMIN_PASSWORD),
  ]);
  return constantTimeEqual(a, b);
}

// ---- セッショントークン(payload {exp} を HMAC 署名) ----
export async function createToken(env, now = Date.now()) {
  const exp = now + SESSION_TTL_MS;
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify({ exp })));
  const sig = await hmacSign(env.SESSION_SECRET, payloadB64);
  return { token: payloadB64 + '.' + toBase64Url(sig), expiresAt: exp };
}

export async function verifyToken(env, token) {
  if (!token || !env.SESSION_SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const expected = await hmacSign(env.SESSION_SECRET, parts[0]);
    if (!constantTimeEqual(expected, fromBase64Url(parts[1]))) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

async function isAuthorized(request, env) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/);
  return !!(m && (await verifyToken(env, m[1])));
}

// ---- GitHub API ----

async function gh(env, path, init = {}) {
  const res = await fetch(GITHUB_API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ashiato-salon-worker',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401) throw new GithubAuthError();
  return res;
}

async function ghJson(env, path, init) {
  const res = await gh(env, path, init);
  if (!res.ok) throw new GithubApiError(res.status);
  return res.json();
}

const ghPost = (env, path, body) => ghJson(env, path, { method: 'POST', body: JSON.stringify(body) });

// main の最新コミットの状態を読む。
// 戻り値 { commitSha, treeSha, shas: { path: blob sha }(全ファイル), content: content.json }
// /git/trees/{コミットSHA} でも一覧は取れるが、応答の sha がツリーではなくコミットの SHA になるため、
// base_tree に使うツリー SHA は /git/commits から取る。
async function readHead(env) {
  const commitSha = (await ghJson(env, `/git/ref/heads/${GITHUB_BRANCH}`)).object.sha;
  const [treeSha, content] = await Promise.all([
    ghJson(env, `/git/commits/${commitSha}`).then((c) => c.tree.sha),
    // raw メディアタイプは 100MB まで中身を返す(既定の 1MB 制限を受けない)
    ghJson(env, `/contents/${CONTENT_PATH}?ref=${commitSha}`, { headers: { Accept: 'application/vnd.github.raw+json' } }),
  ]);
  const tree = await ghJson(env, `/git/trees/${treeSha}?recursive=1`);
  if (tree.truncated) throw new Error('リポジトリのファイル一覧が途中で切れました');
  const shas = {};
  for (const e of tree.tree) if (e.type === 'blob') shas[e.path] = e.sha;
  return { commitSha, treeSha, shas, content };
}

// head の上に files({ path: { content: 文字列 } または { sha: blob sha } })を載せた1コミットを作り、
// main を fast-forward で進める(force: false)。割り込まれていたら RefConflictError。
// 戻り値は新しいコミットの SHA。
async function commitFiles(env, head, files, message) {
  const tree = await ghPost(env, '/git/trees', {
    base_tree: head.treeSha,
    tree: Object.entries(files).map(([path, f]) => ({ path, mode: '100644', type: 'blob', ...f })),
  });
  const commit = await ghPost(env, '/git/commits', { message, tree: tree.sha, parents: [head.commitSha] });
  const res = await gh(env, `/git/refs/heads/${GITHUB_BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  if (res.status === 422 || res.status === 409) throw new RefConflictError();
  if (!res.ok) throw new GithubApiError(res.status);
  return commit.sha;
}

// 公開用 index.html が content.json と食い違っていたら(手での編集・テンプレート更新後など)作り直す。
// 比較は blob sha 同士(index.html 本体は取得しない)。親は読んだコミットに固定し、再試行しない:
// その後に保存が割り込んでいれば RefConflictError で諦め、古い内容で上書きしないため。
async function repairIndexHtml(env, template, head) {
  const html = renderPublic(template, head.content, head.shas);
  if (head.shas[INDEX_PATH] === (await gitBlobSha(html))) return false;
  await commitFiles(env, head, { [INDEX_PATH]: { content: html } }, 'admin: index.html を再生成(自動修復)');
  return true;
}

// ---- HTML生成 ----

// 編集画面のプレビュー用。<base> で相対パス(ロゴ等)は Pages から、編集可能画像は
// 指定コミットの raw URL から読む。<base> は <head> の直後に入れる(<!DOCTYPE> より前に
// 置くと quirks mode になるため)。<head> が無ければ先頭に付ける。
export function renderPreview(template, content, commitSha) {
  const html = renderTemplate(template, content, {
    annotate: true,
    imageUrl: (_key, path) => `${RAW_BASE}/${commitSha}/${path}`,
  });
  const base = `<base href="${PAGES_BASE}">`;
  const m = html.match(/<head(\s[^>]*)?>/i);
  return m ? html.slice(0, m.index + m[0].length) + base + html.slice(m.index + m[0].length) : base + html;
}

// 公開用 index.html。注釈なし、編集可能画像に ?v=<blob sha>(訪問者のキャッシュ対策)。
export function renderPublic(template, content, blobShas) {
  return renderTemplate(template, content, {
    imageUrl: (_key, path) => (blobShas[path] ? `${path}?v=${blobShas[path]}` : path),
  });
}

// ---- /save の入力検証 ----

// GitHubに触れずに判定できる形式チェック。
export function validateSaveShape(body) {
  if (!isPlainObject(body)) return ERR_BAD;
  if (body.type === 'texts') {
    if (!isPlainObject(body.values)) return ERR_BAD;
    const keys = Object.keys(body.values);
    if (keys.length < 1 || keys.length > MAX_TEXT_KEYS) return ERR_BAD;
    for (const k of keys) {
      if (typeof body.values[k] !== 'string') return ERR_BAD;
      if (body.values[k].length > MAX_TEXT_LEN) return '文字数が多すぎます';
    }
    return null;
  }
  if (body.type === 'image') {
    if (typeof body.key !== 'string' || typeof body.dataUrl !== 'string') return ERR_BAD;
    const comma = body.dataUrl.indexOf(',');
    if (!body.dataUrl.startsWith('data:') || comma < 0 || !body.dataUrl.slice(0, comma).endsWith(';base64')) return ERR_BAD;
    // 全体はデコードしない(CPU 時間対策)。サイズは長さとパディングから計算する。
    const b64 = body.dataUrl.slice(comma + 1);
    if (b64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return ERR_SIZE; // 正規表現を掛ける前に明らかな超過を弾く
    // 改行・空白も不可。'=' は末尾の1〜2文字だけ。
    // ^[...]*={0,2}$ の形の正規表現は初回実行が遅い(1MBで約10ms)ので、「範囲外の文字を探す」形で書く(約2ms)。
    const eq = b64.indexOf('=');
    const pad = eq < 0 ? '' : b64.slice(eq);
    if (b64.length % 4 || (pad !== '' && pad !== '=' && pad !== '==') || /[^A-Za-z0-9+/=]/.test(b64)) return ERR_BAD;
    if ((b64.length / 4) * 3 - pad.length > MAX_IMAGE_BYTES) return ERR_SIZE;
    const head = atob(b64.slice(0, 4)); // 先頭3バイトだけデコードして JPEG(FF D8 FF)か確認
    if (head.length < 3 || head.charCodeAt(0) !== 0xff || head.charCodeAt(1) !== 0xd8 || head.charCodeAt(2) !== 0xff) return ERR_BAD;
    body.base64 = b64;
    return null;
  }
  return ERR_BAD;
}

// 現在の content に対してキーが存在するか。
export function keysExist(body, content) {
  if (body.type === 'texts') return Object.keys(body.values).every((k) => hasOwn(content.texts, k));
  return hasOwn(content.images, body.key) && typeof content.images[body.key] === 'string';
}

function applyTexts(content, values) {
  return { ...content, texts: { ...content.texts, ...values } };
}

// ---- ルートハンドラ ----

export async function handleLogin(request, env) {
  if (Number(request.headers.get('Content-Length')) > MAX_LOGIN_BODY) return json(400, { error: ERR_BAD });
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: ERR_BAD });
  }
  const password = body && typeof body.password === 'string' ? body.password : '';
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const attempts = (loginAttempts.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (attempts.length >= RATE_LIMIT_MAX) {
    loginAttempts.set(ip, attempts);
    return json(429, { error: 'しばらくしてからもう一度お試しください' });
  }
  // 判定前に試行を記録する(同時に大量に送られても待機中の分まで数えるため)。成功したら消す。
  attempts.push(now);
  loginAttempts.set(ip, attempts);
  await sleep(LOGIN_DELAY_MS);

  if (!(await passwordMatches(env, password))) return json(401, { error: 'パスワードが違います' });
  loginAttempts.delete(ip);
  return json(200, await createToken(env));
}

export async function handleGetContent(request, env, template) {
  if (!(await isAuthorized(request, env))) return json(401, { error: ERR_AUTH });
  try {
    const head = await readHead(env);
    try {
      if (await repairIndexHtml(env, template, head)) console.warn('index.html を自動修復しました');
    } catch (e) {
      console.error('index.html の自動修復に失敗', e); // 読み込み自体は成功として返す
    }
    return json(200, { content: head.content, previewHtml: renderPreview(template, head.content, head.commitSha) });
  } catch (e) {
    if (e instanceof GithubAuthError) return json(502, { error: ERR_GH_AUTH });
    console.error('GET /content failed', e);
    return json(500, { error: '読み込みに失敗しました。しばらくしてからもう一度お試しください' });
  }
}

export async function handleSave(request, env, template) {
  if (!(await isAuthorized(request, env))) return json(401, { error: ERR_AUTH });
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: ERR_BAD });
  }
  const shapeError = validateSaveShape(body);
  if (shapeError) return json(400, { error: shapeError });

  try {
    let imageBlobSha = null; // blob は中身で決まるので、やり直しでも作り直さない
    for (let attempt = 0; ; attempt++) {
      // 毎回最新を読んでからキーの検証・値の適用を行う(割り込まれた保存の内容を消さないため)
      const head = await readHead(env);
      if (!keysExist(body, head.content)) return json(400, { error: ERR_BAD });

      let saved = head.content;
      const files = {};
      let message;
      if (body.type === 'texts') {
        saved = applyTexts(head.content, body.values);
        files[CONTENT_PATH] = { content: JSON.stringify(saved, null, 2) + '\n' };
        message = `admin: テキストを更新 (${Object.keys(body.values).join(', ')})`;
      } else {
        // 写真の保存では content.json は変わらない(パスは固定)ので書かない
        const path = saved.images[body.key];
        imageBlobSha ??= (await ghPost(env, '/git/blobs', { content: body.base64, encoding: 'base64' })).sha;
        files[path] = { sha: imageBlobSha };
        head.shas[path] = imageBlobSha;
        message = `admin: 写真を更新 (${body.key})`;
      }
      files[INDEX_PATH] = { content: renderPublic(template, saved, head.shas) };

      let commitSha;
      try {
        commitSha = await commitFiles(env, head, files, message);
      } catch (e) {
        if (attempt === 0 && e instanceof RefConflictError) continue; // 割り込まれたら最初から1回だけやり直す
        throw e;
      }
      return json(200, {
        ok: true,
        message: '保存しました。ホームページには数分後に反映されます',
        content: saved,
        previewHtml: renderPreview(template, saved, commitSha),
      });
    }
  } catch (e) {
    if (e instanceof GithubAuthError) return json(502, { error: ERR_GH_AUTH });
    console.error('POST /save failed', e);
    return json(500, { error: ERR_SAVE });
  }
}
