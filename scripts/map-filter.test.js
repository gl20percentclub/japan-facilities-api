// 地図ページ(map.html)の業種フィルターの整合性テスト。
//   node scripts/map-filter.test.js
//
// 業種の分類は食品衛生法の定義（営業許可32業種＋営業届出の業種）に合わせている。
// ここでは次を固定する:
//   1. 許可32業種が漏れなく選択肢にあること（法令の定義そのもの）
//   2. 実データに現れる業種表記が、期待どおりの業種に割り当たること
//      （元データは自治体ごとに表記がゆれるため、部分一致キーワードで判定している）
//   3. 業種の記載なしを「その他」と混ぜないこと
//
// 検索機能は廃止した（検索 API は未公開）。復活していないこともここで固定する。
// 旧 playground.html は map.html へのリダイレクトだけを残してある。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'site', 'map.html'), 'utf-8');
const PLAYGROUND = fs.readFileSync(path.join(ROOT, 'site', 'playground.html'), 'utf-8');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/**
 * map.html の CATEGORY_GROUPS 定義を読み出す（区分 → 業種 の入れ子配列）。
 * ページ内のリテラルをそのまま評価して、定義とテストがズレないようにする。
 */
function readGroups() {
  const m = HTML.match(/const CATEGORY_GROUPS = (\[[\s\S]*?\n {4}\]);/);
  assert.ok(m, 'map.html に CATEGORY_GROUPS が定義されている');
  // 定義はプレーンなオブジェクトリテラル（関数・参照を含まない）なので評価してよい。
  return new Function(`return ${m[1]}`)();
}

const GROUPS = readGroups();
const TYPES = GROUPS.flatMap((g) => g.types.map((t) => ({ ...t, group: g.id })));

// --- 食品衛生法施行令 第35条の営業許可 32業種（2021年6月1日施行） ---
// 出典: 福島市「営業許可業種・営業届出業種」
// https://www.city.fukushima.fukushima.jp/soshiki/9/1046/2/1/3014.html
// 「複合型そうざい製造業」「複合型冷凍食品製造業」は、そうざい製造業・冷凍食品製造業の
// キーワードで一緒に拾えるため、選択肢としては分けていない。
const LICENSED_TYPES = [
  '飲食店営業',
  '調理の機能を有する自動販売機',
  '食肉販売業',
  '魚介類販売業',
  '魚介類競り売り営業',
  '集乳業',
  '乳処理業',
  '特別牛乳搾取処理業',
  '食肉処理業',
  '食品の放射線照射業',
  '菓子製造業',
  'アイスクリーム類製造業',
  '乳製品製造業',
  '清涼飲料水製造業',
  '食肉製品製造業',
  '水産製品製造業',
  '氷雪製造業',
  '液卵製造業',
  '食用油脂製造業',
  'みそ又はしょうゆ製造業',
  '酒類製造業',
  '豆腐製造業',
  '納豆製造業',
  '麺類製造業',
  'そうざい製造業',
  '冷凍食品製造業',
  '漬物製造業',
  '密封包装食品製造業',
  '食品の小分け業',
  '添加物製造業',
];
// 許可業種を置く区分（法令の並び順どおり）。
const LICENSED_GROUPS = ['cooking', 'sale', 'processing', 'manufacture'];

// 配信中の全件CSV に実際に現れる業種表記 → 割り当たってほしい業種ラベル。
// （約15万行のサンプル集計から、件数の多いものと表記のゆれが大きいものを抜粋）
const REAL_TO_TYPE = [
  ['飲食店営業', '飲食店営業'],
  ['① 飲食店営業', '飲食店営業'],
  ['飲食店営業(1)一般食堂・レストラン等', '飲食店営業'],
  ['飲食店（バー）', '飲食店営業'],
  ['飲食店（屋台型臨時営業）', '飲食店営業'],
  ['② 調理機能を有する自動販売機（要許可）', '調理の機能を有する自動販売機'],
  ['③ 食肉販売業', '食肉販売業'],
  ['② 食肉販売業（包装済みの食肉のみの販売）', '食肉販売業'],
  ['魚介類販売業', '魚介類販売業'],
  ['魚介類せり売り営業', '魚介類競り売り営業'],
  ['食肉処理業', '食肉処理業'],
  ['⑪ 菓子製造業', '菓子製造業'],
  ['アイスクリーム類製造業', 'アイスクリーム類製造業'],
  ['⑯ 水産製品製造業', '水産製品製造業'],
  ['清涼飲料水製造業', '清涼飲料水製造業'],
  ['みそ製造業', 'みそ又はしょうゆ製造業'],
  ['めん類製造業', '麺類製造業'],
  ['㉕ そうざい製造業', 'そうざい製造業'],
  ['㉙ 漬物製造業', '漬物製造業'],
  ['㉚ 密封包装食品製造業', '密封包装食品製造業'],
  ['㉛ 食品の小分け業', '食品の小分け業'],
  ['③ 乳類販売業', '乳類販売業'],
  ['⑤ コップ式自動販売機（自動洗浄・屋内設置）', 'コップ式自動販売機'],
  ['⑥ 弁当販売業', '弁当販売業'],
  ['飲食店営業(2)仕出し屋・弁当屋', '飲食店営業'],
  ['⑦ 野菜果物販売業', '野菜果物販売業'],
  ['⑧ 米穀類販売業', '米穀類販売業'],
  ['⑩ コンビニエンスストア', 'コンビニエンスストア'],
  ['⑪ 百貨店、総合スーパー', '百貨店、総合スーパー'],
  ['⑬ その他の食料・飲料販売業', 'その他の食料・飲料販売業'],
  ['㉖ 集団給食施設', '集団給食施設'],
  ['㉕ 行商', '行商'],
  ['⑯ コーヒー製造・加工業（飲料の製造を除く。）', 'コーヒー製造・加工業'],
  ['⑰ 農産保存食料品製造・加工業', '農産保存食料品製造・加工業'],
  ['⑱ 調味料製造・加工業', '調味料製造・加工業'],
  ['⑳ 精穀・製粉業', '精穀・製粉業'],
  ['㉑ 製茶業', '製茶業'],
  ['㉓ 卵選別包装業', '卵選別包装業'],
  ['㉔ その他の食料品製造・加工業', 'その他の食料品製造・加工業'],
  ['食品の冷凍又は冷蔵業', '食品の冷凍又は冷蔵業'],
  ['喫茶店営業', '喫茶店営業'],
  ['ソース類製造業', 'ソース類製造業'],
  ['缶詰又は瓶詰食品製造業', '缶詰又は瓶詰食品製造業'],
  ['魚肉ねり製品製造業', '魚肉ねり製品製造業'],
];

// 法令の区分に当てはめず「その他」に落とす表記（サンプルでは全体の 0.3% 未満）。
const OTHER_BUSINESS_TYPES = [
  '㉙ その他',
  '許可届出不要その他の営業(ボランティア食等)',
  '魚介類加工業',
];

/** business_type に対して最初に一致した業種を返す（map.html の判定順と同じ）。 */
function classify(businessType) {
  for (const type of TYPES) {
    if (type.keywords.some((kw) => businessType.includes(kw))) return type.label;
  }
  return null;
}

test('営業許可32業種が漏れなく選択肢にある', () => {
  const labels = TYPES.filter((t) => LICENSED_GROUPS.includes(t.group)).map((t) => t.label);
  for (const name of LICENSED_TYPES) {
    assert.ok(labels.includes(name), `許可業種「${name}」が選択肢にある`);
  }
});

test('区分・業種の定義が { id, label, keywords } の形で並んでいる', () => {
  const ids = TYPES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, '業種 id が重複していない');
  const groupIds = GROUPS.map((g) => g.id);
  assert.equal(new Set(groupIds).size, groupIds.length, '区分 id が重複していない');
  for (const t of TYPES) {
    assert.ok(t.label, `${t.id} に label がある`);
    assert.ok(Array.isArray(t.keywords) && t.keywords.length, `${t.id} に keywords がある`);
  }
  // 届出業種・旧法業種の区分も用意する（許可業種だけでは実データを分類しきれない）。
  for (const id of [...LICENSED_GROUPS, 'notified', 'legacy']) {
    assert.ok(groupIds.includes(id), `区分 ${id} がある`);
  }
});

test('実データの業種表記が期待どおりの業種に割り当たる', () => {
  for (const [businessType, expected] of REAL_TO_TYPE) {
    assert.equal(classify(businessType), expected, `「${businessType}」→「${expected}」`);
  }
});

test('区分に当てはまらない表記は「その他」に落ちる', () => {
  for (const businessType of OTHER_BUSINESS_TYPES) {
    assert.equal(classify(businessType), null, `「${businessType}」がその他に落ちる`);
  }
});

test('業種の記載なしを「その他」と混ぜない', () => {
  // 自治体によっては業種欄が無く（都心部では多数派）、空文字を「その他」に混ぜると
  // 分類が実態とズレる。空文字は unknown だけが拾う構造を固定する。
  assert.ok(
    /const hasBusinessType = \['!=', \['get', 'business_type'\], ''\]/.test(HTML),
    '業種の記載有無を判定する式がある',
  );
  assert.ok(/if \(value === 'unknown'\) return \['!', hasBusinessType\]/.test(HTML),
    'unknown は記載なしだけを拾う');
  assert.ok(/return \['all', hasBusinessType, \.\.\.ALL_KEYWORDS/.test(HTML),
    'other は記載ありに限定する');
});

test('フィルターがタイルの business_type 属性を見ている', () => {
  // 属性名が gen-tiles の出力とズレると、絞り込みが全件0件になる。
  assert.ok(/\['get', 'business_type'\]/.test(HTML), "['get', 'business_type'] で属性を読む");
  assert.ok(/setFilter\('facilities-circle'/.test(HTML), 'facilities-circle レイヤに setFilter する');
});

test('選択肢は定義から組み立てる（定義の二重管理をしない）', () => {
  // <option> をベタ書きすると定義とラベルがズレるため、DOM 生成であることを固定する。
  assert.ok(/for \(const group of CATEGORY_GROUPS\)/.test(HTML), 'CATEGORY_GROUPS から選択肢を生成する');
  assert.ok(/createElement\('optgroup'\)/.test(HTML), '法令の区分ごとに optgroup で束ねる');
  assert.ok(!/<option /.test(HTML), 'HTML に <option> をベタ書きしていない');
});

test('検索機能を持たない（検索 API は未公開のため）', () => {
  for (const gone of ['DEFAULT_API_URL', 'geosearch', "get('api')", 'body.results', 'downloadCsv']) {
    assert.ok(!HTML.includes(gone), `map.html が ${gone} を持たない`);
  }
});

test('旧 playground.html が map.html へリダイレクトする', () => {
  assert.ok(
    /http-equiv="refresh"[^>]*url=\.\/map\.html/.test(PLAYGROUND),
    'playground.html が map.html へ meta refresh する',
  );
  assert.ok(
    /rel="canonical" href="\.\/map\.html"/.test(PLAYGROUND),
    'playground.html が map.html を canonical に指す',
  );
});

// 廃止した配信形式や、このリポジトリには無いエンドポイントを参照していないこと。
test('廃止した配信形式・存在しないエンドポイントを参照していない', () => {
  for (const gone of ['facilities/index.json', 'search-index', '/data.json', 'api/parquet']) {
    assert.ok(!HTML.includes(gone), `map.html が ${gone} を参照していない`);
  }
});

console.log(`\n✅ 地図ページ 業種フィルター テスト: ${passed}件すべて合格`);
