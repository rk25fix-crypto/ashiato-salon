// index.template.html + data/content.json から公開用 index.html を生成して書き出す。
// 使い方: node worker/build-index.js
//
// Worker の renderPublic(src/lib.js)と同じ出力: 注釈なし、content.images の画像に ?v=<blob sha>。
// Worker は GitHub の blob sha を使うが、ここではローカルのファイルから同じ値(git hash-object)を計算する。
// (両者が一致することは worker.test.mjs で確認している)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { renderTemplate } = require('./render.js');

const root = path.join(__dirname, '..');

// git の blob sha = sha1("blob <バイト数>\0" + 中身)。git hash-object と同じ値。
function gitBlobSha(bytes) {
  return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function buildIndex(template, content, blobSha) {
  return renderTemplate(template, content, { imageUrl: (_key, p) => `${p}?v=${blobSha(p)}` });
}

function buildFromRepo() {
  const read = (p) => fs.readFileSync(path.join(root, p));
  return buildIndex(
    read('index.template.html').toString('utf-8'),
    JSON.parse(read('data/content.json').toString('utf-8')),
    (p) => gitBlobSha(read(p))
  );
}

if (require.main === module) {
  const html = buildFromRepo();
  fs.writeFileSync(path.join(root, 'index.html'), html);
  console.log('index.html を生成しました (' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB)');
}

module.exports = { gitBlobSha, buildIndex, buildFromRepo };
