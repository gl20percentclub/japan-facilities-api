// geocode.js のワーカー分割ロジック（partitionQueries）を検証する。
//
//   node scripts/lib/geocode.test.js

import { partitionQueries } from './geocode.js';

let failures = 0;
/** 条件を検証して結果を出力する（失敗数を数える）。 */
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

console.log('geocode テスト\n');

// --- partitionQueries: 取りこぼし・重複なくソート済み連続チャンクに分ける ---
const queries = [
  '大阪府大阪市北区1', '北海道札幌市中央区1', '大阪府大阪市北区2',
  '東京都港区1', '北海道札幌市中央区2', '東京都港区2', '東京都港区3',
];
const chunks = partitionQueries(queries, 3);
assert(chunks.length === 3, '指定数のチャンクに分かれる');
assert(
  chunks.flat().length === queries.length,
  '全クエリが漏れなくいずれかのチャンクに入る',
);
assert(
  new Set(chunks.flat()).size === queries.length,
  'チャンク間でクエリが重複しない',
);
const sizes = chunks.map((c) => c.length);
assert(
  Math.max(...sizes) - Math.min(...sizes) <= 1,
  `チャンクサイズがほぼ均等（${sizes.join(',')}）`,
);
// ソート後の連続チャンクなので、同じ市区町村（＝同じ接頭辞）は同じチャンクに寄る
const flat = chunks.flat();
assert(
  JSON.stringify(flat) === JSON.stringify([...queries].sort()),
  'チャンクを連結するとソート済みの全クエリ列になる（市区町村単位でまとまる）',
);

// --- 端数ケース ---
assert(
  partitionQueries(['a'], 4).flat().length === 1 &&
    partitionQueries(['a'], 4).every((c) => c.length > 0),
  'クエリ数がワーカー数未満でも空チャンクを作らない',
);
assert(partitionQueries([], 4).length === 0, '空入力は空配列を返す');

if (failures > 0) {
  console.error(`\n❌ ${failures}件のチェックに失敗`);
  process.exit(1);
}
console.log('\n✅ geocode テストに合格');
