// Worker本体のロジック(仕様: worker/API.md v2)。
// Cloudflare Workersのモジュール形式では「エントリポイントのnamed exportは
// ハンドラ等に限る」制約があるため、ロジックはここに分離し、src/index.js は薄いルーティングだけにする。
// index.template.html は Wrangler の Text module rule でしか import できないので、
// テンプレート文字列は呼び出し元(src/index.js / worker.test.mjs)から引数で渡す。
//
// 編集できるキー = 現在の data/content.json に存在するキー。キー一覧はハードコードしない。

import { renderTemplate } from '../render.js';

const GITHUB_OWNER = 'rk25fix-crypto';
const GITHUB_REPO = 'ashiato-salon';
const GITHUB_BRANCH = 'main';
const ALLOWED_ORIGIN = 'https://rk25fix-crypto.github.io';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
const PAGES_BASE = `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/`;
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
const CONTENT_PATH = 'data/content.json';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日(オーナーが頻繁に入力し直さずに済むように)
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const RATE_LIMIT_MAX = 5;
const LOGIN_DELAY_MS = 1000;
const MAX_TEXT_LEN = 2000;
const MAX_TEXT_KEYS = 20;
// GitHub Contents API は既定のメディアタイプだと1MB超のファイルを返せない。object 形式で sha は取れるが、
// 写真は管理画面で縮小済み(通常数百KB)なので1MBに収める。
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_LOGIN_BODY = 1024; // /login は未認証で body を読むので小さく制限

const ERR_BAD = '不正なリクエストです';
const ERR_AUTH = 'もう一度ログインしてください';
const ERR_GH_AUTH = '更新に失敗しました。管理者に連絡してください';
const ERR_SAVE = '保存できませんでした。しばらくしてからもう一度お試しください';

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

async function ghJson(env, path) {
  const res = await gh(env, path);
  if (!res.ok) throw new GithubApiError(res.status);
  return res.json();
}

// ファイルの sha と中身。存在しなければ null。
// object メディアタイプなら1MB超(〜100MB)でも sha は返る(中身は空、encoding "none")。
// その場合 contentBytes は null。ディレクトリ一覧には使わないこと(戻り値の形が変わる)。
export async function ghGetFile(env, path, ref = GITHUB_BRANCH) {
  const res = await gh(env, `/contents/${path}?ref=${ref}`, { headers: { Accept: 'application/vnd.github.object+json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new GithubApiError(res.status);
  const data = await res.json();
  const tooLarge = !data.content && data.size > 0;
  return { sha: data.sha, contentBytes: tooLarge ? null : base64ToBytes((data.content || '').replace(/\n/g, '')) };
}

function parseContentJson(file) {
  if (!file) throw new GithubApiError(404);
  if (!file.contentBytes) throw new Error(`${CONTENT_PATH} が大きすぎて(1MB超)読めません`);
  return JSON.parse(new TextDecoder().decode(file.contentBytes));
}

function bytesEqual(a, b) {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function getMainCommitSha(env) {
  return (await ghJson(env, `/git/ref/heads/${GITHUB_BRANCH}`)).object.sha;
}

async function getContent(env, ref) {
  return parseContentJson(await ghGetFile(env, CONTENT_PATH, ref));
}

// PUT直前にshaを取得してPUT。409/422は1回だけsha再取得して再PUT。
// computeBytes(file) は現在のファイル(無ければnull)から新しいバイト列を作る。
// 戻り値は GitHub の応答JSON({ content: { sha }, commit: { sha } })。
export async function putWithRetry(env, path, computeBytes, message) {
  for (let attempt = 0; ; attempt++) {
    const file = await ghGetFile(env, path);
    const body = { message, content: bytesToBase64(computeBytes(file)), branch: GITHUB_BRANCH };
    if (file) body.sha = file.sha;
    const res = await gh(env, `/contents/${path}`, { method: 'PUT', body: JSON.stringify(body) });
    if (res.ok) return res.json();
    if (attempt === 0 && (res.status === 409 || res.status === 422)) continue;
    throw new GithubApiError(res.status);
  }
}

// ディレクトリ一覧から各画像ファイルの blob sha を集める({ path: sha })。
// 既定のメディアタイプのまま(一覧は1MB制限の対象外)。
async function getBlobShas(env, paths, ref = GITHUB_BRANCH) {
  const dirs = [...new Set(paths.map((p) => p.slice(0, Math.max(0, p.lastIndexOf('/')))))];
  const shas = {};
  for (const dir of dirs) {
    for (const entry of await ghJson(env, `/contents/${dir}?ref=${ref}`)) shas[entry.path] = entry.sha;
  }
  return shas;
}

// 保存の途中失敗(content.json は書けたが index.html は書けなかった等)の自己修復。
// commitSha 時点の content から作った公開用 index.html が、同じコミットの index.html と違えば PUT する。
// sha は commitSha 時点のものを使い、再試行しない: その後に保存が割り込んで index.html が変わっていれば
// 409 で失敗させ、古い内容で上書きしないため。
async function repairIndexHtml(env, template, content, commitSha) {
  const [file, blobShas] = await Promise.all([
    ghGetFile(env, 'index.html', commitSha),
    getBlobShas(env, Object.values(content.images), commitSha),
  ]);
  const html = new TextEncoder().encode(renderPublic(template, content, blobShas));
  if (file && bytesEqual(file.contentBytes, html)) return false; // 1MB超(旧版)は contentBytes=null → 修復対象
  const body = { message: 'admin: index.html を再生成(自動修復)', content: bytesToBase64(html), branch: GITHUB_BRANCH };
  if (file) body.sha = file.sha;
  const res = await gh(env, '/contents/index.html', { method: 'PUT', body: JSON.stringify(body) });
  if (!res.ok) throw new GithubApiError(res.status);
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
    const b64 = body.dataUrl.slice(comma + 1);
    if (b64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) return '写真のサイズが大きすぎます'; // デコード前に弾く
    let bytes;
    try {
      bytes = base64ToBytes(b64);
    } catch {
      return ERR_BAD;
    }
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return ERR_BAD;
    if (bytes.length > MAX_IMAGE_BYTES) return '写真のサイズが大きすぎます';
    body.bytes = bytes;
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
    const commitSha = await getMainCommitSha(env);
    const content = await getContent(env, commitSha);
    try {
      if (await repairIndexHtml(env, template, content, commitSha)) console.warn('index.html を自動修復しました');
    } catch (e) {
      console.error('index.html の自動修復に失敗', e); // 読み込み自体は成功として返す
    }
    return json(200, { content, previewHtml: renderPreview(template, content, commitSha) });
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
    const current = await getContent(env);
    if (!keysExist(body, current)) return json(400, { error: ERR_BAD });
    // 書き込む前に描画できることを確認(テンプレートと content の不整合で途中まで書いて止まるのを防ぐ)
    renderTemplate(template, body.type === 'texts' ? applyTexts(current, body.values) : current);

    let uploaded = null;
    if (body.type === 'image') {
      const path = current.images[body.key];
      const res = await putWithRetry(env, path, () => body.bytes, `admin: 写真を更新 (${body.key})`);
      uploaded = { path, sha: res.content && res.content.sha };
    }

    // 写真の保存では content.json は変わらない(パスは固定)ので書かない。無駄なコミットとPagesの再ビルドを避ける。
    let saved = current;
    if (body.type === 'texts') {
      await putWithRetry(
        env,
        CONTENT_PATH,
        (file) => {
          saved = applyTexts(parseContentJson(file), body.values);
          return new TextEncoder().encode(JSON.stringify(saved, null, 2) + '\n');
        },
        `admin: テキストを更新 (${Object.keys(body.values).join(', ')})`
      );
    }

    const blobShas = await getBlobShas(env, Object.values(saved.images));
    if (uploaded && uploaded.sha) blobShas[uploaded.path] = uploaded.sha; // 一覧の反映遅れに備えて、PUT応答のshaを優先
    const res = await putWithRetry(
      env,
      'index.html',
      () => new TextEncoder().encode(renderPublic(template, saved, blobShas)),
      'admin: index.html を再生成'
    );

    return json(200, {
      ok: true,
      message: '保存しました。ホームページには数分後に反映されます',
      content: saved,
      previewHtml: renderPreview(template, saved, res.commit.sha),
    });
  } catch (e) {
    if (e instanceof GithubAuthError) return json(502, { error: ERR_GH_AUTH });
    console.error('POST /save failed', e);
    return json(500, { error: ERR_SAVE });
  }
}
