// 市区町村名の名寄せ（表記ゆれの統一）。
//
// 元データの市区町村表記は自治体・ソースによって揺れる（「今帰仁村」/「国頭郡今帰仁村」、
// 県名が欠けた住所、pref 列に郵便番号が入った列ズレ等）。ここでは
// @geolonia/normalize-japanese-addresses で公式の都道府県・市区町村名へ寄せた
// 対応表を作り、各施設に確定した pref / city / city_raw を付与する。
//
// 正規化の呼び出しは (都道府県, 市区町村) のユニークなペア（全国で約2,000通り）だけに
// 絞る。施設全件（140万件超）を正規化する必要はないため、並列8本で数分で終わる。

import { normalize } from '@geolonia/normalize-japanese-addresses';
import { PREFECTURE_NAMES, splitPrefCity } from './normalize.js';

const PREFS = new Set(PREFECTURE_NAMES);

/**
 * 郡名プレフィックスを剥がすフォールバック（名寄せ表で解決できなかった場合）。
 * 例: 「玖珠郡九重町」→「九重町」
 */
function stripCountyPrefix(city) {
  const m = String(city).match(/郡(.+?[町村])$/);
  return m ? m[1] : city;
}

/**
 * 施設配列から、名寄せ対象の (都道府県, 市区町村) ユニークペアを代表住所つきで集める。
 * normalize() は住所文字列を要するため、そのペアに属する最初の住所を1件拾う。
 */
export function collectCityPairs(facilities) {
  const pairs = new Map(); // "pref\tcity" -> { pref, city, addr }
  for (const f of facilities) {
    const pref = f._pref || '不明';
    const city = f._city || '不明';
    const key = `${pref}\t${city}`;
    const hit = pairs.get(key);
    if (!hit) pairs.set(key, { pref, city, addr: f.address || '' });
    else if (!hit.addr && f.address) hit.addr = f.address; // 住所を持つ代表を優先
  }
  return [...pairs.values()];
}

/** 指定並列数で items を順に処理する簡易ワーカープール。 */
async function runPool(items, concurrency, worker) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await worker(items[i]);
      }
    }),
  );
}

/**
 * 名寄せ表を作る。
 * キー `"生pref\t生city"` → `{ pref, city }`（正規化後）または `null`（解決不能）。
 */
export async function buildCityNormMap(facilities, { concurrency = 8, log = console.log } = {}) {
  const pairs = collectCityPairs(facilities);
  log(`  名寄せ対象: ${pairs.length} 市区町村`);

  const map = {};
  let ok = 0;
  let ng = 0;

  await runPool(pairs, concurrency, async (p) => {
    // 住所が都道府県名で始まらない場合は前置して精度を上げる（県名なし住所への対応）。
    let q = p.addr;
    const pref = PREFS.has(p.pref) ? p.pref : '';
    if (pref && q && !q.startsWith(pref)) q = pref + q;
    try {
      const r = q ? await normalize(q) : null;
      if (r?.pref && r?.city) {
        map[`${p.pref}\t${p.city}`] = { pref: r.pref, city: r.city };
        ok++;
        return;
      }
    } catch {
      /* 解決不能として扱う */
    }
    map[`${p.pref}\t${p.city}`] = null;
    ng++;
  });

  log(`  名寄せ表: 成功 ${ok} / 解決不能 ${ng}`);
  return map;
}

/**
 * 1施設分の確定 pref / city / city_raw を求める（純粋関数）。
 *
 * 1. 列ズレ補正: pref が都道府県名でない（郵便番号等）／city に都道府県名が入っている
 *    ソース（富山県の数件）は、住所先頭から都道府県・市区町村を復元する。
 * 2. 名寄せ: 名寄せ表にあれば公式の都道府県・市区町村名を採用。無ければ郡名剥がし。
 */
export function resolvePrefCity(facility, normMap = {}) {
  const rawPref = facility._pref || '不明';
  const rawCity = facility._city || '不明';

  let pref = rawPref;
  let cityRaw = rawCity;
  let colFixed = false;

  if (!PREFS.has(pref) || PREFS.has(cityRaw)) {
    if (PREFS.has(cityRaw)) pref = cityRaw; // city 側に入っていた都道府県名を採用
    const [p, c] = splitPrefCity(facility.address);
    if (!PREFS.has(pref) && p) pref = p;
    if (c) cityRaw = c;
    colFixed = true;
  }

  const nm = normMap[`${rawPref}\t${rawCity}`];
  if (nm?.pref && nm?.city) return { pref: nm.pref, city: nm.city, cityRaw, colFixed };
  return { pref, city: stripCountyPrefix(cityRaw), cityRaw, colFixed };
}

/**
 * 施設配列に確定した pref / city / city_raw を書き込む（破壊的）。
 * 以降の出力（結合CSV・ベクトルタイル）は共通してこの値を使う。
 * 補正・名寄せの件数を返す。
 */
export function applyPrefCity(facilities, normMap) {
  let colFixedCount = 0;
  let mergedCount = 0;
  for (const f of facilities) {
    const { pref, city, cityRaw, colFixed } = resolvePrefCity(f, normMap);
    f.pref = pref;
    f.city = city;
    f.city_raw = cityRaw;
    if (colFixed) colFixedCount++;
    if (city !== cityRaw) mergedCount++;
  }
  return { colFixedCount, mergedCount };
}
