// 全件配布用の結合CSV生成（api/facilities-all.csv[.gz]）。
//
// 全国の施設レコードを1本の CSV に書き出す。都道府県・市区町村は名寄せ済みの値
// （lib/city-normmap.js が付与した pref / city）を使い、元データの生表記は
// city_raw 列に残す。
//
// 出力時に以下の浄化を行う:
//   - 全列完全一致の重複レコードを除去（出典・ライセンス列は判定から除く。
//     同一施設が複数ソースに載っている場合も1行に寄せるため）
//
// 業種違いの同一施設は「別の許可レコード」として残す（許可データの全量が価値のため）。
//
// メモリ: 施設全件（140万件超）をメモリに載せた状態から書き出すため、
// write() の戻り値を見て drain を待ち、出力バッファが膨らまないようにする。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';

/** 結合CSV の列（この順で出力する）。 */
export const CSV_COLUMNS = [
  'prefecture', 'city', 'city_raw', 'name', 'name_kana', 'business_type', 'address',
  'lat', 'lng', 'geocoding_level', 'phone', 'license_no', 'license_date', 'expire_date',
  'sources', 'licenses',
];

// 重複判定に含めない列（出典・ライセンス）。データ本体が同一なら重複とみなす。
const DEDUP_EXCLUDED = new Set(['sources', 'licenses']);
const DEDUP_INDEXES = CSV_COLUMNS
  .map((c, i) => (DEDUP_EXCLUDED.has(c) ? -1 : i))
  .filter((i) => i >= 0);

/** CSV セルのエスケープ（区切り・引用符・改行を含む場合のみ引用符で囲む）。 */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 1施設 → CSV_COLUMNS 順の値配列。 */
export function toRow(f) {
  return [
    f.pref, f.city, f.city_raw, f.name, f.name_kana, f.business_type, f.address,
    f.lat, f.lng, f.geocoding_level, f.phone, f.license_no, f.license_date, f.expire_date,
    f._source, f._license,
  ];
}

/** 書き込みバッファが埋まったら drain を待つ Promise を返す（不要なら null）。 */
function write(stream, chunk) {
  if (stream.write(chunk)) return null;
  return new Promise((resolve) => stream.once('drain', resolve));
}

/**
 * 結合CSV（と gzip 版）を書き出す。
 * 統計 `{ rowsIn, rowsOut, dupSkipped, prefectures, cities, bytes, gzipBytes }` と、
 * 重複を除いたあとの施設 `unique` を返す。
 *
 * `unique` はベクトルタイルの生成にも使う。重複判定はここでしか行わないため、
 * これを渡さずに元の配列からタイルを作ると、CSV には無い重複点がタイルに載り、
 * metadata.json の records（CSV基準）と points（タイル基準）がズレる。
 */
export async function buildMergedCsv(facilities, { outPath, gzip = true, log = console.log } = {}) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const out = fs.createWriteStream(outPath, { encoding: 'utf-8' });

  await write(out, '﻿'); // Excel 互換 UTF-8 BOM
  await write(out, CSV_COLUMNS.join(',') + '\n');

  let rowsIn = 0;
  let rowsOut = 0;
  let dupSkipped = 0;
  const seen = new Set(); // 出典を除く全列一致の重複判定
  const prefs = new Set();
  const cities = new Set();
  const unique = []; // CSV に書いた施設（＝タイルに載せる施設）

  for (const f of facilities) {
    rowsIn++;
    const row = toRow(f);

    // 出典・ライセンスを除いた全列が一致するレコードは重複として捨てる。
    const dedupKey = DEDUP_INDEXES.map((i) => row[i]).join('');
    if (seen.has(dedupKey)) {
      dupSkipped++;
      continue;
    }
    seen.add(dedupKey);

    const backpressure = write(out, row.map(csvCell).join(',') + '\n');
    if (backpressure) await backpressure;
    rowsOut++;
    unique.push(f);
    prefs.add(f.pref);
    cities.add(`${f.pref}/${f.city}`);
  }

  // end() のコールバックは flush 完了時に呼ばれる。
  await new Promise((resolve, reject) => {
    out.once('error', reject);
    out.end(resolve);
  });

  const bytes = fs.statSync(outPath).size;
  let gzipBytes = 0;
  if (gzip) {
    // 540MB 級になるためストリームで圧縮する（メモリに載せない）。
    const gzPath = `${outPath}.gz`;
    await pipeline(
      fs.createReadStream(outPath),
      zlib.createGzip({ level: 6 }),
      fs.createWriteStream(gzPath),
    );
    gzipBytes = fs.statSync(gzPath).size;
  }

  log(
    `  結合CSV: ${rowsOut.toLocaleString('en-US')}行` +
      `（重複 ${dupSkipped.toLocaleString('en-US')}行を除去）` +
      ` / ${prefs.size}都道府県 / ${cities.size}市区町村` +
      ` / ${(bytes / 1024 / 1024).toFixed(1)} MB` +
      (gzip ? `（gzip ${(gzipBytes / 1024 / 1024).toFixed(1)} MB）` : ''),
  );

  return {
    rowsIn,
    rowsOut,
    dupSkipped,
    prefectures: prefs.size,
    cities: cities.size,
    bytes,
    gzipBytes,
    unique,
  };
}
