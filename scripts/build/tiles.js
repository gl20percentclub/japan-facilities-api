// ベクトルタイル生成（z/x/y .pbf ディレクトリ）
//
// 座標を持つ施設を点(Point)として Mapbox Vector Tile（MVT）に焼き、
// GitHub Pages から直接配信できる z/x/y 形式で出力する。
//   api/tiles/{z}/{x}/{y}.pbf   MapLibre の tiles:["{z}/{x}/{y}.pbf"] でそのまま読める
//   api/tiles/metadata.json     TileJSON（レイヤ・ズーム範囲・bounds・データ統計）
//
// tippecanoe 等のシステムバイナリは不要（pure JS: geojson-vt + vt-pbf）。
// タイルは非圧縮 pbf で書くため、GitHub Pages で Content-Encoding 設定なしにそのまま配信できる。
//
// 入力はクロール結果の施設配列（メモリ上）。crawl.js から呼ばれる。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as gvtNs from 'geojson-vt';
import * as vtpbfNs from 'vt-pbf';

const geojsonvt = gvtNs.default || gvtNs;
const vtpbf = vtpbfNs.default || vtpbfNs;
const fromGeojsonVt = vtpbf.fromGeojsonVt || vtpbfNs.fromGeojsonVt;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const TILES_DIR = path.join(ROOT, 'api', 'tiles');
const LAYER = 'facilities';

const MIN_ZOOM = Number(process.env.TILES_MIN_ZOOM ?? 6);
const MAX_ZOOM = Number(process.env.TILES_MAX_ZOOM ?? 12);
// 日本のおおよその範囲 [west, south, east, north]
const BOUNDS = [122, 20, 154, 46];

// 経緯度 → スリッピータイル座標 (x, y)
export function lonLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  let x = Math.floor(((lng + 180) / 360) * n);
  let y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  x = Math.max(0, Math.min(n - 1, x));
  y = Math.max(0, Math.min(n - 1, y));
  return [x, y];
}

/** 施設配列から、座標を持つ施設だけの GeoJSON FeatureCollection を組み立てる。 */
export function buildFeatureCollection(facilities) {
  const features = [];
  for (const f of facilities) {
    if (typeof f.lat !== 'number' || typeof f.lng !== 'number') continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
      properties: {
        name: f.name || '',
        business_type: f.business_type || '',
        pref: f.pref || '',
        city: f.city || '',
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * 施設配列から z/x/y ベクトルタイルと TileJSON を生成する。
 *
 * `stats`（結合CSV 側で集計した件数）は metadata.json に埋め込み、
 * プレビュー地図(index.html)が JSON データを別途配信せずに件数を表示できるようにする。
 *
 * 生成結果 `{ tiles, points, bytes }` を返す。
 */
export function generateTiles(facilities, {
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM,
  outDir = TILES_DIR,
  updated = Math.floor(Date.now() / 1000),
  stats = null,
  log = console.log,
} = {}) {
  // metadata.json には CSV 側で数えた records と、ここで数える points が並ぶ。
  // 別々の集合から数えると両者が食い違い、配信物バリデーションで落ちる。
  // 重複除去後の施設（stats.unique）を渡し忘れた場合はここで止める。
  if (stats?.unique && stats.unique !== facilities) {
    throw new Error('ベクトルタイルは結合CSV と同じ施設集合（stats.unique）から生成すること');
  }

  const fc = buildFeatureCollection(facilities);
  if (fc.features.length === 0) {
    console.warn('  座標を持つ施設が無いため ベクトルタイルの生成をスキップ');
    return { tiles: 0, points: 0, bytes: 0 };
  }

  // 古いタイルを消してから作り直す（点が減った場合の取り残しを防ぐ）。
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const index = geojsonvt(fc, { maxZoom, extent: 4096, buffer: 64, tolerance: 3 });

  // 各点が属するタイル座標を全ズームで集め、非空タイルだけを書き出す。
  const coords = new Set();
  for (const f of fc.features) {
    const [lng, lat] = f.geometry.coordinates;
    for (let z = minZoom; z <= maxZoom; z++) {
      const [x, y] = lonLatToTile(lng, lat, z);
      coords.add(`${z}/${x}/${y}`);
    }
  }

  let written = 0;
  let bytes = 0;
  for (const key of coords) {
    const [z, x, y] = key.split('/').map(Number);
    const tile = index.getTile(z, x, y);
    if (!tile || !tile.features.length) continue;
    const buf = Buffer.from(fromGeojsonVt({ [LAYER]: tile }, { version: 2 }));
    const dir = path.join(outDir, String(z), String(x));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${y}.pbf`), buf);
    written++;
    bytes += buf.length;
  }

  // TileJSON（利用側は tiles テンプレートと vector_layers を参照）。
  // stats はプレビュー地図が読む拡張フィールド。
  const metadata = {
    tilejson: '2.2.0',
    name: 'japan-facilities',
    description: '全国 食品営業許可 施設の点データ',
    format: 'pbf',
    scheme: 'xyz',
    minzoom: minZoom,
    maxzoom: maxZoom,
    bounds: BOUNDS,
    tiles: ['{z}/{x}/{y}.pbf'],
    vector_layers: [
      { id: LAYER, fields: { name: 'String', business_type: 'String', pref: 'String', city: 'String' } },
    ],
    updated,
    stats: {
      points: fc.features.length,
      records: stats?.rowsOut ?? null,
      prefectures: stats?.prefectures ?? null,
      cities: stats?.cities ?? null,
    },
  };
  fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');

  log(
    `  ベクトルタイル: ${fc.features.length}点 → ${written}タイル（z${minZoom}-${maxZoom}, ` +
      `計 ${(bytes / 1024 / 1024).toFixed(1)} MB）→ api/tiles/`,
  );
  return { tiles: written, points: fc.features.length, bytes };
}
