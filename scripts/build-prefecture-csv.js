// 都道府県別CSV の生成（api/prefectures/{prefcode}.csv）。
//
// 全件CSV（facilities-all.csv）は数百MB あり、1県分だけ欲しい利用者には重すぎる。
// そこで同じ列・同じレコード集合を都道府県ごとに分割した CSV も配信する。
//
// 入力は buildMergedCsv() が返す `unique`（＝重複除去後の施設）を渡すこと。
// 元の facilities を渡すと全件CSV に載っていない重複行が県別CSV に入り、
// 「県別の合計 ≠ 全件」という食い違いが生まれる。
//
// 出力:
//   api/prefectures/{prefcode}.csv   47都道府県ぶん（0件の県もヘッダーだけ出す）
//   api/prefectures/index.json       ファイル一覧・件数・バイト数の索引
//
// 都道府県が特定できなかったレコード（pref が '不明' 等、47都道府県に一致しない）は
// 県別CSV には含めない。件数は index.json の `unassigned` とログに残し、
// 黙って消えないようにする（全件CSV には従来どおり含まれる）。

import fs from 'node:fs';
import path from 'node:path';
import { CSV_COLUMNS, csvCell, toRow } from './build-merged-csv.js';

/**
 * JIS都道府県コード順の都道府県定義。
 * `code` は都道府県コード（prefcode。ゼロ埋め2桁）で、そのまま `{prefcode}.csv` という
 * ファイル名になる。`romaji` はファイル名には使わず、index.json に載せる英字ラベル。
 */
export const PREFECTURES = [
  { code: '01', name: '北海道', romaji: 'hokkaido' },
  { code: '02', name: '青森県', romaji: 'aomori' },
  { code: '03', name: '岩手県', romaji: 'iwate' },
  { code: '04', name: '宮城県', romaji: 'miyagi' },
  { code: '05', name: '秋田県', romaji: 'akita' },
  { code: '06', name: '山形県', romaji: 'yamagata' },
  { code: '07', name: '福島県', romaji: 'fukushima' },
  { code: '08', name: '茨城県', romaji: 'ibaraki' },
  { code: '09', name: '栃木県', romaji: 'tochigi' },
  { code: '10', name: '群馬県', romaji: 'gunma' },
  { code: '11', name: '埼玉県', romaji: 'saitama' },
  { code: '12', name: '千葉県', romaji: 'chiba' },
  { code: '13', name: '東京都', romaji: 'tokyo' },
  { code: '14', name: '神奈川県', romaji: 'kanagawa' },
  { code: '15', name: '新潟県', romaji: 'niigata' },
  { code: '16', name: '富山県', romaji: 'toyama' },
  { code: '17', name: '石川県', romaji: 'ishikawa' },
  { code: '18', name: '福井県', romaji: 'fukui' },
  { code: '19', name: '山梨県', romaji: 'yamanashi' },
  { code: '20', name: '長野県', romaji: 'nagano' },
  { code: '21', name: '岐阜県', romaji: 'gifu' },
  { code: '22', name: '静岡県', romaji: 'shizuoka' },
  { code: '23', name: '愛知県', romaji: 'aichi' },
  { code: '24', name: '三重県', romaji: 'mie' },
  { code: '25', name: '滋賀県', romaji: 'shiga' },
  { code: '26', name: '京都府', romaji: 'kyoto' },
  { code: '27', name: '大阪府', romaji: 'osaka' },
  { code: '28', name: '兵庫県', romaji: 'hyogo' },
  { code: '29', name: '奈良県', romaji: 'nara' },
  { code: '30', name: '和歌山県', romaji: 'wakayama' },
  { code: '31', name: '鳥取県', romaji: 'tottori' },
  { code: '32', name: '島根県', romaji: 'shimane' },
  { code: '33', name: '岡山県', romaji: 'okayama' },
  { code: '34', name: '広島県', romaji: 'hiroshima' },
  { code: '35', name: '山口県', romaji: 'yamaguchi' },
  { code: '36', name: '徳島県', romaji: 'tokushima' },
  { code: '37', name: '香川県', romaji: 'kagawa' },
  { code: '38', name: '愛媛県', romaji: 'ehime' },
  { code: '39', name: '高知県', romaji: 'kochi' },
  { code: '40', name: '福岡県', romaji: 'fukuoka' },
  { code: '41', name: '佐賀県', romaji: 'saga' },
  { code: '42', name: '長崎県', romaji: 'nagasaki' },
  { code: '43', name: '熊本県', romaji: 'kumamoto' },
  { code: '44', name: '大分県', romaji: 'oita' },
  { code: '45', name: '宮崎県', romaji: 'miyazaki' },
  { code: '46', name: '鹿児島県', romaji: 'kagoshima' },
  { code: '47', name: '沖縄県', romaji: 'okinawa' },
];

/** 都道府県名 → 定義（高速引き用）。 */
const BY_NAME = new Map(PREFECTURES.map((p) => [p.name, p]));

/** 索引ファイル名（ファイル一覧・件数を載せる JSON）。 */
export const INDEX_FILENAME = 'index.json';

/**
 * 都道府県名 → CSV ファイル名（例: '東京都' → '13.csv'）。
 * 47都道府県に一致しない名前（'不明' 等）は null を返す。
 */
export function prefectureFileName(pref) {
  const def = BY_NAME.get(String(pref || '').trim());
  return def ? `${def.code}.csv` : null;
}

/** 書き込みバッファが埋まったら drain を待つ Promise を返す（不要なら null）。 */
function write(stream, chunk) {
  if (stream.write(chunk)) return null;
  return new Promise((resolve) => stream.once('drain', resolve));
}

/**
 * 施設を都道府県ごとに束ねる（純粋関数）。
 * 戻り値は `{ groups, unassigned }`。`groups` は 都道府県名 → 施設配列（47件ぶん、
 * 0件の県も空配列で必ず存在する）、`unassigned` は都道府県を特定できなかった施設数。
 * 施設オブジェクトは複製せず参照のまま持つ（100万件規模でもメモリ増加を抑えるため）。
 */
export function groupByPrefecture(facilities) {
  const groups = new Map(PREFECTURES.map((p) => [p.name, []]));
  let unassigned = 0;
  for (const f of facilities) {
    const bucket = groups.get(String(f.pref || '').trim());
    if (bucket) bucket.push(f);
    else unassigned++;
  }
  return { groups, unassigned };
}

/**
 * 索引 JSON の中身を組み立てる（純粋関数）。
 * `entries` は `{ code, name, romaji, file, records, bytes }` の配列。
 */
export function renderIndex({ updated, entries, unassigned }) {
  return {
    // 生成時刻（UNIX秒）。全件CSV・タイルの metadata.json と同じ値を入れる。
    updated: updated ?? null,
    columns: CSV_COLUMNS,
    // 都道府県を特定できず県別CSV に含まれなかったレコード数（全件CSV には含まれる）。
    unassigned,
    prefectures: entries,
  };
}

/**
 * 都道府県別CSV と索引 JSON を書き出す。
 * `facilities` には buildMergedCsv() が返す `unique`（重複除去後）を渡すこと。
 *
 * 統計 `{ files, records, unassigned, bytes, entries }` を返す。
 */
export async function buildPrefectureCsvs(facilities, { outDir, updated, log = console.log } = {}) {
  fs.mkdirSync(outDir, { recursive: true });

  const { groups, unassigned } = groupByPrefecture(facilities);
  const header = CSV_COLUMNS.join(',') + '\n';

  const entries = [];
  let records = 0;
  let bytes = 0;

  // 47ファイルを同時に開くとメモリを食うため、県ごとに開いて閉じる。
  for (const def of PREFECTURES) {
    const file = `${def.code}.csv`;
    const outPath = path.join(outDir, file);
    const out = fs.createWriteStream(outPath, { encoding: 'utf-8' });

    // ヘッダーは常に書く（0件の県でも URL とヘッダーが存在するようにするため）。
    await write(out, header);

    const rows = groups.get(def.name);
    for (const f of rows) {
      const backpressure = write(out, toRow(f).map(csvCell).join(',') + '\n');
      if (backpressure) await backpressure;
    }

    // end() のコールバックは flush 完了時に呼ばれる。
    await new Promise((resolve, reject) => {
      out.once('error', reject);
      out.end(resolve);
    });

    const size = fs.statSync(outPath).size;
    records += rows.length;
    bytes += size;
    entries.push({ ...def, file, records: rows.length, bytes: size });
  }

  const indexPath = path.join(outDir, INDEX_FILENAME);
  fs.writeFileSync(indexPath, JSON.stringify(renderIndex({ updated, entries, unassigned }), null, 2) + '\n');

  // 0件の県は元データの取得漏れを疑う手がかりになるので名前を出す。
  const empty = entries.filter((e) => e.records === 0).map((e) => e.name);

  log(
    `  都道府県別CSV: ${entries.length}ファイル / ${records.toLocaleString('en-US')}行` +
      ` / ${(bytes / 1024 / 1024).toFixed(1)} MB`,
  );
  if (unassigned > 0) {
    log(`    都道府県を特定できず県別CSV に含めなかったレコード: ${unassigned.toLocaleString('en-US')}行`);
  }
  if (empty.length > 0) log(`    0件の都道府県: ${empty.join('・')}`);

  return { files: entries.length, records, unassigned, bytes, entries };
}
