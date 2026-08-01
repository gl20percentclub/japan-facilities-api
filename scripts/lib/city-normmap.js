// 市区町村名の名寄せ（表記ゆれの統一）。
//
// 元データの市区町村表記は自治体・ソースによって揺れる（「今帰仁村」/「国頭郡今帰仁村」、
// 県名が欠けた住所、pref 列に郵便番号が入った列ズレ等）。ここでは
// @geolonia/normalize-japanese-addresses で公式の都道府県・市区町村名へ寄せた
// 対応表を作り、各施設に確定した pref / city / city_raw を付与する。
//
// 出力する city の粒度は「市区町村」に揃える。具体的には次の2点を保証する:
//   - 政令指定都市の行政区は市に集約する（「横浜市戸塚区」→「横浜市」）。
//     splitPrefCity（normalize.js）と同じ粒度に合わせるため。
//   - 町村は郡付きの公式表記に揃える（「津幡町」→「河北郡津幡町」）。
//     名寄せに成功した表記が郡付きなので、解決できなかった側をそちらへ寄せる。
// 揃えないと、同じ自治体が「横浜市戸塚区」「河北郡津幡町」「津幡町」のように
// 複数の値へ分裂し、市区町村の異なり数が実際の自治体数（1,741）を超えてしまう。
//
// 正規化の呼び出しは (都道府県, 市区町村) のユニークなペア（全国で約2,000通り）だけに
// 絞る。施設全件（140万件超）を正規化する必要はないため、並列8本で数分で終わる。

import { normalize } from '@geolonia/normalize-japanese-addresses';
import { PREFECTURE_NAMES, splitPrefCity } from './normalize.js';

const PREFS = new Set(PREFECTURE_NAMES);

/**
 * 郡名プレフィックスを剥がす。例: 「玖珠郡九重町」→「九重町」
 * 郡付き・郡なしの表記ゆれを突き合わせるためのキー作りに使う（出力値には使わない）。
 */
function stripCountyPrefix(city) {
  const m = String(city).match(/郡(.+?[町村])$/);
  return m ? m[1] : city;
}

/**
 * 政令指定都市の行政区を市に集約する（純粋関数）。
 * 例: 「横浜市戸塚区」→「横浜市」、「京都市北区」→「京都市」
 * 市名を含まない特別区（「千代田区」）や行政区単独の値はそのまま返す。
 */
export function stripWardSuffix(city) {
  const m = String(city).match(/^(.+?市).+区$/);
  return m ? m[1] : city;
}

/**
 * 名寄せ表の値から「郡なし町村名 → 郡付き公式名」の対応表を作る（純粋関数）。
 * キーは `"都道府県\t郡なし町村名"`。
 *
 * 名寄せに失敗したペア（normMap の値が null）は郡付きの公式名が分からないため、
 * 同じ実行内で名寄せに成功した他ソースの結果を辞書として流用する。
 */
export function buildCountyAliasMap(normMap = {}) {
  const alias = {};
  for (const v of Object.values(normMap)) {
    if (!v?.pref || !v?.city) continue;
    const short = stripCountyPrefix(v.city);
    // 郡付きの値だけが対応表になる（「九重町」→「玖珠郡九重町」）。
    if (short !== v.city) alias[`${v.pref}\t${short}`] = v.city;
  }
  return alias;
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
 * 2. 名寄せ: 名寄せ表にあれば公式の都道府県・市区町村名を採用。無ければ郡付き対応表
 *    （countyAlias）で公式表記を補う。
 * 3. 粒度統一: どちらの経路でも政令指定都市の行政区は市に集約する。
 */
export function resolvePrefCity(facility, normMap = {}, countyAlias = {}) {
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
  if (nm?.pref && nm?.city) {
    return { pref: nm.pref, city: stripWardSuffix(nm.city), cityRaw, colFixed };
  }
  // 名寄せできなかった分は、郡付き対応表があれば公式表記へ寄せる（無ければ元の表記のまま）。
  const official = countyAlias[`${pref}\t${stripCountyPrefix(cityRaw)}`];
  return { pref, city: stripWardSuffix(official || cityRaw), cityRaw, colFixed };
}

/**
 * 施設配列に確定した pref / city / city_raw を書き込む（破壊的）。
 * 以降の出力（結合CSV・ベクトルタイル）は共通してこの値を使う。
 * 郡付き対応表は名寄せ表から自動で作る（テスト等から明示的に渡すこともできる）。
 * 補正・名寄せの件数を返す。
 */
export function applyPrefCity(facilities, normMap, countyAlias = buildCountyAliasMap(normMap)) {
  let colFixedCount = 0;
  let mergedCount = 0;
  for (const f of facilities) {
    const { pref, city, cityRaw, colFixed } = resolvePrefCity(f, normMap, countyAlias);
    f.pref = pref;
    f.city = city;
    f.city_raw = cityRaw;
    if (colFixed) colFixedCount++;
    if (city !== cityRaw) mergedCount++;
  }
  return { colFixedCount, mergedCount };
}
