// ---------------------------------------------------------------------------
// README.md の統計ブロックを、生成した配信物の実測値から書き換える。
//
// <!-- STATS:START --> 〜 <!-- STATS:END --> の間を差し替える。クロール
// （crawl.js）の最後に呼ばれるので、更新のたびに README も最新になる。
// 統計値は結合CSV・ベクトルタイルの生成結果をそのまま受け取る（api/ を再走査しない）。
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const README_PATH = path.join(ROOT, 'README.md');

const START = '<!-- STATS:START -->';
const END = '<!-- STATS:END -->';

// 全国の市区町村数（東京23区を含む）。収録率の分母として使う固定値で、
// 市町村合併があったときだけ更新する。
const TOTAL_CITIES = 1741;

/** バイト数を目安のサイズ表記（KB / MB / GB）にする。 */
function humanSize(bytes) {
  if (bytes >= 1024 ** 3) return `約 ${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `約 ${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `約 ${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** 3桁区切りの数値文字列。 */
function num(n) {
  return Number(n).toLocaleString('en-US');
}

/**
 * 統計から README に埋め込む Markdown テーブルを組み立てる（純粋関数）。
 * `s` は `{ updated, csv: {...}, prefCsv: {...}, tiles: {...} }`。
 * README の読者が最初に知りたい「どれだけの量が・どこまでの範囲で入っているか」に
 * 絞った 5 行だけを出す（都道府県数・都道府県別CSV の内訳は本文と docs/DATA.md に任せる）。
 */
export function renderStats(s) {
  const date = s.updated ? new Date(s.updated * 1000).toISOString().slice(0, 10) : '—';
  return [
    `> **最終更新: ${date}**`,
    '>',
    '> | 項目 | 値 |',
    '> |---|---|',
    `> | 施設レコード数 | ${num(s.csv.rowsOut)} 件 |`,
    `> | 座標を持つ施設 | ${num(s.tiles.points)} 件 |`,
    // 収録できた市区町村の異なり数を全国の総数と並べて出す（「不明」は分子に数えない）。
    `> | 収録市区町村 | ${num(s.csv.cities)} / ${num(TOTAL_CITIES)} |`,
    `> | 結合CSV | ${humanSize(s.csv.bytes)} |`,
    `> | ベクトルタイル | ${num(s.tiles.tiles)} 枚 / ${humanSize(s.tiles.bytes)} |`,
  ].join('\n');
}

/** README の STATS ブロックを書き換える。マーカーが無ければ何もしない。 */
export function generateReadmeStats(stats) {
  const readme = fs.readFileSync(README_PATH, 'utf-8');
  const startIdx = readme.indexOf(START);
  const endIdx = readme.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    console.warn(`  README に ${START} / ${END} マーカーが無いためスキップ`);
    return null;
  }
  const before = readme.slice(0, startIdx + START.length);
  const after = readme.slice(endIdx);
  const next = `${before}\n${renderStats(stats)}\n${after}`;
  if (next !== readme) {
    fs.writeFileSync(README_PATH, next);
    console.log(`  README 統計を更新: ${num(stats.csv.rowsOut)}件 / ${stats.csv.cities}市区町村`);
  } else {
    console.log('  README 統計に変更なし');
  }
  return stats;
}
