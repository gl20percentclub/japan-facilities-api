// 都道府県別CSV の生成ロジックを検証する。
//   node scripts/build-prefecture-csv.test.js
//
// 見るのは3点:
//   - 47都道府県ぶんのファイルが必ず出る（0件の県もヘッダーだけ出す）
//   - 各ファイルの中身がその県のレコードだけで、全件CSV と同じ列・同じ値になる
//   - 都道府県を特定できないレコードが黙って消えず unassigned に計上される

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CSV_COLUMNS } from './build-merged-csv.js';
import {
  PREFECTURES,
  INDEX_FILENAME,
  buildPrefectureCsvs,
  groupByPrefecture,
  prefectureFileName,
  renderIndex,
} from './build-prefecture-csv.js';
import { readCsvRows } from './lib/csv-read.js';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('build-prefecture-csv テスト\n');

const col = Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, i]));

/** テスト用の施設（pref/city は名寄せ済みの想定）。 */
function fac(over = {}) {
  return {
    pref: '東京都', city: '港区', city_raw: '港区',
    name: '店A', name_kana: 'ミセエー', business_type: '飲食店営業',
    address: '港区赤坂1-1', lat: 35.673, lng: 139.737, geocoding_level: 8,
    phone: '03-0000-0000', license_no: '第1号', license_date: '2023-12-07', expire_date: '2030-01-31',
    _source: '東京都食品営業許可', _license: 'CC BY 4.0',
    ...over,
  };
}

/** 一時ディレクトリに県別CSV を書き出す。 */
async function writeCsvs(facilities, opts = {}) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pref-csv-test-'));
  const stats = await buildPrefectureCsvs(facilities, { outDir, log: () => {}, ...opts });
  return { outDir, stats };
}

/** 県別CSV を読み、ヘッダーを除いた行配列を返す。 */
function readRows(outDir, file) {
  const rows = [...readCsvRows(path.join(outDir, file))];
  return { header: rows[0], rows: rows.slice(1) };
}

// --- 純粋関数 ---------------------------------------------------------------
await test('PREFECTURES: JISコード順の47都道府県', () => {
  assert.equal(PREFECTURES.length, 47);
  assert.deepEqual(PREFECTURES[0], { code: '01', name: '北海道', romaji: 'hokkaido' });
  assert.deepEqual(PREFECTURES[46], { code: '47', name: '沖縄県', romaji: 'okinawa' });
  // コード・ローマ字・名前はいずれも重複しない（code の重複はファイル名の衝突になる）
  for (const key of ['code', 'name', 'romaji']) {
    assert.equal(new Set(PREFECTURES.map((p) => p[key])).size, 47, `${key} が一意`);
  }
  // ローマ字は index.json 用の英字ラベル（小文字英字のみ）
  assert.ok(PREFECTURES.every((p) => /^[a-z]+$/.test(p.romaji)), 'romaji は小文字英字のみ');
});

await test('prefectureFileName: 都道府県名 → ファイル名', () => {
  assert.equal(prefectureFileName('東京都'), '13.csv');
  assert.equal(prefectureFileName('北海道'), '01.csv');
  assert.equal(prefectureFileName(' 沖縄県 '), '47.csv');
  // 全県ぶんが「都道府県コード2桁 + .csv」だけの名前になっている（ローマ字は付けない）
  assert.ok(PREFECTURES.every((p) => /^\d{2}\.csv$/.test(prefectureFileName(p.name))));
  // 47都道府県に無い値は null（呼び出し側で未分類として扱う）
  assert.equal(prefectureFileName('不明'), null);
  assert.equal(prefectureFileName(''), null);
  assert.equal(prefectureFileName(undefined), null);
});

await test('groupByPrefecture: 47県ぶんのバケツを必ず作り、不明は数えるだけ', () => {
  const { groups, unassigned } = groupByPrefecture([
    fac(), fac({ pref: '沖縄県' }), fac({ pref: '不明' }), fac({ pref: '' }),
  ]);
  assert.equal(groups.size, 47);
  assert.equal(groups.get('東京都').length, 1);
  assert.equal(groups.get('沖縄県').length, 1);
  assert.equal(groups.get('京都府').length, 0, '0件の県も空配列で存在する');
  assert.equal(unassigned, 2);
});

await test('renderIndex: 索引JSON の形', () => {
  const index = renderIndex({
    updated: 1783366001,
    entries: [{ code: '13', name: '東京都', romaji: 'tokyo', file: '13.csv', records: 2, bytes: 300 }],
    unassigned: 1,
  });
  assert.equal(index.updated, 1783366001);
  assert.deepEqual(index.columns, CSV_COLUMNS);
  assert.equal(index.unassigned, 1);
  assert.equal(index.prefectures[0].file, '13.csv');
  // updated 未指定は null（JSON に undefined を書かない）
  assert.equal(renderIndex({ entries: [], unassigned: 0 }).updated, null);
});

// --- 書き出し ---------------------------------------------------------------
await test('47ファイルを必ず出力し、0件の県もヘッダーだけ書く', async () => {
  const { outDir, stats } = await writeCsvs([fac(), fac({ pref: '沖縄県', name: '店B' })]);

  assert.equal(stats.files, 47);
  assert.equal(stats.records, 2);
  for (const def of PREFECTURES) {
    const file = path.join(outDir, `${def.code}.csv`);
    assert.ok(fs.existsSync(file), `${def.name} のCSV が存在する`);
  }
  const empty = readRows(outDir, '26.csv');
  assert.deepEqual(empty.header, CSV_COLUMNS, '0件の県もヘッダーは書く');
  assert.equal(empty.rows.length, 0);
});

await test('各県のCSV にはその県のレコードだけが入る', async () => {
  const { outDir } = await writeCsvs([
    fac({ name: '東京A' }), fac({ name: '東京B' }), fac({ pref: '沖縄県', city: '那覇市', name: '那覇A' }),
  ]);

  const tokyo = readRows(outDir, '13.csv');
  assert.deepEqual(tokyo.header, CSV_COLUMNS);
  assert.equal(tokyo.rows.length, 2);
  assert.deepEqual(tokyo.rows.map((r) => r[col.name]), ['東京A', '東京B']);
  assert.ok(tokyo.rows.every((r) => r[col.prefecture] === '東京都'));

  const okinawa = readRows(outDir, '47.csv');
  assert.equal(okinawa.rows.length, 1);
  assert.equal(okinawa.rows[0][col.city], '那覇市');
});

await test('特殊文字を含むセルが書き出し→読み戻しで元に戻る', async () => {
  const tricky = fac({ name: 'カフェ, "ABC"\n2階', address: '港区赤坂1-1, 2F' });
  const { outDir } = await writeCsvs([tricky]);
  const { rows } = readRows(outDir, '13.csv');
  assert.equal(rows[0][col.name], 'カフェ, "ABC"\n2階');
  assert.equal(rows[0][col.address], '港区赤坂1-1, 2F');
});

await test('都道府県が不明なレコードは県別CSV に入れず unassigned に数える', async () => {
  const { outDir, stats } = await writeCsvs([fac(), fac({ pref: '不明', name: '不明店' })]);

  assert.equal(stats.records, 1);
  assert.equal(stats.unassigned, 1);
  const index = JSON.parse(fs.readFileSync(path.join(outDir, INDEX_FILENAME), 'utf-8'));
  assert.equal(index.unassigned, 1);
  // どのファイルにも紛れ込んでいないこと
  const all = PREFECTURES.flatMap((d) => readRows(outDir, `${d.code}.csv`).rows);
  assert.ok(!all.some((r) => r[col.name] === '不明店'));
});

await test('index.json が実ファイルの件数・バイト数と一致する', async () => {
  const { outDir, stats } = await writeCsvs(
    [fac(), fac({ name: '東京B' }), fac({ pref: '北海道', city: '札幌市', name: '札幌A' })],
    { updated: 1783366001 },
  );

  const index = JSON.parse(fs.readFileSync(path.join(outDir, INDEX_FILENAME), 'utf-8'));
  assert.equal(index.updated, 1783366001);
  assert.equal(index.prefectures.length, 47);
  for (const entry of index.prefectures) {
    const file = path.join(outDir, entry.file);
    assert.equal(entry.bytes, fs.statSync(file).size, `${entry.name} の bytes が実ファイルと一致`);
    assert.equal(entry.records, readRows(outDir, entry.file).rows.length, `${entry.name} の records が実行数と一致`);
  }
  // 統計は全ファイルの合計
  assert.equal(index.prefectures.reduce((a, e) => a + e.records, 0), stats.records);
  assert.equal(index.prefectures.reduce((a, e) => a + e.bytes, 0), stats.bytes);
});

await test('CSV は BOM なし UTF-8 で書き出す', async () => {
  const { outDir } = await writeCsvs([fac()]);
  const head = fs.readFileSync(path.join(outDir, '13.csv'), { encoding: 'utf-8' }).slice(0, 1);
  assert.notEqual(head, '﻿');
});

console.log(`\n✅ build-prefecture-csv テスト ${passed}件に合格`);
