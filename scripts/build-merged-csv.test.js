// 結合CSV の書き出しと、バリデーションで使う CSV リーダーの往復テスト。
//   node scripts/build-merged-csv.test.js
//
// 引用符・改行・カンマを含むセルが、書き出し → 読み戻しで元の値に戻ることを確認する
// （ここが崩れると配布CSV が壊れ、バリデーションもすり抜ける）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildMergedCsv, CSV_COLUMNS, csvCell } from './build-merged-csv.js';
import { generateTiles } from './gen-tiles.js';
import { readCsvRows } from './lib/csv-read.js';
import { resolvePrefCity, applyPrefCity, collectCityPairs } from './lib/city-normmap.js';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

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

async function writeCsv(facilities, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
  const outPath = path.join(dir, 'facilities-all.csv');
  const stats = await buildMergedCsv(facilities, { outPath, log: () => {}, ...opts });
  const rows = [...readCsvRows(outPath)];
  return { dir, outPath, stats, header: rows[0], rows: rows.slice(1) };
}

// --- csvCell（純粋関数） ---
await test('csvCell: 特殊文字を含むときだけ引用符で囲む', () => {
  assert.equal(csvCell('あ'), 'あ');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell('a\nb'), '"a\nb"');
});

// --- 書き出し → 読み戻し ---
await test('CSV: ヘッダーと BOM を出し、値が往復で保たれる', async () => {
  const { dir, outPath, header, rows } = await writeCsv([fac()]);
  try {
    assert.ok(fs.readFileSync(outPath, 'utf-8').startsWith('﻿'), 'BOM 付き');
    assert.deepEqual(header, CSV_COLUMNS);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][col.prefecture], '東京都');
    assert.equal(rows[0][col.name], '店A');
    assert.equal(rows[0][col.lat], '35.673');
    assert.equal(rows[0][col.sources], '東京都食品営業許可');
    assert.equal(rows[0][col.licenses], 'CC BY 4.0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CSV: 引用符・改行・カンマを含むセルが往復で壊れない', async () => {
  const tricky = '店"A", 2\n号店';
  const { dir, rows } = await writeCsv([fac({ name: tricky, address: 'a,b' })]);
  try {
    assert.equal(rows.length, 1, '改行入りセルでも1行として読める');
    assert.equal(rows[0][col.name], tricky);
    assert.equal(rows[0][col.address], 'a,b');
    assert.equal(rows[0].length, CSV_COLUMNS.length, '列数が保たれる');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CSV: 座標なし・null 項目は空セルになる', async () => {
  const { dir, rows } = await writeCsv([fac({ lat: null, lng: null, geocoding_level: null, license_date: null })]);
  try {
    assert.equal(rows[0][col.lat], '');
    assert.equal(rows[0][col.lng], '');
    assert.equal(rows[0][col.geocoding_level], '');
    assert.equal(rows[0][col.license_date], '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CSV: 出典を除く全列一致の重複を1行に寄せる', async () => {
  const { dir, rows, stats } = await writeCsv([
    fac(),
    fac(), // 完全重複
    fac({ _source: '別ソース', _license: 'PDL1.0' }), // 出典だけ違う＝同じ施設
    fac({ business_type: '喫茶店営業' }), // 業種違いは別の許可レコードとして残す
  ]);
  try {
    assert.equal(stats.rowsIn, 4);
    assert.equal(stats.rowsOut, 2);
    assert.equal(stats.dupSkipped, 2);
    assert.equal(rows.length, 2);
    assert.equal(rows[0][col.sources], '東京都食品営業許可', '最初に出会った出典を残す');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ベクトルタイルは stats.unique から作る。ここが CSV に書いた集合と食い違うと、
// metadata.json の records（CSV基準）と points（タイル基準）がズレて配信物の
// バリデーションが落ちる。
await test('CSV: unique が実際に書き出した施設と一致する', async () => {
  const kept = fac();
  const other = fac({ business_type: '喫茶店営業' });
  const { dir, rows, stats } = await writeCsv([
    kept,
    fac(), // 完全重複
    fac({ _source: '別ソース' }), // 出典だけ違う＝同じ施設
    other,
  ]);
  try {
    assert.equal(stats.unique.length, stats.rowsOut, 'unique の件数が CSV 行数と一致する');
    assert.equal(stats.unique.length, rows.length);
    assert.deepEqual(
      stats.unique.map((f) => f.business_type),
      [kept.business_type, other.business_type],
      '重複は除かれ、最初に出会った施設が残る',
    );
    assert.equal(stats.unique[0], kept, '施設オブジェクトの参照をそのまま返す');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CSV: 座標つきの重複は unique から落ちる（タイルの点数が CSV と揃う）', async () => {
  const { dir, stats } = await writeCsv([
    fac(),
    fac(), // 座標を持つ完全重複
    fac({ name: '店B', lat: null, lng: null }),
  ]);
  try {
    const withCoords = stats.unique.filter((f) => f.lat != null && f.lng != null).length;
    assert.equal(stats.dupSkipped, 1);
    assert.equal(withCoords, 1, '重複を数え上げず、座標ありは1件');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CSV: 都道府県・市区町村の異なり数を数える', async () => {
  const { dir, stats } = await writeCsv([
    fac(),
    fac({ name: '店B', city: '渋谷区', city_raw: '渋谷区' }),
    fac({ name: '店C', pref: '沖縄県', city: '那覇市', city_raw: '那覇市' }),
  ]);
  try {
    assert.equal(stats.prefectures, 2);
    assert.equal(stats.cities, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CSV: gzip 版が生成され、展開すると元の内容に一致する', async () => {
  const { dir, outPath, stats } = await writeCsv([fac()]);
  try {
    const gz = `${outPath}.gz`;
    assert.ok(fs.existsSync(gz), 'gz が生成される');
    assert.equal(stats.gzipBytes, fs.statSync(gz).size);
    const unzipped = zlib.gunzipSync(fs.readFileSync(gz)).toString('utf-8');
    assert.equal(unzipped, fs.readFileSync(outPath, 'utf-8'), '展開結果が元CSVと一致');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- 市区町村の名寄せ（純粋関数） ---
await test('resolvePrefCity: 名寄せ表があれば公式名を採用する', () => {
  const f = { _pref: '大分県', _city: '玖珠郡九重町', address: '大分県玖珠郡九重町大字後野上8-1' };
  const r = resolvePrefCity(f, { '大分県\t玖珠郡九重町': { pref: '大分県', city: '九重町' } });
  assert.deepEqual(r, { pref: '大分県', city: '九重町', cityRaw: '玖珠郡九重町', colFixed: false });
});

await test('resolvePrefCity: 名寄せ表に無ければ郡名を剥がす', () => {
  const f = { _pref: '大分県', _city: '玖珠郡九重町', address: '大分県玖珠郡九重町…' };
  assert.equal(resolvePrefCity(f, {}).city, '九重町');
  assert.equal(resolvePrefCity(f, {}).cityRaw, '玖珠郡九重町');
});

await test('resolvePrefCity: 列ズレ（pref に郵便番号・city に都道府県名）を住所から復元する', () => {
  const f = { _pref: '9300000', _city: '富山県', address: '富山県高岡市広小路7-50' };
  const r = resolvePrefCity(f, {});
  assert.equal(r.pref, '富山県');
  assert.equal(r.city, '高岡市');
  assert.equal(r.colFixed, true);
});

await test('applyPrefCity: 施設に pref / city / city_raw を書き込み件数を返す', () => {
  const facilities = [
    { _pref: '大分県', _city: '玖珠郡九重町', address: '大分県玖珠郡九重町…' },
    { _pref: '東京都', _city: '港区', address: '東京都港区赤坂1-1' },
  ];
  const { colFixedCount, mergedCount } = applyPrefCity(facilities, {});
  assert.equal(facilities[0].city, '九重町');
  assert.equal(facilities[0].city_raw, '玖珠郡九重町');
  assert.equal(facilities[1].city, '港区');
  assert.equal(colFixedCount, 0);
  assert.equal(mergedCount, 1);
});

await test('collectCityPairs: ユニークな (都道府県, 市区町村) を代表住所つきで集める', () => {
  const pairs = collectCityPairs([
    { _pref: '東京都', _city: '港区', address: '' },
    { _pref: '東京都', _city: '港区', address: '東京都港区赤坂1-1' },
    { _pref: '東京都', _city: '渋谷区', address: '東京都渋谷区1-1' },
    { address: '住所のみ' }, // pref/city 未解決は「不明」に寄せる
  ]);
  assert.equal(pairs.length, 3);
  assert.equal(pairs.find((p) => p.city === '港区').addr, '東京都港区赤坂1-1', '空でない住所を代表にする');
  assert.ok(pairs.some((p) => p.pref === '不明' && p.city === '不明'));
});

// --- 配信物どうしの整合 ---
// scripts/test.js が本番データで確認している不変条件を、小さなフィクスチャで先に潰す。
// 実際に metadata.stats.points（タイル基準）と CSV の座標あり件数がズレて
// クロールが失敗したことがある（タイルだけ重複除去前の配列から作っていた）。
await test('配信物: metadata.stats が CSV の件数と一致する', async () => {
  const { dir, outPath, stats, rows } = await writeCsv(
    [
      fac(),
      fac(), // 座標つきの完全重複
      fac({ name: '店B' }),
      fac({ name: '店C', lat: null, lng: null }), // 座標なし
    ],
    { gzip: false },
  );
  try {
    const outDir = path.join(path.dirname(outPath), 'tiles');
    generateTiles(stats.unique, { minZoom: 12, maxZoom: 12, outDir, stats, log: () => {} });
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'metadata.json'), 'utf-8'));

    const withCoords = rows.filter((r) => r[col.lat] !== '' && r[col.lng] !== '').length;
    assert.equal(meta.stats.records, rows.length, 'records が CSV 行数と一致する');
    assert.equal(meta.stats.points, withCoords, 'points が CSV の座標あり件数と一致する');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('配信物: 重複除去前の配列からタイルを作ろうとすると止まる', async () => {
  const facilities = [fac(), fac()];
  const { dir, outPath, stats } = await writeCsv(facilities, { gzip: false });
  try {
    assert.throws(
      () => generateTiles(facilities, {
        outDir: path.join(path.dirname(outPath), 'tiles'),
        stats,
        log: () => {},
      }),
      /stats\.unique/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n✅ 結合CSV / 名寄せ テスト: ${passed}件すべて合格`);
