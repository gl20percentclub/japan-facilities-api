// ジオコーディング: 緯度経度の無い施設を、住所から座標に変換して補完する。
// @geolonia/normalize-japanese-addresses を使い、結果は .cache/geocode-cache.json に永続化。
// 併せて正規化結果の都道府県・市区町村も取得し、これらのカラムが無いデータの _pref/_city 補完に使う。
//
// 大量クエリ（初回フル実行で数十万件）は worker_threads で複数コアに分散する。
// normalize() は市区町村辞書の照合が CPU 主体（シングルスレッドでは1コアに
// 張り付く）ため、ワーカー分散で実行時間がほぼ線形に縮む。
// 少量（週次の差分など）はスレッド起動コストを避けてインラインで処理する。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { normalize, config as njaConfig } from '@geolonia/normalize-japanese-addresses';
import { ROOT } from './config.js';
import { isPlaceholderAddress } from './normalize.js';

const CACHE_DIR = path.join(ROOT, '.cache');
const GEOCODE_CACHE_PATH = path.join(CACHE_DIR, 'geocode-cache.json');
// 公開APIに優しくするため並列は控えめに（同一市区町村は LRU キャッシュで再利用される）。
// ワーカー分散時も、クエリは市区町村単位でワーカーに分かれるため
// 辞書ファイル取得の実負荷はワーカー数にほぼ比例しない。
const GEOCODE_CONCURRENCY = 8;
// ワーカースレッド数。Fargate タスクの 8 vCPU に合わせた上限。
// 環境変数 GEOCODE_WORKERS で上書きできる（1 でインライン処理に固定）。
const GEOCODE_WORKERS = Math.max(
  1,
  Number(process.env.GEOCODE_WORKERS) || Math.min(8, os.availableParallelism()),
);
// これ未満のクエリ数ならワーカーを起動せずインラインで処理する
const WORKER_THRESHOLD = 2000;
// キャッシュ保存の最短間隔（毎バッチ全量シリアライズすると数十MBの JSON を
// 数百回書くことになるため、時間ベースで間引く）
const CACHE_SAVE_INTERVAL_MS = 30_000;

// ジオコーディング用の住所クエリを組み立てる。
// 神戸市・仙台市等は住所列が区/町名始まり（市名は別列）のため、市名を前置しないと
// ジオコーダーが区を解決できず県代表点(level 1)へ転落する。_city を前置して補正する。
export function geocodeQuery(facility) {
  const addr = facility.address || '';
  const pref = facility._pref && facility._pref !== '不明' ? facility._pref : '';
  const city = facility._city && facility._city !== '不明' ? facility._city : '';
  if (!city) return pref && !addr.startsWith(pref) ? `${pref}${addr}` : addr;
  // 住所が政令市の区名で始まり city 末尾と重複する場合は剥がす（例: city=神戸市東灘区, addr=東灘区…）
  let a = addr;
  const wm = city.match(/(.+?[市])(.+?[区])$/);
  if (wm && a.startsWith(wm[2])) a = a.slice(wm[2].length);
  else if (a.startsWith(city)) a = a.slice(city.length);
  const head = city.startsWith(pref) ? city : `${pref}${city}`;
  return a.startsWith(head) ? a : `${head}${a}`;
}

function loadGeocodeCache() {
  try {
    return JSON.parse(fs.readFileSync(GEOCODE_CACHE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveGeocodeCache(cache) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(GEOCODE_CACHE_PATH, JSON.stringify(cache));
}

// 指定並列数でタスクを処理する単純なワーカープール
async function runPool(items, concurrency, worker) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

// クエリをソートしてから n 個の連続チャンクに分割する（純粋関数・テスト対象）。
// 日本の住所クエリは「都道府県+市区町村」始まりなので、ソート後の連続チャンクは
// ほぼ市区町村単位でまとまり、各ワーカーの辞書 LRU ヒット率が上がる
// （同じ市区町村の辞書を複数ワーカーが重複ダウンロードするのも防ぐ）。
export function partitionQueries(queries, n) {
  const sorted = [...queries].sort();
  const chunks = [];
  const base = Math.floor(sorted.length / n);
  const extra = sorted.length % n;
  let offset = 0;
  for (let i = 0; i < n; i++) {
    // 余りは先頭のチャンクから1件ずつ多く持たせる（サイズ差は最大1）
    const size = base + (i < extra ? 1 : 0);
    if (size > 0) chunks.push(sorted.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

// worker_threads でクエリ集合を分散処理し、結果をキャッシュへ書き込む。
// ワーカーからの結果はバッチで届き、進捗表示と時間ベースのキャッシュ保存を行う。
// ワーカーがクラッシュした場合、その分のクエリは未取得のまま残る
// （キャッシュに載らないため次回実行時に自動で再試行される）。
async function geocodeWithWorkers(toFetch, cache, { workers, concurrency, cacheSize }) {
  const workerUrl = new URL('./geocode-worker.js', import.meta.url);
  const chunks = partitionQueries(toFetch, workers);
  console.log(`  ワーカー ${chunks.length}スレッド × 並列${concurrency} で分散処理`);

  let done = 0;
  let failed = 0;
  let errored = 0;
  let lastSave = Date.now();
  let lastLog = 0;

  await Promise.all(
    chunks.map(
      (queries) =>
        new Promise((resolve) => {
          const w = new Worker(fileURLToPath(workerUrl), {
            workerData: { queries, concurrency, cacheSize },
          });
          w.on('message', (msg) => {
            if (msg.type !== 'batch') return;
            Object.assign(cache, msg.entries);
            done += Object.keys(msg.entries).length + msg.errored;
            failed += msg.failed;
            errored += msg.errored;
            // 進捗は5,000件刻みで表示（CloudWatch のログ量を抑える）
            if (done - lastLog >= 5000) {
              console.log(`    ...${done}/${toFetch.length}件 取得`);
              lastLog = done;
            }
            // 全量シリアライズは重いので時間ベースで間引いて保存する
            if (Date.now() - lastSave >= CACHE_SAVE_INTERVAL_MS) {
              saveGeocodeCache(cache);
              lastSave = Date.now();
            }
          });
          // クラッシュしても全体は止めない（未取得分は次回再試行される）
          w.on('error', (err) => {
            console.warn(`  ⚠ ジオコーディングワーカーでエラー: ${err.message}`);
            resolve();
          });
          w.on('exit', () => resolve());
        }),
    ),
  );
  return { failed, errored };
}

// 緯度経度の無い施設を住所からジオコーディングして補完する（facilities を破壊的に更新）。
export async function enrichWithGeocoding(facilities, { concurrency = GEOCODE_CONCURRENCY } = {}) {
  // 座標が無く、かつ住所が実体を持つ施設だけをジオコーディング対象にする。
  // 「市内一円」等のプレースホルダ住所は誤った代表点が付くのを避けて対象外にする（座標null）。
  const needCoord = facilities.filter((f) => f.lat == null || f.lng == null);
  const placeholders = needCoord.filter((f) => isPlaceholderAddress(f.address)).length;
  const targets = needCoord.filter((f) => f.address && !isPlaceholderAddress(f.address));
  if (placeholders > 0) {
    console.log(`  プレースホルダ住所 ${placeholders}件 はジオコーディング対象外（座標null）`);
  }
  if (targets.length === 0) {
    console.log('  座標補完が必要な施設はありません');
    return;
  }

  const cache = loadGeocodeCache();
  // 同一住所への重複リクエストを避けるためクエリ単位に集約
  const uniqueQueries = [...new Set(targets.map(geocodeQuery))];
  const toFetch = uniqueQueries.filter((q) => !(q in cache));

  console.log(
    `  座標補完が必要: ${targets.length}施設 / ユニーク住所 ${uniqueQueries.length}件` +
      `（キャッシュ済 ${uniqueQueries.length - toFetch.length}件、新規 ${toFetch.length}件）`,
  );

  njaConfig.cacheSize = 4000;

  let failed = 0; // 住所として解決できなかった（恒久的な失敗）
  let errored = 0; // ネットワーク障害等の一過性エラー（キャッシュせず次回再試行）

  if (GEOCODE_WORKERS > 1 && toFetch.length >= WORKER_THRESHOLD) {
    // 大量クエリ: worker_threads で複数コアに分散する（初回フル実行など）
    const r = await geocodeWithWorkers(toFetch, cache, {
      workers: GEOCODE_WORKERS,
      concurrency,
      cacheSize: 4000,
    });
    failed = r.failed;
    errored = r.errored;
  } else {
    // 少量クエリ: スレッド起動コストを避けてインラインで処理する（週次の差分など）
    let done = 0;
    let lastSave = Date.now();
    await runPool(toFetch, concurrency, async (query) => {
      try {
        const r = await normalize(query);
        if (r && r.point && Number.isFinite(r.point.lat) && Number.isFinite(r.point.lng)) {
          cache[query] = { lat: r.point.lat, lng: r.point.lng, level: r.point.level ?? null, pref: r.pref || null, city: r.city || null };
        } else if (r && (r.pref || r.city)) {
          // 座標は取れなかったが都道府県・市区町村は解決できた場合も記録（_pref/_city 補完に使う）。
          cache[query] = { lat: null, lng: null, level: null, pref: r.pref || null, city: r.city || null };
          failed++;
        } else {
          // 住所として解決できなかった恒久的な失敗。null を記録し再試行を避ける。
          cache[query] = null;
          failed++;
        }
      } catch {
        // 一過性エラーはキャッシュに書かず、次回実行時（!(q in cache)）に再試行させる。
        errored++;
      }
      done++;
      if (done % 1000 === 0) {
        console.log(`    ...${done}/${toFetch.length}件 取得`);
        // 全量シリアライズは重いので時間ベースで間引いて保存する
        if (Date.now() - lastSave >= CACHE_SAVE_INTERVAL_MS) {
          saveGeocodeCache(cache);
          lastSave = Date.now();
        }
      }
    });
  }
  saveGeocodeCache(cache);

  // キャッシュの結果を施設へ反映（座標と、未確定の都道府県・市区町村）
  let filled = 0;
  for (const f of targets) {
    const hit = cache[geocodeQuery(f)];
    if (!hit) continue;
    if (hit.lat != null && hit.lng != null) {
      f.lat = hit.lat;
      f.lng = hit.lng;
      f.geocoding_level = hit.level;
      filled++;
    }
    if ((!f._pref || f._pref === '不明') && hit.pref) f._pref = hit.pref;
    if ((!f._city || f._city === '不明') && hit.city) f._city = hit.city;
  }
  console.log(
    `  座標を補完: ${filled}/${targets.length}施設` +
      `（住所解決失敗 ${failed}件、一時エラーで未取得 ${errored}件は次回再試行）`,
  );
}
