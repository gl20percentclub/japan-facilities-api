// 地図ページ(map.html)と build/tiles.js の生成物との整合性テスト。
// 業種フィルターの整合性は scripts/map-filter.test.js が見る。
//   node scripts/preview-map.test.js
//
// map.html はベクトルタイル(api/tiles)を直接読むため、レイヤ名・ズーム範囲・
// タイルパス・利用する属性・metadata.json の統計フィールドが build/tiles.js の出力と
// ズレると地図が黙って壊れる。ここでは実際に generateTiles を走らせた生成物と
// map.html の記述を突き合わせ、両者が食い違ったら失敗させる。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFeatureCollection, generateTiles } from './build/tiles.js';

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

test('source-layer が タイル生成の出力レイヤ名(metadata.vector_layers[0].id)と一致する', () => {
  const sourceLayer = htmlValue(/'source-layer':\s*'([^']+)'/, 'source-layer');
  withTiles({ minZoom: 6, maxZoom: 12 }, (meta) => {
    assert.equal(sourceLayer, meta.vector_layers[0].id, `source-layer(${sourceLayer}) == 生成レイヤ(${meta.vector_layers[0].id})`);
  });
});

test('TILE_MIN_ZOOM / TILE_MAX_ZOOM が タイル生成の既定ズーム範囲と一致する', () => {
  const minZoom = Number(htmlValue(/TILE_MIN_ZOOM\s*=\s*(\d+)/, 'TILE_MIN_ZOOM'));
  const maxZoom = Number(htmlValue(/TILE_MAX_ZOOM\s*=\s*(\d+)/, 'TILE_MAX_ZOOM'));
  // 既定のズーム範囲(scripts/build/tiles.js の MIN_ZOOM/MAX_ZOOM)で生成する。
  withTiles({}, (meta) => {
    assert.equal(minZoom, meta.minzoom, `TILE_MIN_ZOOM(${minZoom}) == metadata.minzoom(${meta.minzoom})`);
    assert.equal(maxZoom, meta.maxzoom, `TILE_MAX_ZOOM(${maxZoom}) == metadata.maxzoom(${meta.maxzoom})`);
  });
});

test('初期ズームがタイルの最小ズーム以上で、開いた直後から点が出る', () => {
  // fitBounds で全国を収めると z5 以下になり、タイルが無くて点が1つも出ない。
  // 初期ズームはタイルの最小ズームに合わせる（定数を直接使っていることも確認する）。
  assert.ok(/zoom: TILE_MIN_ZOOM/.test(HTML), '初期ズームに TILE_MIN_ZOOM を使う');
  assert.ok(!/fitBoundsOptions/.test(HTML), '全国 fitBounds で初期表示していない');
  withTiles({}, (meta) => {
    const minZoom = Number(htmlValue(/TILE_MIN_ZOOM\s*=\s*(\d+)/, 'TILE_MIN_ZOOM'));
    assert.ok(minZoom >= meta.minzoom, `初期ズーム(${minZoom}) がタイルの最小ズーム(${meta.minzoom})以上`);
  });
  // 初期中心が日本の範囲（タイルの bounds）に収まっていること。
  const center = htmlValue(/INITIAL_CENTER = \[([^\]]+)\]/, 'INITIAL_CENTER')
    .split(',').map((v) => Number(v.trim()));
  const bounds = htmlValue(/JAPAN_BOUNDS = \[([^\]]+)\]/, 'JAPAN_BOUNDS')
    .split(',').map((v) => Number(v.trim()));
  assert.ok(center[0] > bounds[0] && center[0] < bounds[2], `初期中心の経度(${center[0]}) が日本の範囲内`);
  assert.ok(center[1] > bounds[1] && center[1] < bounds[3], `初期中心の緯度(${center[1]}) が日本の範囲内`);
});

test('タイルURLテンプレートが「api/tiles/ + metadata.tiles[0]」の配置と一致する', () => {
  // データは CloudFront 配信のため、map.html は API_BASE（.../api）を基点に組み立てる。
  // API_BASE と組み立て後のパスを突き合わせ、配信物の配置と一致するか検証する。
  const apiBase = htmlValue(/API_BASE\s*=\s*'([^']+)'/, 'API_BASE');
  assert.ok(apiBase.endsWith('/api'), `API_BASE(${apiBase}) が api/ を指す`);
  withTiles({ minZoom: 6, maxZoom: 12 }, (meta) => {
    const expectedPath = `\${API_BASE}/tiles/${meta.tiles[0]}`; // = ${API_BASE}/tiles/{z}/{x}/{y}.pbf
    assert.ok(HTML.includes(expectedPath), `map.html がタイルパス ${expectedPath} を参照する`);
    // 組み立て結果が生成物の配置（api/tiles/{z}/{x}/{y}.pbf）と一致することを確認する。
    const resolved = `${apiBase}/tiles/${meta.tiles[0]}`;
    assert.ok(
      resolved.endsWith(`api/tiles/${meta.tiles[0]}`),
      `組み立て後のタイルURL(${resolved}) が api/tiles/ 配下を指す`,
    );
  });
});

test('ポップアップのラベル定義が生成featureの属性と過不足なく一致する', () => {
  // ポップアップは feature が実際に持つ属性を出すため、ラベル定義(TILE_PROP_LABELS)が
  // 生成物とズレるとキー名がそのまま画面に出る／表示されない属性が生まれる。
  const props = Object.keys(buildFeatureCollection(FACILITIES).features[0].properties);
  const m = HTML.match(/const TILE_PROP_LABELS = \{([^}]+)\}/);
  assert.ok(m, 'map.html に TILE_PROP_LABELS が定義されている');
  const labeled = [...m[1].matchAll(/^\s*([a-z_]+):/gm)].map((x) => x[1]);
  for (const key of props) {
    assert.ok(labeled.includes(key), `生成属性 ${key} のラベルが定義されている`);
  }
  for (const key of labeled) {
    assert.ok(props.includes(key), `ラベル定義の ${key} が生成feature.properties に存在する`);
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
// 「data.json」は metadata.json に部分一致するため、パス区切り込みで判定する。
test('廃止した配信形式を参照していない', () => {
  for (const gone of ['facilities/index.json', 'search-index', '/data.json']) {
    assert.ok(!HTML.includes(gone), `map.html が ${gone} を参照していない`);
  }
});

console.log(`\n✅ preview-map 整合性テスト: ${passed}件すべて合格`);
