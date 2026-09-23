// index.template.html + data/content.json から生成したHTMLが、現行の index.html と
// (画像の src と data-img 属性を除いて)一致することを確認するセルフチェック。
// index.html は旧版(画像を base64 埋め込み)でも、build-index.js で生成した新形式でもよい。
//
// 使い方: node worker/verify-migration.js   (失敗があれば exit code 1)
//
// チェック内容:
//  1. 表示テキスト(タグの外の文字列)が並び順・空白まで完全一致
//  2. HTML構造(タグ名とclassの並び)が一致
//  3. 画像src と data-img を除いたHTML全体がバイト単位で一致
//  4. 画像: 旧版なら base64 の中身と、生成HTMLが指す images/ のファイルがバイト単位で一致。
//     新形式なら同じパスを指し、?v= がそのファイルの git blob sha と一致
//  5. テンプレート内に残っている(プレースホルダ化していない)表示テキストが、意図的な除外だけであること
//  6. annotate:true で描画でき、data-k の数がプレースホルダ数と一致
//  7. テンプレートのキーと content.json のキーが過不足なく一致
//  8. (新形式のみ)index.html が build-index.js の出力と完全一致(生成し忘れ・古いままの検出)

const fs = require('fs');
const path = require('path');
const { renderTemplate, listPlaceholders } = require('./render.js');
const { gitBlobSha, buildFromRepo } = require('./build-index.js');

const root = path.join(__dirname, '..');
// 改行は LF に揃えて比較する(renderTemplate も LF で出力する。作業コピーは autocrlf で CRLF になりうる)
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8').replace(/\r\n/g, '\n');

// 意図的にプレースホルダ化していない表示テキストと、その理由
const INTENTIONALLY_FIXED = {
  '第一種動物取扱業の登録表示': '法定表示の見出し',
  '事業者氏名': '法定の項目名(dt)',
  '事業所の名称': '法定の項目名(dt)',
  '事業所の所在地': '法定の項目名(dt)',
  '動物取扱業の種別': '法定の項目名(dt)',
  '登録番号': '法定の項目名(dt)',
  '登録年月日': '法定の項目名(dt)',
  '有効期間の末日': '法定の項目名(dt)',
  '動物取扱責任者': '法定の項目名(dt)',
  '月': '営業日マス(open/closed クラスが追随しないため)',
  '火': '営業日マス',
  '水': '営業日マス',
  '木': '営業日マス',
  '金': '営業日マス',
  '土': '営業日マス',
  '日': '営業日マス',
  '営業': '営業日マス',
  '休み': '営業日マス',
};

// HTMLをトークン列に分解。script/style/svg/title/コメントは中身ごと1トークン(表示テキスト対象外)。
function tokenize(html) {
  const re = /<!--[\s\S]*?-->|<(script|style|svg|title)\b[^>]*>[\s\S]*?<\/\1>|<[^>]+>|[^<]+/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const s = m[0];
    if (s[0] !== '<') out.push({ type: 'text', s });
    else if (m[1] || s.startsWith('<!--')) out.push({ type: 'opaque', s });
    else out.push({ type: 'tag', s });
  }
  return out;
}

function tagSig(tag) {
  const name = (tag.match(/^<\/?\s*([a-zA-Z0-9]+)/) || [])[1] || tag;
  const cls = (tag.match(/\sclass="([^"]*)"/) || [])[1];
  return (tag[1] === '/' ? '/' : '') + name.toLowerCase() + (cls ? '.' + cls.split(/\s+/).join('.') : '');
}

// 画像参照(data URI or images/...)を IMG に置換、data-img を除去
function normalizeImages(html) {
  return html
    .replace(/\s+data-img="[^"]*"/g, '')
    .replace(/(src|href)="(data:image\/[^"]+|images\/[^"]+)"/g, '$1="IMG"');
}

function imageRefs(html) {
  return [...html.matchAll(/(?:src|href)="(data:image\/[^"]+|images\/[^"]+)"/g)].map((m) => m[1]);
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'OK  ' : 'NG  ') + name);
  if (!ok) {
    failed++;
    if (detail) console.log('     ' + detail);
  }
}

const original = read('index.html');
const template = read('index.template.html');
const content = JSON.parse(read('data/content.json'));
const rendered = renderTemplate(template, content);

const oTok = tokenize(original);
const rTok = tokenize(rendered);

// 1. 表示テキスト
const oText = oTok.filter((t) => t.type === 'text').map((t) => t.s);
const rText = rTok.filter((t) => t.type === 'text').map((t) => t.s);
{
  const i = firstDiff(oText, rText);
  const ok = i === oText.length && i === rText.length;
  check('1. 表示テキストが完全一致 (' + oText.filter((s) => s.trim()).length + ' 個のテキスト)', ok,
    ok ? '' : '最初の差分: 元=' + JSON.stringify(oText[i]) + ' 生成=' + JSON.stringify(rText[i]));
}

// 2. 構造(タグ名+class)
const oSig = oTok.filter((t) => t.type === 'tag').map((t) => tagSig(t.s));
const rSig = rTok.filter((t) => t.type === 'tag').map((t) => tagSig(t.s));
{
  const i = firstDiff(oSig, rSig);
  const ok = i === oSig.length && i === rSig.length;
  check('2. HTML構造(タグとclassの並び)が一致 (' + oSig.length + ' タグ)', ok,
    ok ? '' : '最初の差分: 元=' + oSig[i] + ' 生成=' + rSig[i]);
}

// 3. 画像参照を除いた全体一致
{
  const a = normalizeImages(original);
  const b = normalizeImages(rendered);
  const i = firstDiff(a, b);
  check('3. 画像src/data-img以外のHTML全体がバイト単位で一致', a === b,
    '差分位置 ' + i + ': 元=' + JSON.stringify(a.slice(i, i + 60)) + ' 生成=' + JSON.stringify(b.slice(i, i + 60)));
}

// 4. 画像の中身
{
  const o = imageRefs(original);
  const r = imageRefs(rendered);
  const bad = [];
  if (o.length !== r.length) bad.push('画像参照の数が違う ' + o.length + ' vs ' + r.length);
  o.forEach((ref, i) => {
    const file = r[i] && path.join(root, r[i]);
    if (!file || !fs.existsSync(file)) return bad.push('#' + i + ' ' + r[i] + ' が無い');
    const bytes = fs.readFileSync(file);
    const [p, v] = ref.split('?v=');
    const ok = ref.startsWith('data:')
      ? bytes.equals(Buffer.from(ref.split(',')[1] || '', 'base64'))
      : p === r[i] && (v === undefined || v === gitBlobSha(bytes));
    if (!ok) bad.push('#' + i + ' ' + ref.slice(0, 60) + ' ≠ ' + r[i]);
  });
  check('4. 画像 ' + o.length + ' 箇所が元と同じファイルを指している', bad.length === 0, bad.join(', '));
}

// 5. プレースホルダ化されていない表示テキスト
{
  const leftovers = tokenize(template)
    .filter((t) => t.type === 'text')
    .map((t) => t.s.replace(/\{\{[a-z]+:[^}]+\}\}/g, '').replace(/&nbsp;/g, '').trim())
    .filter(Boolean);
  console.log('    テンプレートに固定のまま残っている表示テキスト:');
  leftovers.forEach((s) => console.log('      - ' + s + '  … ' + (INTENTIONALLY_FIXED[s] || '★意図しない残り')));
  const unexpected = leftovers.filter((s) => !INTENTIONALLY_FIXED[s]);
  check('5. 意図的な除外以外に固定テキストが残っていない', unexpected.length === 0, unexpected.join(' / '));
}

// 6. annotate
{
  let ok = true;
  let detail = '';
  try {
    const pv = renderTemplate(template, content, { annotate: true });
    const expected = listPlaceholders(template).filter((p) => p.kind === 'text' || p.kind === 'price').length;
    const got = (pv.match(/data-k="/g) || []).length;
    ok = got === expected;
    detail = 'data-k ' + got + ' / 期待 ' + expected;
  } catch (e) {
    ok = false;
    detail = e.message;
  }
  check('6. renderTemplate(..., {annotate:true}) がエラーなく動く', ok, detail);
}

// 7. キーの過不足
{
  const ph = listPlaceholders(template);
  const tplTexts = new Set(ph.filter((p) => p.kind !== 'img').map((p) => p.key));
  const tplImgs = new Set(ph.filter((p) => p.kind === 'img').map((p) => p.key));
  const diff = (a, b) => [...a].filter((k) => !b.has(k));
  const cTexts = new Set(Object.keys(content.texts || {}));
  const cImgs = new Set(Object.keys(content.images || {}));
  const problems = [
    ...diff(tplTexts, cTexts).map((k) => 'content.texts に無い: ' + k),
    ...diff(cTexts, tplTexts).map((k) => 'テンプレートで未使用: ' + k),
    ...diff(tplImgs, cImgs).map((k) => 'content.images に無い: ' + k),
    ...diff(cImgs, tplImgs).map((k) => 'テンプレートで未使用の画像: ' + k),
  ];
  const noDataImg = [...template.matchAll(/<img\b[^>]*\{\{img:[^>]*>/g)].filter((m) => !/data-img="/.test(m[0]));
  if (noDataImg.length) problems.push('data-img の無い {{img:}}: ' + noDataImg.length + '件');
  check('7. キーが過不足なく一致 (texts ' + cTexts.size + ' / images ' + cImgs.size + ')', problems.length === 0, problems.join('\n     '));
}

// 8. 新形式なら build-index.js の出力と一致
if (original.includes('data:image/')) {
  console.log('    (index.html は旧版(base64埋め込み)。node worker/build-index.js で新形式を生成できます)');
} else {
  const built = buildFromRepo();
  const i = firstDiff(original, built);
  check('8. index.html が build-index.js の出力と一致', original === built,
    '差分位置 ' + i + ': 現在=' + JSON.stringify(original.slice(i, i + 60)) + ' 生成=' + JSON.stringify(built.slice(i, i + 60)) +
    '\n     node worker/build-index.js で作り直してください');
}

const kb = (s) => (Buffer.byteLength(s, 'utf-8') / 1024).toFixed(1) + ' KB';
console.log('現行 index.html: ' + kb(original) + ' / 生成 index.html: ' + kb(rendered) + ' / テンプレート: ' + kb(template));

if (failed) {
  console.log(failed + ' 件のチェックに失敗しました');
  process.exitCode = 1;
} else {
  console.log('すべてのチェックに合格しました');
}
