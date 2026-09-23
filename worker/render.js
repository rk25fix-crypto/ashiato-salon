// 共通レンダリング関数。移行スクリプト(Node)とWorker(esbuildバンドル)の両方から使う。
// 外部依存なし。CommonJS形式を維持すること(Node側のテスト・検証スクリプトが依存)。
//
// content.json は { texts: { <key>: string }, images: { <key>: path } } の2つだけ。
// テンプレートのプレースホルダ:
//   {{text:KEY}}   texts[KEY] を要素の中身として出力(エスケープ+改行→<br>)
//   {{price:KEY}}  texts[KEY] を料金セルとして出力(本体と「（税込）」を分離)
//   {{plain:KEY}}  texts[KEY] を属性値などに出力(エスケープのみ、注釈なし)
//   {{tel:KEY}}    texts[KEY] から数字と+だけ取り出す(href="tel:..." 用)
//   {{img:KEY}}    images[KEY] の画像パス(src属性用)
// KEY はドット区切りの1文字列(例 "hero.lead")。texts の中を入れ子で辿るのではなく、
// そのままの文字列をキーとして引く。

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// エスケープを先、<br>への変換を後に行うこと(逆順だと<br>自体がエスケープされる)。
function escapeMultiline(s) {
  return escapeHtml(s).replace(/\r\n|\r|\n/g, '<br>');
}

// "¥3,400（¥3,740）" → { main: "¥3,400", taxIncluded: "¥3,740" }
// 括弧が無い値("—" など)は taxIncluded=null。
const PRICE_PATTERN = /^(.*?)\s*[（(]([^）)]*)[）)]\s*$/;
function splitPrice(value) {
  const s = String(value).trim();
  const m = s.match(PRICE_PATTERN);
  if (!m) return { main: s, taxIncluded: null };
  return { main: m[1].trim(), taxIncluded: m[2].trim() };
}

function renderPriceCell(value, key) {
  const { main, taxIncluded } = splitPrice(value);
  const attr = key ? ' data-k="' + escapeHtml(key) + '"' : '';
  const tax = taxIncluded === null ? '' : '<span class="tax">(' + escapeHtml(taxIncluded) + ')</span>';
  return '<span class="v"' + attr + '>' + escapeHtml(main) + tax + '</span>';
}

function telDigits(s) {
  return String(s).replace(/[^0-9+]/g, '');
}

function lookup(map, mapName, key) {
  if (!map || !Object.prototype.hasOwnProperty.call(map, key)) {
    throw new Error('content.' + mapName + ' に存在しないキー: ' + key);
  }
  return map[key];
}

const PLACEHOLDER_RE = /\{\{(text|price|plain|tel|img):([A-Za-z0-9_.\-]+)\}\}/g;

// opts.annotate: true にすると編集画面のプレビュー用に、編集可能なテキストへ
//   data-k="KEY" を付ける(text は <span data-k> で包み、price は .v に属性を付ける)。
//   公開用の index.html を生成する時は false(既定)。
// opts.imageUrl(key, path): 画像パスを差し替える関数(キャッシュ回避用のクエリ付与、
//   プレビューでの絶対URL化など)。既定は path をそのまま返す。
function renderTemplate(template, content, opts) {
  const o = opts || {};
  const annotate = !!o.annotate;
  const imageUrl = o.imageUrl || function (_key, path) { return path; };
  // 改行は LF に揃える。Windows(core.autocrlf)だとテンプレートの作業コピーが CRLF になり、
  // Worker に同梱されるテンプレートとリポジトリ内の index.html(LF)がずれて、GET /content の自己修復が
  // 毎回走ってしまうため。
  return template.replace(/\r\n/g, '\n').replace(PLACEHOLDER_RE, function (_, kind, key) {
    if (kind === 'img') return escapeHtml(imageUrl(key, lookup(content.images, 'images', key)));
    const value = lookup(content.texts, 'texts', key);
    if (kind === 'text') {
      const html = escapeMultiline(value);
      return annotate ? '<span data-k="' + escapeHtml(key) + '">' + html + '</span>' : html;
    }
    if (kind === 'price') return renderPriceCell(value, annotate ? key : null);
    if (kind === 'plain') return escapeHtml(value);
    return escapeHtml(telDigits(value)); // tel
  });
}

// テンプレートが参照しているキーの一覧(検証・テスト用)。
function listPlaceholders(template) {
  const out = [];
  let m;
  const re = new RegExp(PLACEHOLDER_RE.source, 'g');
  while ((m = re.exec(template)) !== null) out.push({ kind: m[1], key: m[2] });
  return out;
}

module.exports = {
  escapeHtml,
  escapeMultiline,
  splitPrice,
  renderPriceCell,
  telDigits,
  renderTemplate,
  listPlaceholders,
};
