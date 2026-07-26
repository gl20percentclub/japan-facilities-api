// プレビュー地図(map.html)と gen-tiles.js の生成物との整合性テスト。
//   node scripts/preview-map.test.js
//
// map.html はベクトルタイル(api/tiles)を直接読むため、レイヤ名・ズーム範囲・
// タイルパス・利用する属性・metadata.json の統計フィールドが gen-tiles.js の出力と
// ズレると地図が黙って壊れる。ここでは実際に generateTiles を走らせた生成物と
// map.html の記述を突き合わせ、両者が食い違ったら失敗させる。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFeatureCollection, generateTiles } from './gen-tiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'map.html'), 'utf-8');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// map.html から地図設定に使っている値を素朴に抽出する（フルパーサは不要）。
function htmlValue(re, label) {
  const m = HTML.match(re);
  assert.ok(m, `map.html から ${label} を抽出できる`);
  return m[1];
}

const FACILITIES = [
  { name: '店A', business_type: '飲食店営業', address: '千代田区丸の内1-1', lat: 35.681, lng: 139.767, geocoding_level: 8, pref: '東京都', city: '千代田区' },
];
const STATS = { rowsOut: 1, prefectures: 1, cities: 1 };

/** 一時ディレクトリにタイルを焼き、metadata.json を返す。 */
function withTiles(opts, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-test-'));
  try {
    const outDir = path.join(dir, 'tiles');
    generateTiles(FACILITIES, { outDir, stats: STATS, log: () => {}, ...opts });
    fn(JSON.parse(fs.readFileSync(path.join(outDir, 'metadata.json'), 'utf-8')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('source-layer が gen-tiles の出力レイヤ名(metadata.vector_layers[0].id)と一致する', () => {
  const sourceLayer = htmlValue(/'source-layer':\s*'([^']+)'/, 'source-layer');
  withTiles({ minZoom: 6, maxZoom: 12 }, (meta) => {
    assert.equal(sourceLayer, meta.vector_layers[0].id, `source-layer(${sourceLayer}) == 生成レイヤ(${meta.vector_layers[0].id})`);
  });
});

test('TILE_MIN_ZOOM / TILE_MAX_ZOOM が gen-tiles の既定ズーム範囲と一致する', () => {
  const minZoom = Number(htmlValue(/TILE_MIN_ZOOM\s*=\s*(\d+)/, 'TILE_MIN_ZOOM'));
  const maxZoom = Number(htmlValue(/TILE_MAX_ZOOM\s*=\s*(\d+)/, 'TILE_MAX_ZOOM'));
  // 既定のズーム範囲(scripts/gen-tiles.js の MIN_ZOOM/MAX_ZOOM)で生成する。
  withTiles({}, (meta) => {
    assert.equal(minZoom, meta.minzoom, `TILE_MIN_ZOOM(${minZoom}) == metadata.minzoom(${meta.minzoom})`);
    assert.equal(maxZoom, meta.maxzoom, `TILE_MAX_ZOOM(${maxZoom}) == metadata.maxzoom(${meta.maxzoom})`);
  });
});

test('タイルURLテンプレートが「api/tiles/ + metadata.tiles[0]」の配置と一致する', () => {
  withTiles({ minZoom: 6, maxZoom: 12 }, (meta) => {
    const expectedPath = `api/tiles/${meta.tiles[0]}`; // = api/tiles/{z}/{x}/{y}.pbf
    assert.ok(HTML.includes(expectedPath), `map.html がタイルパス ${expectedPath} を参照する`);
  });
});

test('ポップアップで参照する施設属性がすべて生成featureに存在する', () => {
  const props = buildFeatureCollection(FACILITIES).features[0].properties;
  // map.html が p.<prop> として参照している属性を抽出する。
  const referenced = new Set([...HTML.matchAll(/\bp\.([a-z_]+)\b/g)].map((m) => m[1]));
  assert.ok(referenced.size >= 3, `map.html が施設属性を参照している (${[...referenced].join(',')})`);
  for (const key of referenced) {
    assert.ok(key in props, `属性 ${key} が生成feature.properties に存在する`);
  }
});

test('ヘッダーの統計が参照する metadata.stats のキーがすべて生成される', () => {
  // 統計用の JSON は配信しないため、件数は metadata.json（TileJSON）から読む。
  const referenced = new Set([...HTML.matchAll(/\bstats\.([a-z_]+)\b/g)].map((m) => m[1]));
  assert.ok(referenced.size >= 1, `map.html が metadata.stats を参照している (${[...referenced].join(',')})`);
  withTiles({ minZoom: 6, maxZoom: 12 }, (meta) => {
    for (const key of referenced) {
      assert.ok(key in meta.stats, `metadata.stats.${key} が生成される`);
    }
    assert.ok('updated' in meta, 'metadata.updated が生成される（最終更新の表示に使う）');
  });
});

// 廃止した配信形式（階層JSON・検索インデックス）を参照していないこと。
test('廃止した配信形式を参照していない', () => {
  for (const gone of ['facilities/index.json', 'search-index', 'data.json']) {
    assert.ok(!HTML.includes(gone), `map.html が ${gone} を参照していない`);
  }
});

console.log(`\n✅ preview-map 整合性テスト: ${passed}件すべて合格`);
