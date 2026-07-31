// 検索用 Parquet 生成（api/parquet/{都道府県コード}.parquet + manifest.json）
//
// 結合CSV と同じ施設集合（重複除去後）を、都道府県別の Parquet ファイルに書き出す。
// Parquet は列指向 + フッターにメタデータを持つため、DuckDB（CLI / WASM / Python）が
// HTTP Range リクエストで「必要な列・行グループだけ」を取得できる。
// つまり静的ファイルのまま、サーバー不要の検索 API として機能する:
//
//   SELECT name, address FROM read_parquet(
//     'https://…/api/parquet/13.parquet')            -- 13 = 東京都
//   WHERE name LIKE '%ラーメン%' LIMIT 100;
//
// 都道府県別に分割する理由:
//   - 1ファイルだと 100MB を超え GitHub の上限に当たる
//   - 検索はまず都道府県で絞る使い方が大半で、転送量を最小化できる
//
// 出力:
//   api/parquet/{01..47}.parquet   JIS X 0401 の都道府県コード別（例: 13 = 東京都）
//   api/parquet/99.parquet         都道府県を特定できなかったレコード
//   api/parquet/manifest.json      ファイル一覧・件数・列定義（プレイグラウンドが読む）
//
// 入力はクロール結果の施設配列（メモリ上）。crawl.js から呼ばれる。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parquetWriteFile } from 'hyparquet-writer';
import { PREFECTURE_BY_CODE } from './lib/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PARQUET_DIR = path.join(ROOT, 'api', 'parquet');

// 都道府県名 → JIS コード（'北海道' → '01'）。normalize.js の定義から逆引きを作る。
const CODE_BY_PREFECTURE = Object.fromEntries(
  Object.entries(PREFECTURE_BY_CODE).map(([code, name]) => [name, code]),
);

/** 都道府県を特定できないレコードをまとめるバケットのコードと表示名。 */
export const OTHER_KEY = '99';
export const OTHER_LABEL = 'その他';

/**
 * Parquet の列定義。列名・並びは結合CSV（build-merged-csv.js の CSV_COLUMNS）と同一。
 * 座標と精度だけ数値型にし、それ以外は文字列で持つ（元表記を保つため）。
 * get は施設オブジェクトから値を取り出すアクセサ。
 */
export const PARQUET_COLUMNS = [
  { name: 'prefecture', type: 'STRING', get: (f) => strOrNull(f.pref) },
  { name: 'city', type: 'STRING', get: (f) => strOrNull(f.city) },
  { name: 'city_raw', type: 'STRING', get: (f) => strOrNull(f.city_raw) },
  { name: 'name', type: 'STRING', get: (f) => strOrNull(f.name) },
  { name: 'name_kana', type: 'STRING', get: (f) => strOrNull(f.name_kana) },
  { name: 'business_type', type: 'STRING', get: (f) => strOrNull(f.business_type) },
  { name: 'address', type: 'STRING', get: (f) => strOrNull(f.address) },
  { name: 'lat', type: 'DOUBLE', get: (f) => numOrNull(f.lat) },
  { name: 'lng', type: 'DOUBLE', get: (f) => numOrNull(f.lng) },
  { name: 'geocoding_level', type: 'INT32', get: (f) => intOrNull(f.geocoding_level) },
  { name: 'phone', type: 'STRING', get: (f) => strOrNull(f.phone) },
  { name: 'license_no', type: 'STRING', get: (f) => strOrNull(f.license_no) },
  { name: 'license_date', type: 'STRING', get: (f) => strOrNull(f.license_date) },
  { name: 'expire_date', type: 'STRING', get: (f) => strOrNull(f.expire_date) },
  { name: 'sources', type: 'STRING', get: (f) => strOrNull(f._source) },
  { name: 'licenses', type: 'STRING', get: (f) => strOrNull(f._license) },
];

/** 空文字・null・undefined を null に寄せた文字列を返す（Parquet の NULL として書く）。 */
export function strOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === '' ? null : s;
}

/** 有限の数値だけを数値として返し、それ以外（空・非数値）は null にする。 */
export function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 整数だけを整数として返し、それ以外は null にする（geocoding_level 用）。 */
export function intOrNull(v) {
  const n = numOrNull(v);
  return n !== null && Number.isInteger(n) ? n : null;
}

/**
 * 都道府県名から出力ファイルのキー（JIS コード）を返す。
 * 正規の47都道府県以外（空・表記ゆれ等）は OTHER_KEY('99') に寄せる。
 */
export function prefectureFileKey(pref) {
  return CODE_BY_PREFECTURE[pref] || OTHER_KEY;
}

/**
 * 施設配列を都道府県別に分割する。
 * 返り値はキー昇順の配列 `[{ key, prefecture, facilities }]`。
 * key は JIS コード（'01'〜'47'）または '99'、prefecture は表示名。
 */
export function partitionByPrefecture(facilities) {
  const buckets = new Map(); // key -> { key, prefecture, facilities }
  for (const f of facilities) {
    const key = prefectureFileKey(f.pref);
    let bucket = buckets.get(key);
    if (!bucket) {
      // '99' バケットには複数の表記が混ざるため、表示名は固定ラベルにする。
      const prefecture = key === OTHER_KEY ? OTHER_LABEL : PREFECTURE_BY_CODE[key];
      bucket = { key, prefecture, facilities: [] };
      buckets.set(key, bucket);
    }
    bucket.facilities.push(f);
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** 施設配列を hyparquet-writer の columnData 形式（列ごとの値配列）に変換する。 */
export function buildColumnData(facilities) {
  return PARQUET_COLUMNS.map((col) => ({
    name: col.name,
    type: col.type,
    data: facilities.map(col.get),
  }));
}

/**
 * 都道府県別 Parquet と manifest.json を生成する。
 *
 * `updated`（UNIX 秒）は manifest とファイルの kvMetadata に埋め込み、
 * プレイグラウンドが最終更新を表示できるようにする。
 * 生成結果 `{ files, records, bytes }` を返す。
 */
export function generateParquetFiles(facilities, {
  outDir = PARQUET_DIR,
  updated = Math.floor(Date.now() / 1000),
  log = console.log,
} = {}) {
  // 古い生成物を消してから作り直す（都道府県が減った場合の取り残しを防ぐ）。
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const files = [];
  let totalBytes = 0;
  for (const { key, prefecture, facilities: rows } of partitionByPrefecture(facilities)) {
    const filename = `${key}.parquet`;
    // 既定の SNAPPY 圧縮で書く（DuckDB WASM/CLI/Python いずれも標準で読める）。
    // statistics は必ず無効にする: hyparquet-writer は文字列の min/max 統計を
    // 16バイトで切り詰めるため、日本語（マルチバイト）がバイト境界でぶった切られて
    // 不正な UTF-8 になり、DuckDB が「Invalid string encoding」で読めなくなる。
    // データは都道府県内でソートしていないため、統計による行グループの読み飛ばしは
    // もともと効かず、無効化の実害はない。
    parquetWriteFile({
      filename: path.join(outDir, filename),
      columnData: buildColumnData(rows),
      statistics: false,
      kvMetadata: [{ key: 'updated', value: String(updated) }],
    });
    const bytes = fs.statSync(path.join(outDir, filename)).size;
    totalBytes += bytes;
    files.push({ key, prefecture, path: filename, records: rows.length, bytes });
  }

  // プレイグラウンド・利用者向けの一覧。列名は結合CSV と同じであることを明示する。
  const manifest = {
    updated,
    columns: PARQUET_COLUMNS.map((c) => c.name),
    records: facilities.length,
    files,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  log(
    `  検索用Parquet: ${facilities.length.toLocaleString('en-US')}件 → ${files.length}ファイル` +
      `（計 ${(totalBytes / 1024 / 1024).toFixed(1)} MB）→ api/parquet/`,
  );
  return { files: files.length, records: facilities.length, bytes: totalBytes };
}
