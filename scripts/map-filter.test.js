// 地図ページ(map.html)の業種フィルターの整合性テスト。
//   node scripts/map-filter.test.js
//
// map.html はベクトルタイルの business_type にキーワード部分一致をかけて業種を
// 絞り込む。元データの業種表記は自治体ごとにゆれが大きく統一コードも無いため、
// 「どのキーワードで束ねるか」がこのページの仕様そのものになる。
// ここではカテゴリ定義の形と、実データに現れる代表的な業種表記がどれかのカテゴリに
// 必ず入ることを固定する。表記が増えて取りこぼしたらこのテストで気づけるようにする。
//
// 検索機能は廃止した（検索 API は未公開）。復活していないこともここで固定する。
// 旧 playground.html は map.html へのリダイレクトだけを残してある。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'map.html'), 'utf-8');
const PLAYGROUND = fs.readFileSync(path.join(ROOT, 'playground.html'), 'utf-8');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/**
 * map.html の CATEGORIES 定義を読み出す（{ id, label, keywords } の配列）。
 * ページ内のリテラルをそのまま評価して、定義とテストがズレないようにする。
 */
function readCategories() {
  const m = HTML.match(/const CATEGORIES = (\[[\s\S]*?\n {4}\]);/);
  assert.ok(m, 'map.html に CATEGORIES が定義されている');
  // 定義はプレーンなオブジェクトリテラル（関数・参照を含まない）なので評価してよい。
  return new Function(`return ${m[1]}`)();
}

const CATEGORIES = readCategories();

// 配信中の全件CSV に実際に現れる業種表記の代表例（サンプル集計から抜粋）。
// 「どのカテゴリにも入らない」表記が増えたら、その他カテゴリ扱いになる前に気づきたい。
const REAL_BUSINESS_TYPES = [
  '飲食店営業',
  '① 飲食店営業',
  '飲食店営業(1)一般食堂・レストラン等',
  '飲食店営業（5）簡易な営業',
  '喫茶店営業',
  '⑯ コーヒー製造・加工業（飲料の製造を除く。）',
  '菓子製造業',
  '⑪ 菓子製造業',
  'アイスクリーム類製造業',
  '食肉販売業',
  '② 食肉販売業（包装済みの食肉のみの販売）',
  '魚介類販売業',
  '水産製品製造業',
  'そうざい製造業',
  '飲食店営業(2)仕出し屋・弁当屋',
  '⑥ 弁当販売業',
  '㉖ 集団給食施設',
  '⑩ コンビニエンスストア',
  '⑪ 百貨店、総合スーパー',
  '⑬ その他の食料・飲料販売業',
  '清涼飲料水製造業',
  '食肉処理業',
];

// 逆に、意図して「その他の業種」に落とす表記（サンプル集計では全体の 0.7% ほど）。
// 名前付きカテゴリに吸われ始めたら分類が雑になった合図なので、こちらも固定する。
const OTHER_BUSINESS_TYPES = [
  '食品の冷凍又は冷蔵業',
  '食品の小分け業',
  '㉑ 製茶業',
  '⑳ 精穀・製粉業',
  '㉕ 行商',
  '㉓ 卵選別包装業',
];

/** business_type がカテゴリのキーワードに部分一致するか（map.html の contains と同じ判定）。 */
function matches(category, businessType) {
  return (category.keywords || []).some((kw) => businessType.includes(kw));
}

test('カテゴリ定義が { id, label, keywords } の形で並んでいる', () => {
  assert.ok(CATEGORIES.length >= 5, `カテゴリが十分ある (${CATEGORIES.length}件)`);
  for (const c of CATEGORIES) {
    assert.ok(typeof c.id === 'string' && c.id, 'id がある');
    assert.ok(typeof c.label === 'string' && c.label, `${c.id} に label がある`);
    assert.ok(c.keywords === null || Array.isArray(c.keywords), `${c.id} の keywords が配列か null`);
  }
  const ids = CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'id が重複していない');
  // 絞り込み無し（all）、分類から漏れた業種（other）、業種の記載なし（unknown）は必ず用意する。
  assert.ok(CATEGORIES.some((c) => c.id === 'all' && c.keywords === null), '絞り込み無しの all がある');
  assert.ok(CATEGORIES.some((c) => c.id === 'other'), '取りこぼし用の other がある');
  assert.ok(CATEGORIES.some((c) => c.id === 'unknown'), '業種の記載なし用の unknown がある');
});

test('業種の記載なしを「その他」と混ぜない', () => {
  // 自治体によっては業種欄が無く（都心部では多数派）、空文字を「その他の業種」に
  // 混ぜると分類が実態とズレる。空文字は unknown だけが拾う構造を固定する。
  assert.ok(
    /const hasBusinessType = \['!=', \['get', 'business_type'\], ''\]/.test(HTML),
    '業種の記載有無を判定する式がある',
  );
  assert.ok(/if \(category\.id === 'unknown'\) return \['!', hasBusinessType\]/.test(HTML),
    'unknown は記載なしだけを拾う');
  assert.ok(/return \['all', hasBusinessType, \.\.\.allKeywords/.test(HTML),
    'other は記載ありに限定する');
});

test('実データの代表的な業種表記がどれかのカテゴリに入る', () => {
  // all / other は判定対象外（other は「どれにも入らないもの」の受け皿）。
  const named = CATEGORIES.filter((c) => c.id !== 'all' && c.id !== 'other');
  for (const businessType of REAL_BUSINESS_TYPES) {
    const hit = named.filter((c) => matches(c, businessType)).map((c) => c.id);
    assert.ok(hit.length > 0, `「${businessType}」がどれかのカテゴリに入る`);
  }
});

test('分類しないと決めた業種表記が「その他」に落ちる', () => {
  const named = CATEGORIES.filter((c) => c.id !== 'all' && c.id !== 'other');
  for (const businessType of OTHER_BUSINESS_TYPES) {
    const hit = named.filter((c) => matches(c, businessType)).map((c) => c.id);
    assert.equal(hit.length, 0, `「${businessType}」がその他に落ちる (今は ${hit.join(',') || 'なし'})`);
  }
});

test('フィルターがタイルの business_type 属性を見ている', () => {
  // 属性名が gen-tiles の出力とズレると、絞り込みが全件0件になる。
  assert.ok(/\['get', 'business_type'\]/.test(HTML), "['get', 'business_type'] で属性を読む");
  assert.ok(/setFilter\('facilities-circle'/.test(HTML), 'facilities-circle レイヤに setFilter する');
});

test('選択肢はカテゴリ定義から組み立てる（定義の二重管理をしない）', () => {
  // <option> をベタ書きすると定義とラベルがズレるため、DOM 生成であることを固定する。
  assert.ok(/for \(const category of CATEGORIES\)/.test(HTML), 'CATEGORIES から option を生成する');
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
