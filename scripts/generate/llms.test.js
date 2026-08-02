// gen-llms.js の整形ロジックを検証する。
// renderLlmsTxt() / renderLlmsFullTxt() / extractStats() / absolutizeLinks() は
// 純粋関数なので固定入力で検証する。
//
//   node scripts/generate/llms.test.js

import {
  extractStats,
  absolutizeLinks,
  stripHtmlNoise,
  renderLlmsTxt,
  renderLlmsFullTxt,
} from './llms.js';

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

console.log('llms.txt 生成 テスト\n');

// テスト用の README（統計ブロック・相対リンク・バッジを含む最小構成）
const readme = `<div align="center">

# 🍽️ Japan Food Facilities Data

[![Contributors](https://img.shields.io/github/contributors/x)](https://github.com/x)

</div>

## 概要

<!-- STATS:START -->
> **最終更新: 2026-07-24**
>
> | 項目 | 値 |
> |---|---|
> | 施設レコード数 | 1,495,048 件 |
<!-- STATS:END -->

詳細は [収録状況](docs/COVERAGE.md) と [出典表示](attribution.html) と
[外部リンク](https://example.com/page) と [節](#概要) を参照。
`;

// --- extractStats ---
const stats = extractStats(readme);
assert(stats.includes('| 施設レコード数 | 1,495,048 件 |'), '統計テーブルが抽出される');
assert(!stats.includes('> '), 'blockquote の接頭辞が除去される');
assert(extractStats('マーカー無し') === '', 'マーカーが無ければ空文字列を返す');

// --- absolutizeLinks ---
const abs = absolutizeLinks(readme);
assert(
  abs.includes('](https://raw.githubusercontent.com/gl20percentclub/japan-food-facilities/main/docs/COVERAGE.md)'),
  '.md への相対リンクは GitHub raw に変換される',
);
assert(
  abs.includes('](https://gl20percentclub.github.io/japan-food-facilities/attribution.html)'),
  '.html への相対リンクは Pages に変換される',
);
assert(abs.includes('](https://example.com/page)'), '絶対 URL は変換されない');
assert(abs.includes('](#概要)'), 'ページ内アンカーは変換されない');

// --- stripHtmlNoise ---
const stripped = stripHtmlNoise(readme);
assert(!stripped.includes('img.shields.io'), 'バッジ行が除去される');
assert(!stripped.includes('<div'), 'div タグ行が除去される');
assert(stripped.includes('# 🍽️ Japan Food Facilities Data'), '見出しは残る');
assert(!/\n{3,}/.test(stripped), '3連以上の空行が残らない');

// --- renderLlmsTxt ---
const llms = renderLlmsTxt(readme);
assert(llms.startsWith('# Japan Food Facilities Data'), 'H1 で始まる（llms.txt 仕様）');
assert(llms.split('\n')[2].startsWith('> '), 'H1 直後に blockquote の要約がある');
// データ（api/）は独自ドメインで配信。Pages のホストを指していたら張り替え漏れなので落とす。
assert(
  llms.includes('https://food.japan-facilities.com/api/facilities-all.csv'),
  'CSV の URL は配信用の独自ドメインを指す',
);
assert(!llms.includes('facilities-all.csv.gz'), '配信していない gzip 版を案内しない');
assert(llms.includes('{z}/{x}/{y}.pbf'), 'タイルの URL テンプレートが載る');
assert(
  !llms.includes('gl20percentclub.github.io/japan-food-facilities/api/'),
  'データの URL に Pages のホストが残っていない',
);
assert(llms.includes('| 施設レコード数 | 1,495,048 件 |'), 'README の統計が埋め込まれる');
assert(llms.includes('llms-full.txt'), 'llms-full.txt へのリンクがある');

// --- renderLlmsFullTxt ---
const full = renderLlmsFullTxt(readme);
assert(full.includes('自動生成されています'), '自動生成の注意書きがある');
assert(!full.includes('img.shields.io'), 'バッジが除去されている');
assert(full.includes('raw.githubusercontent.com'), 'リンクが絶対 URL 化されている');
assert(full.includes('AI エージェント向け利用レシピ'), '利用レシピの付録がある');
assert(full.includes('read_csv_auto'), 'DuckDB のコード例がある');
assert(full.includes("'source-layer': 'facilities'"), 'MapLibre のコード例がある');

if (failures > 0) {
  console.error(`\n❌ ${failures}件のチェックに失敗`);
  process.exit(1);
}
console.log('\n✅ llms.txt 生成 テストに合格');
