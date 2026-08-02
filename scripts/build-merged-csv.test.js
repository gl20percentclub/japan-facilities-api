// 結合CSV の書き出しと、バリデーションで使う CSV リーダーの往復テスト。
//   node scripts/build-merged-csv.test.js
//
// 引用符・改行・カンマを含むセルが、書き出し → 読み戻しで元の値に戻ることを確認する
// （ここが崩れると配布CSV が壊れ、バリデーションもすり抜ける）。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMergedCsv, CSV_COLUMNS, csvCell } from './build-merged-csv.js';
import { generateTiles } from './gen-tiles.js';
import { readCsvRows } from './lib/csv-read.js';
import {
  resolvePrefCity,
  applyPrefCity,
  collectCityPairs,
  stripWardSuffix,
  stripCountyPrefix,
  toMunicipality,
  isResolvablePair,
} from './lib/city-normmap.js';

/**
 * `entry` から相対 import をたどって到達できるモジュールの絶対パス集合を返す。
 * 実行せずに静的に読むだけなので、設定ファイルが無くても走る。
 */
function reachableModules(entry, seen = new Set()) {
  const abs = path.resolve(entry);
  if (seen.has(abs)) return seen;
  seen.add(abs);
  const src = fs.readFileSync(abs, 'utf-8');
  for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
    reachableModules(path.resolve(path.dirname(abs), m[1]), seen);
  }
  return seen;
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const col = Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, i]));

/** テスト用の施設（pref/city は名寄せ済みの想定）。 */
function fac(over = {}) {
  return {
    pref: '東京都', city: '港区', city_raw: '港区',
    name: '店A', name_kana: 'ミセエー', business_type: '飲食店営業',
    address: '港区赤坂1-1', lat: 35.673, lng: 139.737, geocoding_level: 8,
    phone: '03-0000-0000', license_no: '第1号', license_date: '2023-12-07', expire_date: '2030-01-31',
    _source: '東京都食品営業許可', _license: 'CC BY 4.0',
    ...over,
  };
}

async function writeCsv(facilities, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
  const outPath = path.join(dir, 'facilities-all.csv');
  const stats = await buildMergedCsv(facilities, { outPath, log: () => {}, ...opts });
  const rows = [...readCsvRows(outPath)];
  return { dir, outPath, stats, header: rows[0], rows: rows.slice(1) };
}

// --- 依存関係: 配信物の生成・検証は config/sources.yaml を要求しない ---
// クローラー（別リポジトリ）は sources.yaml をコミットせず、クロール実行時だけ
// CONFIG_PATH で公開リポのクローンを指す。配信物バリデーション（scripts/validate-api.js）は
// その環境変数なしで走るため、ここから config.js に到達すると起動時に落ちる。
// 実際に「build-merged-csv.js → lib/normalize.js → loadConfig()」の連鎖でクロールが
// 停止したことがあるので、到達不可であることを固定する。
await test('依存関係: 配信物まわりのモジュールが lib/config.js に依存しない', () => {
  for (const entry of ['./scripts/validate-api.js', './scripts/build-merged-csv.js']) {
    const reached = [...reachableModules(entry)];
    const config = reached.find((p) => p.endsWith(`${path.sep}lib${path.sep}config.js`));
    assert.equal(config, undefined, `${entry} から lib/config.js に到達してはいけない`);
  }
});

// --- csvCell（純粋関数） ---
await test('csvCell: 特殊文字を含むときだけ引用符で囲む', () => {
  assert.equal(csvCell('あ'), 'あ');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell('a\nb'), '"a\nb"');
});

// --- 書き出し → 読み戻し ---
await test('CSV: BOM なし UTF-8 でヘッダーを出し、値が往復で保たれる', async () => {
  const { dir, outPath, header, rows } = await writeCsv([fac()]);
  try {
    const buf = fs.readFileSync(outPath);
    assert.notDeepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM が付かない');
    assert.ok(buf.toString('utf-8').startsWith('prefecture,'), '1バイト目から列名が始まる');
    assert.deepEqual(header, CSV_COLUMNS);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][col.prefecture], '東京都');
    assert.equal(rows[0][col.name], '店A');
    assert.equal(rows[0][col.lat], '35.673');
    assert.equal(rows[0][col.sources], '東京都食品営業許可');
    assert.equal(rows[0][col.licenses], 'CC BY 4.0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CSV: 引用符・改行・カンマを含むセルが往復で壊れない', async () => {
  const tricky = '店"A", 2\n号店';
  const { dir, rows } = await writeCsv([fac({ name: tricky, address: 'a,b' })]);
  try {
    assert.equal(rows.length, 1, '改行入りセルでも1行として読める');
    assert.equal(rows[0][col.name], tricky);
    assert.equal(rows[0][col.address], 'a,b');
    assert.equal(rows[0].length, CSV_COLUMNS.length, '列数が保たれる');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CSV: 座標なし・null 項目は空セルになる', async () => {
  const { dir, rows } = await writeCsv([fac({ lat: null, lng: null, geocoding_level: null, license_date: null })]);
  try {
    assert.equal(rows[0][col.lat], '');
    assert.equal(rows[0][col.lng], '');
    assert.equal(rows[0][col.geocoding_level], '');
    assert.equal(rows[0][col.license_date], '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CSV: 出典を除く全列一致の重複を1行に寄せる', async () => {
  const { dir, rows, stats } = await writeCsv([
    fac(),
    fac(), // 完全重複
    fac({ _source: '別ソース', _license: 'PDL1.0' }), // 出典だけ違う＝同じ施設
    fac({ business_type: '喫茶店営業' }), // 業種違いは別の許可レコードとして残す
  ]);
  try {
    assert.equal(stats.rowsIn, 4);
    assert.equal(stats.rowsOut, 2);
    assert.equal(stats.dupSkipped, 2);
    assert.equal(rows.length, 2);
    assert.equal(rows[0][col.sources], '東京都食品営業許可', '最初に出会った出典を残す');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ベクトルタイルは stats.unique から作る。ここが CSV に書いた集合と食い違うと、
// metadata.json の records（CSV基準）と points（タイル基準）がズレて配信物の
// バリデーションが落ちる。
await test('CSV: unique が実際に書き出した施設と一致する', async () => {
  const kept = fac();
  const other = fac({ business_type: '喫茶店営業' });
  const { dir, rows, stats } = await writeCsv([
    kept,
    fac(), // 完全重複
    fac({ _source: '別ソース' }), // 出典だけ違う＝同じ施設
    other,
  ]);
  try {
    assert.equal(stats.unique.length, stats.rowsOut, 'unique の件数が CSV 行数と一致する');
    assert.equal(stats.unique.length, rows.length);
    assert.deepEqual(
      stats.unique.map((f) => f.business_type),
      [kept.business_type, other.business_type],
      '重複は除かれ、最初に出会った施設が残る',
    );
    assert.equal(stats.unique[0], kept, '施設オブジェクトの参照をそのまま返す');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CSV: 座標つきの重複は unique から落ちる（タイルの点数が CSV と揃う）', async () => {
  const { dir, stats } = await writeCsv([
    fac(),
    fac(), // 座標を持つ完全重複
    fac({ name: '店B', lat: null, lng: null }),
  ]);
  try {
    const withCoords = stats.unique.filter((f) => f.lat != null && f.lng != null).length;
    assert.equal(stats.dupSkipped, 1);
    assert.equal(withCoords, 1, '重複を数え上げず、座標ありは1件');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CSV: 都道府県・市区町村の異なり数を数える', async () => {
  const { dir, stats } = await writeCsv([
    fac(),
    fac({ name: '店B', city: '渋谷区', city_raw: '渋谷区' }),
    fac({ name: '店C', pref: '沖縄県', city: '那覇市', city_raw: '那覇市' }),
  ]);
  try {
    assert.equal(stats.prefectures, 2);
    assert.equal(stats.cities, 3);
    assert.equal(stats.prefUnknown, 0);
    assert.equal(stats.cityUnknown, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CSV: 「不明」「県外」は自治体として数えず、件数だけ残す', async () => {
  const { dir, stats, rows } = await writeCsv([
    fac(),
    fac({ name: '店B', city: '不明', city_raw: '不明' }),
    fac({ name: '店C', pref: '不明', city: '不明', city_raw: '不明' }),
    fac({ name: '店D', pref: '県外', city: '小矢部市', city_raw: '小矢部市' }),
  ]);
  try {
    assert.equal(stats.prefectures, 1, '実在の都道府県だけ数える（47を超えない）');
    assert.equal(stats.cities, 1, '実在の市区町村だけ数える（1,741を超えない）');
    assert.equal(stats.prefUnknown, 2, '不明・県外のレコード数');
    assert.equal(stats.cityUnknown, 3, '市区町村を特定できないレコード数');
    assert.equal(stats.rowsOut, 4, 'レコード自体は CSV に残す');
    assert.equal(rows.length, 4, '不明・県外の行も CSV から消えない');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CSV: gzip 版は生成しない（配布は非圧縮CSVのみ）', async () => {
  const { dir, outPath, stats } = await writeCsv([fac()]);
  try {
    assert.ok(!fs.existsSync(`${outPath}.gz`), '.csv.gz を作らない');
    assert.ok(!('gzipBytes' in stats), '統計に gzipBytes を含めない');
    assert.equal(stats.bytes, fs.statSync(outPath).size);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- 市区町村の名寄せ（純粋関数） ---
await test('resolvePrefCity: 名寄せ表があれば公式名を採用する', () => {
  const f = { _pref: '大分県', _city: '九重町', address: '大分県九重町大字後野上8-1' };
  // normalize() は郡付きの公式名を返すが、出力は郡名を外した表記に揃える。
  const r = resolvePrefCity(f, { '大分県\t九重町': { pref: '大分県', city: '玖珠郡九重町' } });
  assert.deepEqual(r, { pref: '大分県', city: '九重町', cityRaw: '九重町', colFixed: false });
});

await test('resolvePrefCity: 名寄せ表に無くても郡名は外す', () => {
  const f = { _pref: '大分県', _city: '玖珠郡九重町', address: '大分県玖珠郡九重町…' };
  assert.equal(resolvePrefCity(f, {}).city, '九重町');
  assert.equal(resolvePrefCity(f, {}).cityRaw, '玖珠郡九重町', '元の表記は city_raw に残す');
});

// --- 粒度の統一: 政令指定都市の行政区は市に集約する ---
await test('stripWardSuffix: 政令市の行政区を市に集約し、特別区はそのまま返す', () => {
  assert.equal(stripWardSuffix('横浜市戸塚区'), '横浜市');
  assert.equal(stripWardSuffix('京都市北区'), '京都市');
  assert.equal(stripWardSuffix('北九州市八幡西区'), '北九州市');
  assert.equal(stripWardSuffix('千代田区'), '千代田区', '特別区は市区町村そのもの');
  assert.equal(stripWardSuffix('四日市市'), '四日市市', '「市」で終わる市名は無傷');
  assert.equal(stripWardSuffix('河北郡津幡町'), '河北郡津幡町');
});

// --- 粒度の統一: 町村は郡名を外す ---
await test('stripCountyPrefix: 郡名を外し、郡を含む市名は残す', () => {
  assert.equal(stripCountyPrefix('河北郡津幡町'), '津幡町');
  assert.equal(stripCountyPrefix('国頭郡今帰仁村'), '今帰仁村');
  assert.equal(stripCountyPrefix('津幡町'), '津幡町', '郡なしはそのまま');
  assert.equal(stripCountyPrefix('郡上市'), '郡上市', '市名の「郡」は郡名ではない');
  assert.equal(stripCountyPrefix('大和郡山市'), '大和郡山市');
  assert.equal(stripCountyPrefix('郡山市'), '郡山市');
});

await test('toMunicipality: 郡名剥がしと行政区の集約をまとめて行う', () => {
  assert.equal(toMunicipality('河北郡津幡町'), '津幡町');
  assert.equal(toMunicipality('横浜市戸塚区'), '横浜市');
  assert.equal(toMunicipality('千代田区'), '千代田区');
});

await test('resolvePrefCity: 名寄せ結果の行政区を市へ集約する', () => {
  const f = { _pref: '神奈川県', _city: '横浜市', address: '神奈川県横浜市戸塚区戸塚町16-1' };
  const normMap = { '神奈川県\t横浜市': { pref: '神奈川県', city: '横浜市戸塚区' } };
  const r = resolvePrefCity(f, normMap);
  assert.equal(r.city, '横浜市');
  assert.equal(r.cityRaw, '横浜市', '元データの表記は city_raw に残す');
});

await test('applyPrefCity: 郡あり・郡なしの表記ゆれが同じ市区町村に揃う', () => {
  const facilities = [
    { _pref: '石川県', _city: '河北郡津幡町', address: '石川県河北郡津幡町字加賀爪ニ3' },
    { _pref: '石川県', _city: '津幡町', address: '石川県津幡町字加賀爪ニ3' },
  ];
  // 郡付き側だけ名寄せに成功したケース（名寄せの成否によらず同じ値になる）。
  applyPrefCity(facilities, {
    '石川県\t河北郡津幡町': { pref: '石川県', city: '河北郡津幡町' },
  });
  assert.equal(facilities[0].city, '津幡町');
  assert.equal(facilities[1].city, '津幡町');
  assert.equal(facilities[0].city_raw, '河北郡津幡町', '元の表記は city_raw に残す');
});

await test('resolvePrefCity: 列ズレ（pref に郵便番号・city に都道府県名）を住所から復元する', () => {
  const f = { _pref: '9300000', _city: '富山県', address: '富山県高岡市広小路7-50' };
  const r = resolvePrefCity(f, {});
  assert.equal(r.pref, '富山県');
  assert.equal(r.city, '高岡市');
  assert.equal(r.colFixed, true);
});

await test('applyPrefCity: 施設に pref / city / city_raw を書き込み件数を返す', () => {
  const facilities = [
    { _pref: '大分県', _city: '玖珠郡九重町', address: '大分県玖珠郡九重町…' },
    { _pref: '東京都', _city: '港区', address: '東京都港区赤坂1-1' },
  ];
  const { colFixedCount, mergedCount } = applyPrefCity(facilities, {
    '大分県\t玖珠郡九重町': { pref: '大分県', city: '玖珠郡九重町' },
  });
  assert.equal(facilities[0].city, '九重町');
  assert.equal(facilities[0].city_raw, '玖珠郡九重町');
  assert.equal(facilities[1].city, '港区');
  assert.equal(colFixedCount, 0);
  assert.equal(mergedCount, 1, '表記が変わった件数を数える');
});

await test('collectCityPairs: ユニークな (都道府県, 市区町村) を代表住所つきで集める', () => {
  const pairs = collectCityPairs([
    { _pref: '東京都', _city: '港区', address: '' },
    { _pref: '東京都', _city: '港区', address: '東京都港区赤坂1-1' },
    { _pref: '東京都', _city: '渋谷区', address: '東京都渋谷区1-1' },
    { address: '住所のみ' }, // pref/city 未解決＝自治体を特定しないので対象外
  ]);
  assert.equal(pairs.length, 2);
  assert.equal(pairs.find((p) => p.city === '港区').addr, '東京都港区赤坂1-1', '空でない住所を代表にする');
  assert.ok(
    !pairs.some((p) => p.city === '不明'),
    '「不明」ペアは代表住所を立てられないので名寄せ対象にしない',
  );
});

// --- 代表住所の焼き付き防止 ---
// 名寄せはペアごとに代表住所1件を正規化して全件へ適用するため、自治体を
// 特定しないペア（'不明'）に適用すると無関係なレコードに自治体名が焼き付く。
await test('isResolvablePair: 自治体を特定しないペアは名寄せ対象にしない', () => {
  assert.equal(isResolvablePair('三重県', '四日市市'), true);
  assert.equal(isResolvablePair('三重県', '不明'), false);
  assert.equal(isResolvablePair('三重県', ''), false);
  assert.equal(isResolvablePair('不明', '不明'), false);
  assert.equal(isResolvablePair('9300000', '四日市市'), false, '都道府県が不正なら信用しない');
});

await test('resolvePrefCity: 「不明」ペアには名寄せ表を適用しない', () => {
  // 実際に起きた事故: (不明, 不明) のバケツに横須賀市の住所が代表として入り、
  // 四日市市のレコード3,740件が「神奈川県横須賀市」として出力された。
  const normMap = { '不明\t不明': { pref: '神奈川県', city: '横須賀市' } };
  const f = { _pref: '不明', _city: '不明', address: '四日市市安島1-3-18' };
  const r = resolvePrefCity(f, normMap);
  assert.notEqual(r.pref, '神奈川県', '他レコードの自治体名を焼き付けない');
  assert.equal(r.city, '不明');
});

await test('resolvePrefCity: 市区町村カラムが無いソースは「不明」のままにする', () => {
  // 住所から推測すると大字（「南ぬ浜町」= 石垣市の町名）や政令市の行政区を
  // 自治体名として拾ってしまうため、実在しない市区町村を作るより不明を残す。
  const r = resolvePrefCity({ _pref: '三重県', _city: '不明', address: '四日市市安島1-3-18' }, {});
  assert.equal(r.pref, '三重県', '都道府県は元データの値を保つ');
  assert.equal(r.city, '不明');
});

await test('applyPrefCity: 同じ「不明」バケツの別ソースが同じ自治体に化けない', () => {
  // 実際に起きた事故: 鹿児島県・熊本県・静岡市など8県ぶんのソース 2,641件が
  // すべて「福岡県久留米市」として配信されていた。
  const facilities = [
    { _pref: '不明', _city: '不明', address: '' },
    { _pref: '不明', _city: '不明', address: '' },
  ];
  applyPrefCity(facilities, { '不明\t不明': { pref: '福岡県', city: '久留米市' } });
  for (const f of facilities) {
    assert.equal(f.pref, '不明');
    assert.equal(f.city, '不明');
  }
});

await test('resolvePrefCity: 都道府県が不明でも住所が県名で始まれば列ズレ補正で復元する', () => {
  // 既存の列ズレ補正の経路。レコードごとに自分の住所を見るので焼き付きは起きない。
  const normMap = { '不明\t不明': { pref: '福岡県', city: '久留米市' } };
  const r = resolvePrefCity({ _pref: '不明', _city: '不明', address: '石川県河北郡津幡町字加賀爪ニ3' }, normMap);
  assert.equal(r.pref, '石川県');
  assert.equal(r.city, '津幡町');
});

// --- 配信物どうしの整合 ---
// scripts/validate-api.js が本番データで確認している不変条件を、小さなフィクスチャで先に潰す。
// 実際に metadata.stats.points（タイル基準）と CSV の座標あり件数がズレて
// クロールが失敗したことがある（タイルだけ重複除去前の配列から作っていた）。
await test('配信物: metadata.stats が CSV の件数と一致する', async () => {
  const { dir, outPath, stats, rows } = await writeCsv(
    [
      fac(),
      fac(), // 座標つきの完全重複
      fac({ name: '店B' }),
      fac({ name: '店C', lat: null, lng: null }), // 座標なし
    ],
    { gzip: false },
  );
  try {
    const outDir = path.join(path.dirname(outPath), 'tiles');
    generateTiles(stats.unique, { minZoom: 12, maxZoom: 12, outDir, stats, log: () => {} });
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'metadata.json'), 'utf-8'));

    const withCoords = rows.filter((r) => r[col.lat] !== '' && r[col.lng] !== '').length;
    assert.equal(meta.stats.records, rows.length, 'records が CSV 行数と一致する');
    assert.equal(meta.stats.points, withCoords, 'points が CSV の座標あり件数と一致する');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('配信物: 重複除去前の配列からタイルを作ろうとすると止まる', async () => {
  const facilities = [fac(), fac()];
  const { dir, outPath, stats } = await writeCsv(facilities, { gzip: false });
  try {
    assert.throws(
      () => generateTiles(facilities, {
        outDir: path.join(path.dirname(outPath), 'tiles'),
        stats,
        log: () => {},
      }),
      /stats\.unique/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n✅ 結合CSV / 名寄せ テスト: ${passed}件すべて合格`);
