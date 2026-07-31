// gen-parquet.js のユニットテスト。
//   node scripts/gen-parquet.test.js
//
// 純粋関数（値の変換・都道府県分割）を固定入力で検証し、さらに実際に
// 一時ディレクトリへ Parquet を書き出して hyparquet で読み戻し、
// 値がそのまま往復すること（＝DuckDB からも読める妥当なファイルであること）を確認する。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import {
  OTHER_KEY,
  OTHER_LABEL,
  PARQUET_COLUMNS,
  buildColumnData,
  generateParquetFiles,
  intOrNull,
  numOrNull,
  partitionByPrefecture,
  prefectureFileKey,
  strOrNull,
} from './gen-parquet.js';
import { CSV_COLUMNS } from './build-merged-csv.js';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// クロール結果の施設オブジェクトを模した固定入力（フィールド名は toRow と同じ）。
const FACILITIES = [
  {
    pref: '東京都', city: '千代田区', city_raw: '千代田区', name: '店A', name_kana: 'ミセエー',
    business_type: '飲食店営業', address: '千代田区丸の内1-1', lat: 35.681, lng: 139.767,
    geocoding_level: 8, phone: '03-0000-0000', license_no: '第1号',
    license_date: '2024-01-01', expire_date: '2030-01-01',
    _source: '東京都オープンデータ', _license: 'CC BY 4.0',
  },
  {
    pref: '北海道', city: '札幌市', city_raw: '札幌市中央区', name: '店B', name_kana: '',
    business_type: '喫茶店営業', address: '札幌市中央区北1条', lat: null, lng: null,
    geocoding_level: null, phone: '', license_no: '',
    license_date: '', expire_date: '', _source: '北海道オープンデータ', _license: null,
  },
  // 都道府県を特定できないレコード（'99' バケットに入る）
  {
    pref: '', city: '', city_raw: '', name: '店C', name_kana: '', business_type: '飲食店営業',
    address: '住所不明', lat: undefined, lng: undefined, geocoding_level: '',
    phone: null, license_no: null, license_date: null, expire_date: null,
    _source: 'テストソース', _license: 'CC BY 4.0',
  },
];

await test('値の変換: strOrNull / numOrNull / intOrNull', () => {
  // 空文字・null・undefined はすべて Parquet の NULL に寄せる。
  assert.equal(strOrNull(''), null);
  assert.equal(strOrNull(null), null);
  assert.equal(strOrNull(undefined), null);
  assert.equal(strOrNull('店A'), '店A');
  assert.equal(strOrNull(0), '0'); // 数値が来ても文字列化する
  assert.equal(numOrNull(''), null);
  assert.equal(numOrNull('35.6'), 35.6);
  assert.equal(numOrNull('abc'), null);
  assert.equal(intOrNull(8), 8);
  assert.equal(intOrNull('8'), 8);
  assert.equal(intOrNull(3.5), null); // 整数でない精度レベルは不正値として NULL
});

await test('prefectureFileKey: 47都道府県は JIS コード、それ以外は 99', () => {
  assert.equal(prefectureFileKey('北海道'), '01');
  assert.equal(prefectureFileKey('東京都'), '13');
  assert.equal(prefectureFileKey('沖縄県'), '47');
  assert.equal(prefectureFileKey('東京'), OTHER_KEY); // 表記ゆれは正規名でないため 99
  assert.equal(prefectureFileKey(''), OTHER_KEY);
  assert.equal(prefectureFileKey(undefined), OTHER_KEY);
});

await test('partitionByPrefecture: 都道府県別に分割しキー昇順で返す', () => {
  const parts = partitionByPrefecture(FACILITIES);
  assert.deepEqual(parts.map((p) => p.key), ['01', '13', OTHER_KEY]);
  assert.deepEqual(parts.map((p) => p.prefecture), ['北海道', '東京都', OTHER_LABEL]);
  assert.deepEqual(parts.map((p) => p.facilities.length), [1, 1, 1]);
  assert.equal(parts[1].facilities[0].name, '店A');
});

await test('列定義が結合CSV の列名・並びと一致する', () => {
  assert.deepEqual(PARQUET_COLUMNS.map((c) => c.name), CSV_COLUMNS);
});

await test('buildColumnData: 列ごとの値配列に変換し、空値は NULL に寄せる', () => {
  const cols = buildColumnData(FACILITIES);
  const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
  assert.deepEqual(byName.name.data, ['店A', '店B', '店C']);
  assert.deepEqual(byName.lat.data, [35.681, null, null]);
  assert.deepEqual(byName.geocoding_level.data, [8, null, null]);
  assert.deepEqual(byName.name_kana.data, ['ミセエー', null, null]); // 空文字は NULL
  assert.deepEqual(byName.licenses.data, ['CC BY 4.0', null, 'CC BY 4.0']);
});

await test('generateParquetFiles: 書き出した Parquet を hyparquet で読み戻せる', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-parquet-test-'));
  try {
    const outDir = path.join(dir, 'parquet');
    const updated = 1700000000;
    const result = generateParquetFiles(FACILITIES, { outDir, updated, log: () => {} });
    assert.equal(result.files, 3);
    assert.equal(result.records, 3);
    assert.ok(result.bytes > 0);

    // manifest.json: プレイグラウンドが参照するフィールドを固定する。
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf-8'));
    assert.equal(manifest.updated, updated);
    assert.deepEqual(manifest.columns, CSV_COLUMNS);
    assert.equal(manifest.records, 3);
    assert.deepEqual(manifest.files.map((f) => f.path), ['01.parquet', '13.parquet', '99.parquet']);
    assert.ok(manifest.files.every((f) => f.records === 1 && f.bytes > 0 && f.prefecture));

    // 東京都のファイルを読み戻し、値がそのまま往復することを確認する。
    const rows = await parquetReadObjects({
      file: await asyncBufferFromFile(path.join(outDir, '13.parquet')),
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, '店A');
    assert.equal(rows[0].prefecture, '東京都');
    assert.equal(rows[0].lat, 35.681);
    assert.equal(rows[0].geocoding_level, 8);
    assert.equal(rows[0].sources, '東京都オープンデータ');

    // NULL 寄せした値が NULL のまま読めることも確認する（99 バケット）。
    const other = await parquetReadObjects({
      file: await asyncBufferFromFile(path.join(outDir, '99.parquet')),
    });
    assert.equal(other[0].name, '店C');
    assert.equal(other[0].lat, null);
    assert.equal(other[0].phone, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('generateParquetFiles: 文字列の min/max 統計を書かない（UTF-8 破損の回帰防止）', async () => {
  // hyparquet-writer は統計値を16バイトで切り詰めるため、日本語文字列が
  // マルチバイト境界でぶった切られ、DuckDB が UTF-8 検証エラーで読めなくなる。
  // 統計そのものを書かないことで回避している。この前提が崩れたら失敗させる。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-parquet-test-'));
  try {
    const outDir = path.join(dir, 'parquet');
    // 16バイト（日本語6文字）を超える名称で統計の切り詰めが起きる条件を作る。
    const long = { ...FACILITIES[0], name: 'とても長い名前の施設テスト店舗' };
    generateParquetFiles([long], { outDir, log: () => {} });
    const meta = await parquetMetadataAsync(
      await asyncBufferFromFile(path.join(outDir, '13.parquet')),
    );
    for (const rg of meta.row_groups) {
      for (const col of rg.columns) {
        const stats = col.meta_data?.statistics;
        assert.ok(
          stats?.min_value === undefined && stats?.max_value === undefined,
          `列 ${col.meta_data?.path_in_schema} に min/max 統計が書かれていない`,
        );
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('generateParquetFiles: 再実行で古いファイルが残らない', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-parquet-test-'));
  try {
    const outDir = path.join(dir, 'parquet');
    generateParquetFiles(FACILITIES, { outDir, log: () => {} });
    // 東京都だけで再生成すると、前回の 01 / 99 は消えること。
    generateParquetFiles(FACILITIES.slice(0, 1), { outDir, log: () => {} });
    assert.deepEqual(
      fs.readdirSync(outDir).sort(),
      ['13.parquet', 'manifest.json'],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n✅ gen-parquet ユニットテスト: ${passed}件すべて合格`);
