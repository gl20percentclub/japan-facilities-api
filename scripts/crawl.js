// 全国 食品営業許可 データクローラー（オーケストレーター）
//
// config/sources.yaml を単一の情報源として、取得 → パース → 正規化 → 出力 を束ねる。
// 各段の実装は scripts/lib/ に分割してある:
//   lib/config.js        設定ファイル(YAML)の読み込み
//   lib/acquire.js       取得（ckan / get / post / resolve / i2fasglob）
//   lib/parse.js         パース（CSV/TSV/XLSX、文字コード、ヘッダー行判定）
//   lib/normalize.js     正規化（別名→内部キー、住所結合、日付、座標補正、都道府県/市区町村解決）
//   lib/geocode.js       ジオコーディング（住所→座標の補完）
//   lib/city-normmap.js  市区町村名の名寄せ（表記ゆれ→公式名）
//
// 配信物は3種類だけ（用途が無い階層JSONは配信しない）:
//   api/facilities-all.csv[.gz]   全件の結合CSV（build-merged-csv.js）
//   api/prefectures/*.csv         都道府県別CSV + index.json（build-prefecture-csv.js）
//   api/tiles/{z}/{x}/{y}.pbf     地図用ベクトルタイル + metadata.json（gen-tiles.js）
//
// 使い方:
//   node scripts/crawl.js              通常実行（ダウンロード→ジオコーディング→生成）
//   node scripts/crawl.js --dry-run    ダウンロードをスキップしキャッシュを使う
//   node scripts/crawl.js --no-geocode ジオコーディングをスキップ
//   node scripts/crawl.js --no-normmap 市区町村名の名寄せをスキップ（高速化・生表記のまま）
//   node scripts/crawl.js --only=osaka-city,minato   指定キーのソースだけ処理

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, ROOT } from './lib/config.js';
import { acquire } from './lib/acquire.js';
import { parseSource } from './lib/parse.js';
import {
  mapRecord,
  toFacility,
  resolvePrefecture,
  resolveCity,
} from './lib/normalize.js';
import { enrichWithGeocoding } from './lib/geocode.js';
import { buildCityNormMap, applyPrefCity } from './lib/city-normmap.js';
import { buildMergedCsv } from './build-merged-csv.js';
import { buildPrefectureCsvs } from './build-prefecture-csv.js';
import { generateTiles } from './gen-tiles.js';
import { generateReadmeStats } from './gen-readme-stats.js';
import { generateLlmsFiles } from './gen-llms.js';

const CACHE_DIR = path.join(ROOT, '.cache');
const API_DIR = path.join(ROOT, 'api');
const CSV_PATH = path.join(API_DIR, 'facilities-all.csv');
const PREF_CSV_DIR = path.join(API_DIR, 'prefectures');

const DRY_RUN = process.argv.includes('--dry-run');
const NO_GEOCODE = process.argv.includes('--no-geocode');
const NO_NORMMAP = process.argv.includes('--no-normmap');
// 施設0件のソースがあっても失敗させない（部分実行や意図的な空ソースの動作確認用）。
const ALLOW_EMPTY_SOURCES = process.argv.includes('--allow-empty-sources');

// --only=key1,key2 で処理対象ソースを絞る（動作確認・部分再生成用）
const ONLY = (() => {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  if (!arg) return null;
  return new Set(arg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean));
})();

// 配列を破壊的に連結する（純粋関数・テスト対象）。`target.push(...items)` の代わり。
//
// スプレッドは配列の全要素を関数の引数として展開するため、要素数が数万〜十数万を
// 超えると "Maximum call stack size exceeded" で落ちる。i2fas は単体で 71 万件あり、
// 実際に全ソース取り込み直後のマージでクロールが停止した。ループなら件数の上限がない。
export function appendAll(target, items) {
  for (const item of items) target.push(item);
  return target;
}

// 施設を1件も取り込めなかったソースを返す。
// keptBySource に載っていない（＝処理前に落ちた）ソースも 0 件扱いにする。
export function findEmptySources(sources, keptBySource) {
  return sources.filter((s) => (keptBySource.get(s.key) || 0) === 0);
}

// ソースの取得先ホストを求める（純粋関数・テスト対象）。
// 同一ホスト（BODIK の CKAN 等）へ同時に多重アクセスしないよう、
// ダウンロードの並列化はホスト単位のグループで行う。
// URL を持たない取得方法（i2fasglob = ローカルキャッシュ読み）は 'local'。
export function sourceHost(source) {
  const a = source.acquire || {};
  const u = a.url || (a.urls && a.urls[0]) || a.ckanBase || null;
  if (!u) return 'local';
  try {
    return new URL(u).host;
  } catch {
    return 'local';
  }
}

// ソースをホスト単位のグループに分ける（純粋関数・テスト対象）。
// グループ間は並列、グループ内は逐次で処理することで、
// 同一サーバーへの同時アクセスを常に1本に保つ。
export function groupSourcesByHost(sources) {
  const groups = new Map();
  for (const s of sources) {
    const host = sourceHost(s);
    if (!groups.has(host)) groups.set(host, []);
    groups.get(host).push(s);
  }
  return [...groups.values()];
}

// ホストグループ間のダウンロード並列数（環境変数で上書き可能）。
// 相手は別々の自治体サーバーなので、この程度なら行儀は保てる。
const DOWNLOAD_CONCURRENCY = Math.max(1, Number(process.env.DOWNLOAD_CONCURRENCY) || 6);

async function main() {
  const { sources: allSources, columnMap } = loadConfig();
  const sources = allSources.filter((s) => !ONLY || ONLY.has(s.key));
  console.log(`全国 食品営業許可 データクローラー${DRY_RUN ? ' (--dry-run)' : ''}`);
  console.log(`対象ソース: ${sources.length}件${ONLY ? `（--only=${[...ONLY].join(',')}）` : ''}\n`);

  const keptBySource = new Map(); // source.key -> 取り込めた施設数
  // ソースごとの取り込み結果。facilities への結合はソース定義順で行い、
  // 並列実行でも出力（CSV の行順・重複除去の勝ち負け）を決定的に保つ。
  const resultBySource = new Map(); // source.key -> facility[]

  // 1ソースを取得→パース→正規化する。ログは1ブロックにまとめて出力し、
  // 並列実行時に他ソースの行と混ざらないようにする。
  async function processSource(source) {
    const lines = [`▼ ${source.key}: ${source.source}`];
    const collected = [];
    let kept = 0;
    try {
      const files = await acquire(source, { cacheDir: CACHE_DIR, dryRun: DRY_RUN });
      const rawRecords = [];
      for (const { cachePath, format } of files) {
        appendAll(rawRecords, await parseSource(source, cachePath, format, columnMap));
      }
      lines.push(`  ${rawRecords.length}行を読み込み (${files.map((f) => f.format).join('+')})`);

      for (const raw of rawRecords) {
        const rec = mapRecord(raw, columnMap);
        const facility = toFacility(rec);
        if (facility) {
          collected.push({
            ...facility,
            _pref: resolvePrefecture(rec, source),
            _city: resolveCity(rec, source),
            _source: source.source,
            _license: source.license || null,
          });
          kept++;
        }
      }
      lines.push(`  有効施設: ${kept}件`);
    } catch (err) {
      lines.push(`  ⚠ ${source.key} をスキップ: ${err.message}`);
    }
    console.log(lines.join('\n'));
    keptBySource.set(source.key, kept);
    resultBySource.set(source.key, collected);
  }

  // ホスト単位のグループに分け、グループ間だけを並列化する
  // （同一サーバーへの同時アクセスは常に1本 = 逐次実行と同じ行儀を保つ）。
  const hostGroups = groupSourcesByHost(sources);
  let nextGroup = 0;
  await Promise.all(
    Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, hostGroups.length) }, async () => {
      while (nextGroup < hostGroups.length) {
        const group = hostGroups[nextGroup++];
        for (const source of group) {
          await processSource(source);
        }
      }
    }),
  );

  // ソース定義順に結合して以降の処理（重複除去・タイル生成）を決定的にする
  const facilities = [];
  for (const source of sources) {
    appendAll(facilities, resultBySource.get(source.key) || []);
  }

  console.log(`\n有効な施設: 合計 ${facilities.length}件`);

  // 施設を1件も取り込めなかったソースがあれば失敗させ、api/ を書き換えない。
  // 取得失敗が黙って欠落データに化けるのを防ぐ。--allow-empty-sources で無効化。
  const emptySources = findEmptySources(sources, keptBySource);
  if (emptySources.length > 0) {
    const list = emptySources.map((s) => `${s.key}（${s.source}）`).join('\n    - ');
    const msg =
      `施設を1件も取り込めなかったソースが ${emptySources.length}件 あります:\n    - ${list}\n` +
      `  取得/パースの一時的な失敗の可能性があります。再実行するか、意図的な場合は ` +
      `--allow-empty-sources を付けてください（欠落データのコミットを防ぐため中断しました）。`;
    if (ALLOW_EMPTY_SOURCES) console.warn(`\n⚠ ${msg}`);
    else throw new Error(msg);
  }

  // 緯度経度の無い施設を住所からジオコーディングして補完
  if (NO_GEOCODE) {
    console.log('\n▼ ジオコーディング: スキップ (--no-geocode)');
  } else {
    console.log('\n▼ ジオコーディング');
    await enrichWithGeocoding(facilities);
  }

  // 市区町村名の表記ゆれを公式名へ寄せ、各施設に pref / city / city_raw を確定させる。
  // 以降の配信物（結合CSV・ベクトルタイル）は共通してこの値を使う。
  console.log('\n▼ 市区町村名の名寄せ');
  const normMap = NO_NORMMAP ? {} : await buildCityNormMap(facilities);
  if (NO_NORMMAP) console.log('  スキップ (--no-normmap)');
  const { colFixedCount, mergedCount } = applyPrefCity(facilities, normMap);
  console.log(`  列ズレ補正: ${colFixedCount}件 / 市区町村名の名寄せ: ${mergedCount}件`);

  // 配信物を作り直す。api/ ごと消してから書くことで、過去の生成物（旧形式の
  // 階層JSON 等）が gh-pages に残り続けるのを防ぐ。
  console.log('\n▼ 配信物の生成');
  if (fs.existsSync(API_DIR)) fs.rmSync(API_DIR, { recursive: true, force: true });
  fs.mkdirSync(API_DIR, { recursive: true });

  const updated = Math.floor(Date.now() / 1000);
  const csv = await buildMergedCsv(facilities, { outPath: CSV_PATH });
  // 都道府県別CSV も全件CSV と同じ集合（重複除去後）から作る。
  const prefCsv = await buildPrefectureCsvs(csv.unique, { outDir: PREF_CSV_DIR, updated });
  // タイルは CSV と同じ集合（重複除去後）から作る。元の facilities を渡すと
  // CSV に載らない重複点がタイルに入り、配信物どうしで件数が食い違う。
  const tiles = generateTiles(csv.unique, { updated, stats: csv });
  generateReadmeStats({ updated, csv, prefCsv, tiles });
  // README の統計更新後に、AI エージェント向けの llms.txt / llms-full.txt を
  // README から再生成する（統計込みで最新化するため、必ず統計更新の後に呼ぶ）
  generateLlmsFiles();

  console.log(
    `\n✅ 生成完了: ${csv.prefectures}都道府県 / ${csv.cities}市区町村 / ${csv.rowsOut}レコード`,
  );
  console.log(`   出力先: api/facilities-all.csv[.gz] / api/prefectures/ / api/tiles/`);
}

// 直接実行された場合のみクロールを開始する（テストから import しても main は走らない）。
// パスに %  や空白を含む場合でも一致するよう、pathToFileURL で同じ形式に揃えて比較する。
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('\n❌ エラー:', err.message);
    process.exit(1);
  });
}

// テスト用に純粋関数を再エクスポートする（公開面は従来どおり）。
export { normalizeDate, sanitizeLatLng, resolvePrefecture, resolveCity, mapRecord, toFacility, splitPrefCity, isPlaceholderAddress } from './lib/normalize.js';
export { parseCSVText } from './lib/parse.js';
export { fetchWithRetry, resolveLinkFromHtml } from './lib/acquire.js';
