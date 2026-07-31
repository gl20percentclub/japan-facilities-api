// 検索プレイグラウンド(playground.html)と gen-parquet.js の生成物との整合性テスト。
//   node scripts/playground.test.js
//
// playground.html は検索用 Parquet（api/parquet/）の manifest.json を直接読むため、
// manifest のフィールド名・ファイル配置・列名が gen-parquet.js の出力とズレると
// プレイグラウンドが黙って壊れる。ここでは実際に generateParquetFiles を走らせた
// 生成物と playground.html の記述を突き合わせ、両者が食い違ったら失敗させる。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateParquetFiles } from './gen-parquet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'playground.html'), 'utf-8');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// gen-parquet の生成物（manifest）を一時ディレクトリに作って検証に使う。
const FACILITIES = [
  { pref: '東京都', city: '千代田区', city_raw: '千代田区', name: '店A', name_kana: 'ミセエー',
    business_type: '飲食店営業', address: '千代田区丸の内1-1', lat: 35.681, lng: 139.767,
    geocoding_level: 8, phone: '', license_no: '', license_date: '', expire_date: '',
    _source: 'テスト', _license: 'CC BY 4.0' },
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playground-test-'));
let manifest;
try {
  generateParquetFiles(FACILITIES, { outDir: path.join(tmp, 'parquet'), log: () => {} });
  manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'parquet', 'manifest.json'), 'utf-8'));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

test('manifest の配信パス（api/parquet/manifest.json）を参照している', () => {
  assert.ok(HTML.includes("new URL('./api/parquet/'"), 'ベース URL が ./api/parquet/');
  assert.ok(HTML.includes('manifest.json'), 'manifest.json を読んでいる');
});

test('HTML が参照する manifest.<キー> がすべて生成される', () => {
  // JS 中の manifest.xxx 参照を抽出する（files / records / updated 等）。
  // 「manifest.json」はファイル名でありプロパティ参照ではないため除外する。
  const referenced = new Set(
    [...HTML.matchAll(/\bmanifest\.([a-z_]+)\b/g)].map((m) => m[1]).filter((k) => k !== 'json'),
  );
  assert.ok(referenced.size >= 3, `manifest のキーを参照している (${[...referenced].join(',')})`);
  for (const key of referenced) {
    assert.ok(key in manifest, `manifest.${key} が生成される`);
  }
});

test('都道府県セレクトが使うファイル一覧のフィールドがすべて生成される', () => {
  // for (const f of manifest.files) { f.path / f.prefecture / f.records } の形で参照する。
  for (const key of ['path', 'prefecture', 'records']) {
    assert.ok(key in manifest.files[0], `manifest.files[].${key} が生成される`);
    assert.ok(HTML.includes(`f.${key}`), `playground.html が f.${key} を参照する`);
  }
});

test('かんたん検索の SQL が使う列がすべて Parquet に存在する', () => {
  // buildSql() が SELECT / WHERE で使う列。増減したらこのリストも更新すること。
  const used = [
    'name', 'name_kana', 'address', 'business_type', 'prefecture', 'city',
    'phone', 'lat', 'lng', 'geocoding_level',
  ];
  for (const col of used) {
    assert.ok(HTML.includes(col), `playground.html が列 ${col} を参照する`);
    assert.ok(manifest.columns.includes(col), `列 ${col} が Parquet に存在する`);
  }
});

test('ページに記載している列一覧が manifest.columns と過不足なく一致する', () => {
  // SQL エディタ下の注記に全列を列挙している。列を増減したら注記も更新すること。
  for (const col of manifest.columns) {
    assert.ok(HTML.includes(col), `列 ${col} がページ内に記載されている`);
  }
  assert.ok(
    HTML.includes(`${manifest.columns.length}列`),
    `列数（${manifest.columns.length}列）の記載が一致する`,
  );
});

test('DuckDB-WASM をバージョン固定で読み込んでいる', () => {
  // CDN のバージョンが浮動だと、破壊的変更でページが突然壊れるため固定を強制する。
  assert.ok(
    /@duckdb\/duckdb-wasm@\d+\.\d+\.\d+\/\+esm/.test(HTML),
    'jsDelivr の @duckdb/duckdb-wasm がセマンティックバージョンで固定されている',
  );
});

// 廃止した配信形式（階層JSON・検索インデックス）を参照していないこと。
test('廃止した配信形式を参照していない', () => {
  for (const gone of ['facilities/index.json', 'search-index', '/data.json']) {
    assert.ok(!HTML.includes(gone), `playground.html が ${gone} を参照していない`);
  }
});

console.log(`\n✅ playground 整合性テスト: ${passed}件すべて合格`);
