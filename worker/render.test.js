// node worker/render.test.js
const assert = require('assert');
const {
  escapeHtml, escapeMultiline, splitPrice, renderPriceCell, telDigits, renderTemplate, listPlaceholders,
} = require('./render');

assert.strictEqual(escapeHtml('A&B <script>'), 'A&amp;B &lt;script&gt;');
assert.strictEqual(escapeMultiline('1行目\n2行目'), '1行目<br>2行目');
assert.strictEqual(escapeMultiline('<b>\n'), '&lt;b&gt;<br>');

assert.deepStrictEqual(splitPrice('¥3,400（¥3,740）'), { main: '¥3,400', taxIncluded: '¥3,740' });
assert.deepStrictEqual(splitPrice('¥3,400(¥3,740)'), { main: '¥3,400', taxIncluded: '¥3,740' });
assert.deepStrictEqual(splitPrice('—'), { main: '—', taxIncluded: null });
assert.strictEqual(renderPriceCell('¥3,400（¥3,740）'), '<span class="v">¥3,400<span class="tax">(¥3,740)</span></span>');
assert.strictEqual(renderPriceCell('—'), '<span class="v">—</span>');
assert.strictEqual(renderPriceCell('A&B（C<D）'), '<span class="v">A&amp;B<span class="tax">(C&lt;D)</span></span>');
assert.strictEqual(renderPriceCell('—', 'price.a.cut'), '<span class="v" data-k="price.a.cut">—</span>');

assert.strictEqual(telDigits('070-1678-1525'), '07016781525');

const tpl =
  '<h1>{{text:hero.heading}}</h1>' +
  '<td>{{price:price.a.set}}</td>' +
  '<a href="tel:{{tel:contact.tel}}">{{text:contact.tel}}</a>' +
  '<img data-img="hero" src="{{img:hero}}" alt="{{plain:hero.alt}}">';
const content = {
  texts: {
    'hero.heading': '大切な家族に、\nやさしく丁寧な',
    'price.a.set': '¥3,400（¥3,740）',
    'contact.tel': '070-1678-1525',
    'hero.alt': 'お店の"外観"',
  },
  images: { hero: 'images/hero.jpg' },
};

const pub = renderTemplate(tpl, content);
assert.ok(pub.includes('<h1>大切な家族に、<br>やさしく丁寧な</h1>'));
assert.ok(pub.includes('<span class="v">¥3,400<span class="tax">(¥3,740)</span></span>'));
assert.ok(pub.includes('href="tel:07016781525">070-1678-1525</a>'));
assert.ok(pub.includes('src="images/hero.jpg"'));
assert.ok(pub.includes('alt="お店の&quot;外観&quot;"'));
assert.ok(!pub.includes('data-k='), '公開用HTMLには編集用の注釈を入れない');

const preview = renderTemplate(tpl, content, {
  annotate: true,
  imageUrl: (key, path) => 'https://example.com/' + path + '?v=abc',
});
assert.ok(preview.includes('<h1><span data-k="hero.heading">大切な家族に、<br>やさしく丁寧な</span></h1>'));
assert.ok(preview.includes('<span class="v" data-k="price.a.set">'));
assert.ok(preview.includes('src="https://example.com/images/hero.jpg?v=abc"'));
assert.ok(preview.includes('href="tel:07016781525"'), 'tel属性には注釈を入れない');
assert.ok(preview.includes('alt="お店の&quot;外観&quot;"'), 'plain属性には注釈を入れない');

assert.strictEqual(renderTemplate('<p>\r\n{{text:hero.alt}}</p>\r\n', content), '<p>\nお店の&quot;外観&quot;</p>\n', 'テンプレートの CRLF は LF に揃える');

// texts をドットで入れ子に辿らず、キー文字列そのもので引くこと
assert.throws(() => renderTemplate('{{text:nope}}', content), /存在しないキー: nope/);
assert.throws(() => renderTemplate('{{img:gallery-1}}', content), /content\.images/);

assert.deepStrictEqual(listPlaceholders('{{text:a.b}} x {{img:hero}}'), [
  { kind: 'text', key: 'a.b' }, { kind: 'img', key: 'hero' },
]);

console.log('render.test.js: all checks passed');
