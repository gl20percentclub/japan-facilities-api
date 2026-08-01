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
  prefCsv: { files: 47, records: 1495048, unassigned: 0, bytes: 538 * 1024 * 1024 },
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
assert(md.includes('| 都道府県別CSV | 47 ファイル / 約 538.0 MB |'), '都道府県別CSV のファイル数とサイズが出る');
assert(md.includes('| ベクトルタイル | 12,345 枚 / 約 250.0 MB |'), 'タイル枚数とサイズが出る');

assert(
  !md.includes('市区町村を特定できない施設'),
  '特定できない施設が0件ならその行を出さない',
);

// 市区町村を特定できないレコードがある場合は、異なり数と別に件数を出す。
const withUnknown = renderStats({ ...fixed, csv: { ...fixed.csv, cityUnknown: 61234 } });
assert(
  withUnknown.includes('| うち市区町村を特定できない施設 | 61,234 件 |'),
  '特定できない施設の件数を別行で出す',
);
assert(withUnknown.includes('| 市区町村 | 1,741 |'), '異なり数には数えない');

// prefCsv を渡さない場合は都道府県別CSV の行を出さない（旧形式の統計でも壊れないこと）。
const noPref = renderStats({ ...fixed, prefCsv: undefined });
assert(!noPref.includes('都道府県別CSV'), 'prefCsv が無ければ都道府県別CSV の行を出さない');

// updated が無い場合はダッシュ表記。
const noDate = renderStats({ ...fixed, updated: 0 });
assert(noDate.includes('最終更新: —'), 'updated が無ければ — を出す');

if (failures > 0) {
  console.error(`\n❌ ${failures}件のチェックに失敗`);
  process.exit(1);
}
console.log('\n✅ gen-readme-stats テストに合格');
