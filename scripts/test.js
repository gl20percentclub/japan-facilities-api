// 生成した配信物が正しいことを確認するバリデーションスクリプト。
//
// 検証対象は配信する2形式だけ:
//   api/facilities-all.csv[.gz]   全件の結合CSV
//   api/tiles/{z}/{x}/{y}.pbf     ベクトルタイル + metadata.json（TileJSON）
//
//   node scripts/test.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSV_COLUMNS } from './build-merged-csv.js';
import { readCsvRows } from './lib/csv-read.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'api');
const CSV_PATH = path.join(API_DIR, 'facilities-all.csv');
const TILES_DIR = path.join(API_DIR, 'tiles');

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

console.log('配信物バリデーション\n');

// --- 1. 結合CSV -------------------------------------------------------------
assert(fs.existsSync(CSV_PATH), 'api/facilities-all.csv が存在する');
if (!fs.existsSync(CSV_PATH)) {
  console.error('\n❌ 結合CSV が無いため中断');
  process.exit(1);
}

const col = Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, i]));
let rowCount = 0;
let withCoords = 0;
let header = null;
const prefs = new Set();
const cities = new Set();
// 同種のエラーで何万行も出力しないよう、種類ごとに最初の数件だけ報告する。
const reported = new Map();
function reportOnce(kind, msg) {
  const n = (reported.get(kind) || 0) + 1;
  reported.set(kind, n);
  if (n <= 3) {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

for (const row of readCsvRows(CSV_PATH)) {
  if (header === null) {
    header = row;
    continue;
  }
  rowCount++;

  if (row.length !== CSV_COLUMNS.length) {
    reportOnce('cols', `${rowCount}行目: 列数が ${row.length}（期待 ${CSV_COLUMNS.length}）`);
    continue;
  }

  const pref = row[col.prefecture];
  const city = row[col.city];
  if (!pref) reportOnce('pref', `${rowCount}行目: prefecture が空`);
  if (!city) reportOnce('city', `${rowCount}行目: city が空`);
  prefs.add(pref);
  cities.add(`${pref}/${city}`);

  // 座標: 両方空か、両方が日本の範囲内の数値であること。
  const latRaw = row[col.lat];
  const lngRaw = row[col.lng];
  if (latRaw !== '' || lngRaw !== '') {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 20 || lat > 46 || lng < 122 || lng > 154) {
      reportOnce('coord', `${rowCount}行目: 不正な座標 (${latRaw}, ${lngRaw}) - ${row[col.name]}`);
    } else {
      withCoords++;
    }
  }

  // geocoding_level は空 または 1〜8 の整数。
  const lv = row[col.geocoding_level];
  if (lv !== '' && !(Number.isInteger(Number(lv)) && Number(lv) >= 1 && Number(lv) <= 8)) {
    reportOnce('level', `${rowCount}行目: 不正な geocoding_level (${lv})`);
  }
}

assert(
  JSON.stringify(header) === JSON.stringify(CSV_COLUMNS),
  `CSV ヘッダーが定義どおり（${CSV_COLUMNS.length}列）`,
);
assert(
  !fs.readFileSync(CSV_PATH, { encoding: 'utf-8', start: 0, end: 3 }).startsWith('﻿'),
  'CSV が BOM なし UTF-8',
);
assert(rowCount > 0, `CSV にレコードがある (${rowCount.toLocaleString('en-US')}件)`);
assert(withCoords > 0, `座標を持つレコードがある (${withCoords.toLocaleString('en-US')}件)`);
assert(prefs.size >= 1, `都道府県が1件以上ある (${prefs.size})`);
for (const [kind, n] of reported) {
  if (n > 3) console.error(`  … ${kind} のエラーは他に ${n - 3} 件`);
}

// 配布は非圧縮CSV のみ。gzip 版が残っていると配信物が二重になるため、無いことを確認する。
assert(!fs.existsSync(`${CSV_PATH}.gz`), 'api/facilities-all.csv.gz を配信しない');

// --- 2. ベクトルタイル ------------------------------------------------------
const metaPath = path.join(TILES_DIR, 'metadata.json');
assert(fs.existsSync(metaPath), 'api/tiles/metadata.json が存在する');
if (fs.existsSync(metaPath)) {
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  assert(meta.format === 'pbf', 'metadata.json の format が pbf');
  assert(
    Array.isArray(meta.tiles) && meta.tiles[0] === '{z}/{x}/{y}.pbf',
    'metadata.json の tiles テンプレートが {z}/{x}/{y}.pbf',
  );
  assert(meta.vector_layers?.[0]?.id === 'facilities', 'レイヤ facilities が定義されている');
  assert(
    Number.isInteger(meta.minzoom) && Number.isInteger(meta.maxzoom) && meta.minzoom <= meta.maxzoom,
    `ズーム範囲が妥当 (z${meta.minzoom}-${meta.maxzoom})`,
  );
  assert(meta.stats?.records === rowCount, `metadata.stats.records(${meta.stats?.records}) が CSV 行数と一致`);
  assert(meta.stats?.points === withCoords, `metadata.stats.points(${meta.stats?.points}) が座標ありレコード数と一致`);

  // 最小ズームのタイルが1枚以上あり、非空であること。
  const zDir = path.join(TILES_DIR, String(meta.minzoom));
  const pbfs = fs.existsSync(zDir)
    ? fs.readdirSync(zDir).flatMap((x) => fs.readdirSync(path.join(zDir, x)).map((y) => path.join(zDir, x, y)))
    : [];
  assert(pbfs.length > 0, `z${meta.minzoom} のタイルが存在する (${pbfs.length}枚)`);
  assert(pbfs.every((p) => fs.statSync(p).size > 0), 'タイルがすべて非空である');
}

console.log(
  `\nレコード: ${rowCount.toLocaleString('en-US')}件 / ${cities.size}市区町村 / ${prefs.size}都道府県`,
);
console.log(`座標あり: ${withCoords.toLocaleString('en-US')}件 (${((withCoords / rowCount) * 100).toFixed(1)}%)`);

if (failures > 0) {
  console.error(`\n❌ ${failures}件のチェックに失敗`);
  process.exit(1);
}
console.log('\n✅ すべてのバリデーションに合格');
