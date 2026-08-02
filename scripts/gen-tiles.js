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
const ROOT = path.resolve(__dirname, '..');
const TILES_DIR = path.join(ROOT, 'api', 'tiles');
const LAYER = 'facilities';

const MIN_ZOOM = Number(process.env.TILES_MIN_ZOOM ?? 6);
const MAX_ZOOM = Number(process.env.TILES_MAX_ZOOM ?? 12);
// 日本のおおよその範囲 [west, south, east, north]
const BOUNDS = [122, 20, 154, 46];

// --- 低ズームの間引き設定 ---------------------------------------------------
// geojson-vt の tolerance は線・面の簡略化にしか効かず、点は全ズームでそのまま
// 焼かれる。そのため対策前は z6 の 1 タイルに全 136 万点が入り 38 MB あった
// （全ズーム合計 469 MB）。実際には低ズームで数万点が同じ画素に重なるだけなので、
// タイル内をグリッドに切って 1 セル 1 点に間引く。
//
// セル数はタイルの 1 辺あたり。タイルは概ね 512 CSS px で描かれるので、
// 64 なら 1 セル ≒ 8 px。半径 1.6〜2.8 px の円を描く用途では、
// これ以上細かくしても画面上は区別できない。
const CELLS_PER_TILE = Number(process.env.TILES_CELLS_PER_TILE ?? 64);
// 間引きを適用しない最小ズーム。最大ズームは overzoom（z13 以上）の元になるため、
// 個々の施設を残しておく必要があり、間引き対象から外す。
const DETAIL_ZOOM = Number(process.env.TILES_DETAIL_ZOOM ?? MAX_ZOOM);

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

/**
 * 経緯度を、ズーム z の「タイルをさらに cellsPerTile 分割したグリッド」の
 * セル番号 [cx, cy] に落とす（純粋関数）。
 *
 * lonLatToTile と同じ Web メルカトル式を、分母を 2^z * cellsPerTile にして
 * 使う。こうするとセル境界がタイル境界と必ず一致し、隣接タイルで同じ点が
 * 別セルに割れる（＝間引き後に継ぎ目が出る）ことがない。
 */
export function lonLatToCell(lng, lat, z, cellsPerTile) {
  const n = 2 ** z * cellsPerTile;
  const latRad = (lat * Math.PI) / 180;
  let cx = Math.floor(((lng + 180) / 360) * n);
  let cy = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  cx = Math.max(0, Math.min(n - 1, cx));
  cy = Math.max(0, Math.min(n - 1, cy));
  return [cx, cy];
}

/**
 * ズーム z 向けに feature を間引く（純粋関数）。
 *
 * グリッドの 1 セル × 1 業種につき 1 点だけ残し、まとめた件数を `count` に入れる。
 * 業種をキーに含めるのは、地図の業種フィルターを低ズームでも正しく効かせるため。
 * セル単位で 1 点に潰すと、飲食店だらけのセルに 1 軒だけある喫茶店が消え、
 * 「喫茶店で絞り込むと空白地帯ができる」という嘘の表示になる。
 *
 * 残す代表点は各セルで最初に現れた施設。ただし `name` は載せない。施設名は
 * ほぼ全件が異なる文字列で MVT のレイヤ内文字列テーブルを最も太らせる一方、
 * 間引き後の 1 点は「同じ画素に重なった複数施設の代表」でしかなく、その 1 軒の
 * 名前を出すと誤解を招くため。業種・都道府県・市区町村は異なり数が少なく
 * 文字列テーブルで共有されるので残す。
 *
 * 入力の features は変更しない。戻り値は新しい配列。
 */
export function thinFeatures(features, z, cellsPerTile = CELLS_PER_TILE) {
  const byCell = new Map();
  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates;
    const [cx, cy] = lonLatToCell(lng, lat, z, cellsPerTile);
    // 業種は生の文字列のまま鍵に使う（表記ゆれを正規化するとフィルターの
    // 部分一致条件とずれるため、ここでは束ねない）
    const key = `${cx}\u001f${cy}\u001f${f.properties.business_type}`;
    const hit = byCell.get(key);
    if (hit) {
      hit.properties.count++;
      continue;
    }
    byCell.set(key, {
      type: 'Feature',
      geometry: f.geometry,
      // name は載せない（施設名は全件ほぼ一意で MVT の文字列テーブルを最も太らせる。
      // 間引き後の 1 点は重なった複数施設の代表でしかなく、1 軒の名前を出すと誤解を招く）
      properties: {
        business_type: f.properties.business_type,
        pref: f.properties.pref,
        city: f.properties.city,
        count: 1,
      },
    });
  }
  return [...byCell.values()];
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
  // 間引きのグリッド解像度（タイル1辺あたりのセル数）と、間引きを止める最小ズーム
  cellsPerTile = CELLS_PER_TILE,
  detailZoom = DETAIL_ZOOM,
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

  let written = 0;
  let bytes = 0;

  // ズームごとに「そのズーム用に間引いた点」でインデックスを作り直す。
  // 全ズームを 1 つのインデックスで賄うと、低ズームのタイルにも全点が
  // そのまま入ってしまう（geojson-vt の簡略化は点に効かない）。
  // インデックスはズームごとに使い捨てて、同時に抱えるメモリを抑える。
  for (let z = minZoom; z <= maxZoom; z++) {
    const zoomFeatures = z >= detailZoom ? fc.features : thinFeatures(fc.features, z, cellsPerTile);
    const index = geojsonvt(
      { type: 'FeatureCollection', features: zoomFeatures },
      { maxZoom: z, indexMaxZoom: z, extent: 4096, buffer: 64, tolerance: 3 },
    );

    // このズームで点が乗るタイル座標だけを集め、非空タイルを書き出す。
    const coords = new Set();
    for (const f of zoomFeatures) {
      const [lng, lat] = f.geometry.coordinates;
      const [x, y] = lonLatToTile(lng, lat, z);
      coords.add(`${x}/${y}`);
    }

    let zoomTiles = 0;
    let zoomBytes = 0;
    for (const key of coords) {
      const [x, y] = key.split('/').map(Number);
      const tile = index.getTile(z, x, y);
      if (!tile || !tile.features.length) continue;
      const buf = Buffer.from(fromGeojsonVt({ [LAYER]: tile }, { version: 2 }));
      const dir = path.join(outDir, String(z), String(x));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${y}.pbf`), buf);
      zoomTiles++;
      zoomBytes += buf.length;
    }
    written += zoomTiles;
    bytes += zoomBytes;
    log(
      `    z${z}: ${zoomFeatures.length}点 → ${zoomTiles}タイル ` +
        `（${(zoomBytes / 1024 / 1024).toFixed(1)} MB${z >= detailZoom ? '、間引きなし' : ''}）`,
    );
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
      {
        id: LAYER,
        fields: {
          name: 'String',
          business_type: 'String',
          pref: 'String',
          city: 'String',
          // detailZoom 未満のタイルだけに載る。同じグリッドセル・同じ業種の
          // 施設を 1 点に間引いた際の元の件数。最大ズームでは全点そのままなので付かない
          count: 'Number',
        },
      },
    ],
    // 間引きの仕様。利用側が「低ズームの点は代表点である」ことを判別できるようにする
    thinning: {
      detail_zoom: detailZoom,
      cells_per_tile: cellsPerTile,
    },
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
