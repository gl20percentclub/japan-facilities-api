// gen-readme-stats.js の整形ロジックを検証する。
// renderStats() は純粋関数なので固定入力で検証する。
//
//   node scripts/gen-readme-stats.test.js

import { renderStats } from './gen-readme-stats.js';

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

console.log('gen-readme-stats テスト\n');

const fixed = {
  updated: 1783366001, // 2026-07-06
  csv: {
    rowsOut: 1495048,
    prefectures: 47,
    cities: 1741,
    bytes: 540 * 1024 * 1024,
  },
  tiles: { tiles: 12345, points: 1106198, bytes: 250 * 1024 * 1024 },
};
const md = renderStats(fixed);

assert(md.includes('最終更新: 2026-07-06'), 'updated が日付に整形される');
assert(md.includes('| 施設レコード数 | 1,495,048 件 |'), '施設レコード数が3桁区切りで出る');
assert(md.includes('| 座標を持つ施設 | 1,106,198 件 |'), '座標ありの件数が出る');
assert(md.includes('| 都道府県 | 47 |'), '都道府県数が出る');
assert(md.includes('| 市区町村 | 1,741 |'), '市区町村数が出る');
assert(md.includes('| 結合CSV | 約 540.0 MB |'), 'CSV サイズが出る');
assert(!md.includes('gzip'), 'gzip 表記は出さない（非圧縮CSVのみ配布）');
assert(md.includes('| ベクトルタイル | 12,345 枚 / 約 250.0 MB |'), 'タイル枚数とサイズが出る');

// updated が無い場合はダッシュ表記。
const noDate = renderStats({ ...fixed, updated: 0 });
assert(noDate.includes('最終更新: —'), 'updated が無ければ — を出す');

if (failures > 0) {
  console.error(`\n❌ ${failures}件のチェックに失敗`);
  process.exit(1);
}
console.log('\n✅ gen-readme-stats テストに合格');
