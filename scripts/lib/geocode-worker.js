// ジオコーディングのワーカースレッド本体。
//
// メインスレッド（geocode.js）から住所クエリの一部（sorted + 連続チャンク =
// ほぼ市区町村単位でまとまった集合）を受け取り、normalize() で解決して
// 結果をバッチで返す。normalize() は市区町村辞書の照合が CPU 主体のため、
// worker_threads で複数コアに分散すると実行時間がほぼ線形に縮む。
//
// メッセージ仕様（worker → main）:
//   { type: 'batch', entries: {query: 結果|null}, failed, errored }
//     ... BATCH_SIZE 件ごと＋終了時に送る差分。errored のクエリは entries に
//         含まれない（メイン側でキャッシュされず、次回実行時に再試行される）
//   { type: 'done' } ... 全クエリ処理完了

import { parentPort, workerData } from 'node:worker_threads';
import { normalize, config as njaConfig } from '@geolonia/normalize-japanese-addresses';

const { queries, concurrency, cacheSize } = workerData;

// 市区町村辞書の LRU。チャンクは市区町村単位でまとまっているためよく効く。
njaConfig.cacheSize = cacheSize;

// メインへ送る結果バッチの単位（進捗表示・キャッシュ保存の粒度になる）
const BATCH_SIZE = 1000;

let entries = {};
let failed = 0; // 住所として解決できなかった（恒久的な失敗。null をキャッシュ）
let errored = 0; // ネットワーク障害等の一過性エラー（キャッシュせず次回再試行）

/** 溜まった結果をメインスレッドへ送って空にする。 */
function flush() {
  parentPort.postMessage({ type: 'batch', entries, failed, errored });
  entries = {};
  failed = 0;
  errored = 0;
}

// 指定並列数でクエリを処理する単純なワーカープール（geocode.js と同じ方式）
let next = 0;
let processed = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, queries.length) }, async () => {
    while (next < queries.length) {
      const query = queries[next++];
      try {
        const r = await normalize(query);
        if (r && r.point && Number.isFinite(r.point.lat) && Number.isFinite(r.point.lng)) {
          entries[query] = {
            lat: r.point.lat,
            lng: r.point.lng,
            level: r.point.level ?? null,
            pref: r.pref || null,
            city: r.city || null,
          };
        } else if (r && (r.pref || r.city)) {
          // 座標は取れなかったが都道府県・市区町村は解決できた場合も記録する
          entries[query] = { lat: null, lng: null, level: null, pref: r.pref || null, city: r.city || null };
          failed++;
        } else {
          entries[query] = null;
          failed++;
        }
      } catch {
        errored++;
      }
      processed++;
      if (processed % BATCH_SIZE === 0) flush();
    }
  }),
);

flush();
parentPort.postMessage({ type: 'done' });
