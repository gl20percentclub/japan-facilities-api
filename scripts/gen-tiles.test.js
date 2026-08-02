// gen-tiles.js のユニットテスト。
//   node scripts/gen-tiles.test.js
// タイル座標計算(lonLatToTile)と、一時ディレクトリに対する generateTiles の生成結果を検証する。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  lonLatToTile,
  lonLatToCell,
  thinFeatures,
  buildFeatureCollection,
  generateTiles,
} from './gen-tiles.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// --- lonLatToTile: スリッピータイル座標（独立した基準で検証） ---
test('lonLatToTile: z0 は常に (0,0)', () => {
  assert.deepEqual(lonLatToTile(139.7, 35.6, 0), [0, 0]);
  assert.deepEqual(lonLatToTile(-70, 40, 0), [0, 0]);
});
test('lonLatToTile: z1 は経度・緯度の符号で象限が決まる', () => {
  assert.deepEqual(lonLatToTile(0.1, 0.1, 1), [1, 0]);   // 東・北
  assert.deepEqual(lonLatToTile(-0.1, 0.1, 1), [0, 0]);  // 西・北
  assert.deepEqual(lonLatToTile(0.1, -0.1, 1), [1, 1]);  // 東・南
  assert.deepEqual(lonLatToTile(-0.1, -0.1, 1), [0, 1]); // 西・南
});
test('lonLatToTile: 範囲外の座標は 0..2^z-1 にクランプ', () => {
  const [x, y] = lonLatToTile(999, 999, 3); // 8x8 グリッド
  assert.ok(x >= 0 && x <= 7 && y >= 0 && y <= 7, `クランプされる (${x},${y})`);
});
// 逆変換でタイルの地理境界を求め、元の点がそのタイルに含まれることを確認する
// （実装式の自己参照でなく、独立した基準での正しさ検証）。
test('lonLatToTile: 返したタイルの境界内に元の点が含まれる', () => {
  const tile2lng = (x, z) => (x / 2 ** z) * 360 - 180;
  const tile2lat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
  for (const [lng, lat] of [[139.7671, 35.6812], [135.5, 34.7], [141.35, 43.06], [127.68, 26.21]]) {
    for (const z of [6, 10, 12]) {
      const [x, y] = lonLatToTile(lng, lat, z);
      const west = tile2lng(x, z), east = tile2lng(x + 1, z);
      const north = tile2lat(y, z), south = tile2lat(y + 1, z);
      assert.ok(lng >= west && lng < east, `lng ${lng} が [${west},${east}) 内 (z${z})`);
      assert.ok(lat <= north && lat > south, `lat ${lat} が (${south},${north}] 内 (z${z})`);
    }
  }
});

// --- lonLatToCell: 間引き用グリッド ---
// セル境界がタイル境界と一致していないと、間引き後に隣接タイルの継ぎ目で
// 点の密度が変わる。cellsPerTile で割ればタイル座標に戻ることで検証する。
test('lonLatToCell: セルをタイルサイズで割るとタイル座標に一致する', () => {
  for (const [lng, lat] of [[139.7671, 35.6812], [135.5, 34.7], [141.35, 43.06], [127.68, 26.21]]) {
    for (const z of [6, 9, 12]) {
      for (const cells of [16, 64]) {
        const [cx, cy] = lonLatToCell(lng, lat, z, cells);
        const [x, y] = lonLatToTile(lng, lat, z);
        assert.deepEqual(
          [Math.floor(cx / cells), Math.floor(cy / cells)],
          [x, y],
          `z${z} cells=${cells} のセルがタイル ${x}/${y} に収まる`,
        );
      }
    }
  }
});
test('lonLatToCell: cellsPerTile=1 は lonLatToTile と同じ', () => {
  assert.deepEqual(lonLatToCell(139.7671, 35.6812, 10, 1), lonLatToTile(139.7671, 35.6812, 10));
});
test('lonLatToCell: ズームが上がるほどセルは細かくなる', () => {
  // 100m ほど離れた 2 点。低ズームでは同じセル、高ズームでは別セルになる
  const a = [139.7671, 35.6812];
  const b = [139.7682, 35.6812];
  assert.deepEqual(lonLatToCell(...a, 6, 64), lonLatToCell(...b, 6, 64), 'z6 では同じセル');
  assert.notDeepEqual(lonLatToCell(...a, 16, 64), lonLatToCell(...b, 16, 64), 'z16 では別セル');
});

// --- thinFeatures: 低ズームの間引き ---
/** テスト用の点 feature を作る。 */
function pt(lng, lat, props) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props };
}

test('thinFeatures: 同じセル・同じ業種は1点にまとめ count に件数を入れる', () => {
  const base = { name: '店', business_type: '飲食店営業', pref: '東京都', city: '港区' };
  // 数 m 差の 3 点（z6 では確実に同じセル）
  const out = thinFeatures(
    [
      pt(139.7671, 35.6812, { ...base, name: '店A' }),
      pt(139.7672, 35.6813, { ...base, name: '店B' }),
      pt(139.7673, 35.6814, { ...base, name: '店C' }),
    ],
    6,
    64,
  );
  assert.equal(out.length, 1, '1点に潰れる');
  assert.equal(out[0].properties.count, 3, 'まとめた件数が count に入る');
});

test('thinFeatures: 同じセルでも業種が違えば残る（業種フィルターを壊さない）', () => {
  const at = (business_type) => pt(139.7671, 35.6812, { name: '店', business_type, pref: '東京都', city: '港区' });
  const out = thinFeatures([at('飲食店営業'), at('飲食店営業'), at('喫茶店営業')], 6, 64);
  assert.equal(out.length, 2, '業種ごとに代表が残る');
  const counts = Object.fromEntries(out.map((f) => [f.properties.business_type, f.properties.count]));
  assert.deepEqual(counts, { 飲食店営業: 2, 喫茶店営業: 1 });
});

test('thinFeatures: 離れた点は潰れない', () => {
  const base = { name: '店', business_type: '飲食店営業', pref: '東京都', city: '港区' };
  // 東京と大阪
  const out = thinFeatures([pt(139.7671, 35.6812, base), pt(135.5023, 34.6937, base)], 6, 64);
  assert.equal(out.length, 2);
});

test('thinFeatures: name は落とし、業種・都道府県・市区町村は残す', () => {
  const out = thinFeatures(
    [pt(139.7671, 35.6812, { name: '店A', business_type: '飲食店営業', pref: '東京都', city: '港区' })],
    6,
    64,
  );
  const props = out[0].properties;
  assert.ok(!('name' in props), 'name は載せない（文字列テーブルが太るため）');
  assert.equal(props.business_type, '飲食店営業');
  assert.equal(props.pref, '東京都');
  assert.equal(props.city, '港区');
});

test('thinFeatures: 入力の features を書き換えない', () => {
  const input = [pt(139.7671, 35.6812, { name: '店A', business_type: '飲食店営業', pref: '東京都', city: '港区' })];
  thinFeatures(input, 6, 64);
  assert.deepEqual(input[0].properties, { name: '店A', business_type: '飲食店営業', pref: '東京都', city: '港区' });
});

test('thinFeatures: グリッドが細かいほど残る点が増える', () => {
  const base = { name: '店', business_type: '飲食店営業', pref: '東京都', city: '港区' };
  // 東京駅周辺に 0.01 度刻みで並べた 25 点
  const features = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) features.push(pt(139.76 + i * 0.01, 35.68 + j * 0.01, base));
  }
  const coarse = thinFeatures(features, 6, 16).length;
  const fine = thinFeatures(features, 6, 256).length;
  assert.ok(coarse < fine, `粗いグリッドのほうが点が減る (${coarse} < ${fine})`);
  assert.ok(fine <= features.length, '元の点数は超えない');
});

// --- buildFeatureCollection / generateTiles: インメモリの施設配列で検証 ---
function makeFacilities() {
  return [
    { name: '店A', business_type: '飲食店営業', address: '港区赤坂1-1', lat: 35.673, lng: 139.737, geocoding_level: 8, pref: '東京都', city: '港区' },
    { name: '店B', business_type: '喫茶店営業', address: '港区六本木6-1', lat: 35.662, lng: 139.731, geocoding_level: 8, pref: '東京都', city: '港区' },
    { name: '座標なし', business_type: '飲食店営業', address: '港区不明', lat: null, lng: null, geocoding_level: null, pref: '東京都', city: '港区' },
  ];
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tiles-test-'));
}

test('buildFeatureCollection: 座標を持つ施設だけを点に変換する', () => {
  const fc = buildFeatureCollection(makeFacilities());
  assert.equal(fc.type, 'FeatureCollection');
  assert.equal(fc.features.length, 2); // 座標なしは除外
  const f = fc.features[0];
  assert.equal(f.geometry.type, 'Point');
  assert.deepEqual(f.geometry.coordinates, [139.737, 35.673]); // [lng, lat]
  assert.equal(f.properties.pref, '東京都');
  assert.equal(f.properties.city, '港区');
  assert.ok('name' in f.properties && 'business_type' in f.properties);
});

test('generateTiles: metadata.json と、各点に対応する非空 pbf タイルを生成する', () => {
  const dir = tmpDir();
  const outDir = path.join(dir, 'tiles');
  try {
    const { tiles: written, points } = generateTiles(makeFacilities(), {
      minZoom: 12,
      maxZoom: 12,
      outDir,
      updated: 1749600000,
      stats: { rowsOut: 3, prefectures: 1, cities: 1 },
      log: () => {},
    });
    assert.ok(written >= 1, `タイルが1枚以上生成される (${written})`);
    assert.equal(points, 2, '座標を持つ点だけが焼かれる');

    // metadata.json（TileJSON）の要点
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'metadata.json'), 'utf-8'));
    assert.equal(meta.format, 'pbf');
    assert.equal(meta.minzoom, 12);
    assert.equal(meta.maxzoom, 12);
    assert.deepEqual(meta.tiles, ['{z}/{x}/{y}.pbf']);
    assert.equal(meta.vector_layers[0].id, 'facilities');

    // プレビュー地図が読む統計が埋め込まれている
    assert.equal(meta.updated, 1749600000);
    assert.deepEqual(meta.stats, { points: 2, records: 3, prefectures: 1, cities: 1 });

    // フィクスチャの点が属する z12 タイルに、非空の .pbf が実在する
    // （書き出しパスが lonLatToTile と整合していることの検証）
    const [x, y] = lonLatToTile(139.737, 35.673, 12);
    const pbfPath = path.join(outDir, '12', String(x), `${y}.pbf`);
    assert.ok(fs.existsSync(pbfPath), `点に対応する pbf が存在する: 12/${x}/${y}.pbf`);
    assert.ok(fs.statSync(pbfPath).size > 0, 'pbf が非空である');

    // 出力された .pbf の総数が戻り値(written)と一致する
    const pbfCount = fs
      .readdirSync(outDir)
      .filter((z) => /^\d+$/.test(z))
      .reduce((n, z) => n + fs.readdirSync(path.join(outDir, z)).reduce((m, xx) => m + fs.readdirSync(path.join(outDir, z, xx)).length, 0), 0);
    assert.equal(pbfCount, written, `.pbf 数(${pbfCount}) が戻り値(${written})と一致`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n✅ gen-tiles ユニットテスト: ${passed}件すべて合格`);
