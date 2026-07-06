// ---------------------------------------------------------------------------
// api/facilities 配下の施設データを GeonicDB（FIWARE / NGSI-LD）へ投入するための
// NGSI-LD エンティティ（type: PointOfInterest）に変換し、チャンク分割して書き出す。
//
// - 型は Smart Data Model の PointOfInterest に寄せる（name / category / address /
//   location(GeoProperty)）。location を持たせることで GeonicDB の geo-query
//   （georel near 等）が効くようになる。
// - id は「名前+座標」の安定ハッシュにするので、再クロール後に投入し直しても
//   upsert が冪等（同じ施設は重複しない）。search-index.json と同じ粒度で重複排除する。
// - 全国スケール前提: 都道府県フォルダ名を address.addressRegion に流用するので、
//   沖縄県以外を api/ に足しても変換側は無改修で動く。
//
// 出力: build/ngsild/entities-NNNN.json（NGSI-LD エンティティ配列。gitignore 対象）
//
// 使い方:
//   node scripts/gen-ngsild.js                 既定チャンクサイズ(1000)で生成
//   node scripts/gen-ngsild.js --chunk 500     チャンクサイズ指定
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FACILITIES_DIR = path.join(ROOT, 'api', 'facilities');
const OUT_DIR = path.join(ROOT, 'build', 'ngsild');

/** 座標を 6 桁に丸める（約 0.1m 精度で十分。search-index.json と同じ丸め）。 */
function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

/** 名前+座標から安定した URN を作る（冪等 upsert 用）。 */
function entityId(name, lat, lng) {
  const hash = crypto.createHash('sha1').update(`${name}|${lat}|${lng}`).digest('hex').slice(0, 16);
  return `urn:ngsi-ld:PointOfInterest:${hash}`;
}

/**
 * 重複排除済みの施設 1 件を NGSI-LD エンティティに変換する。
 * category は業種（business_type）の配列、address は都道府県・市区町村つきの構造化住所。
 */
export function facilityToEntity(f, pref, city) {
  const lat = round6(f.lat);
  const lng = round6(f.lng);
  const entity = {
    id: entityId(f.name, lat, lng),
    type: 'PointOfInterest',
    name: { type: 'Property', value: f.name },
    category: { type: 'Property', value: f.categories },
    address: {
      type: 'Property',
      value: {
        addressCountry: 'JP',
        addressRegion: pref,
        addressLocality: city,
        streetAddress: f.address ?? '',
      },
    },
    location: {
      type: 'GeoProperty',
      value: { type: 'Point', coordinates: [lng, lat] },
    },
    // データセット出所（全国で複数ソースを混ぜても由来を辿れるように）。
    source: { type: 'Property', value: 'japan-facilities-address' },
  };
  if (f.geocoding_level != null) {
    entity.geocodingLevel = { type: 'Property', value: f.geocoding_level };
  }
  if (f.phone) entity.telephone = { type: 'Property', value: f.phone };
  return entity;
}

/**
 * api/facilities 配下の全 data.json を読み、NGSI-LD エンティティ配列を返す。
 * 同一施設（業種違いで複数行）は「名前+丸め座標」で 1 エンティティに統合し、
 * business_type は category 配列にまとめる。座標・名前が無い行は捨てる。
 */
export function buildEntities() {
  if (!fs.existsSync(FACILITIES_DIR)) {
    console.warn('  api/facilities が無いため変換をスキップ');
    return [];
  }

  // key(名前+座標) -> { 施設 + categories集合 + pref/city }
  const merged = new Map();

  for (const pref of fs.readdirSync(FACILITIES_DIR).sort()) {
    const prefDir = path.join(FACILITIES_DIR, pref);
    if (!fs.statSync(prefDir).isDirectory()) continue;

    for (const city of fs.readdirSync(prefDir).sort()) {
      const dataPath = path.join(prefDir, city, 'data.json');
      if (!fs.existsSync(dataPath)) continue;

      const json = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      for (const f of json.data ?? []) {
        if (typeof f.lat !== 'number' || typeof f.lng !== 'number') continue;
        if (!f.name) continue;

        const lat = round6(f.lat);
        const lng = round6(f.lng);
        const key = `${f.name}|${lat}|${lng}`;

        let e = merged.get(key);
        if (!e) {
          e = { ...f, categories: new Set(), _pref: pref, _city: city };
          merged.set(key, e);
        }
        if (f.business_type) e.categories.add(f.business_type);
      }
    }
  }

  const entities = [];
  for (const e of merged.values()) {
    entities.push(
      facilityToEntity({ ...e, categories: [...e.categories] }, e._pref, e._city),
    );
  }
  return entities;
}

/** エンティティ配列を chunkSize 件ずつ build/ngsild/entities-NNNN.json に書き出す。 */
export function writeChunks(entities, chunkSize) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let n = 0;
  for (let i = 0; i < entities.length; i += chunkSize) {
    const chunk = entities.slice(i, i + chunkSize);
    const file = path.join(OUT_DIR, `entities-${String(n).padStart(4, '0')}.json`);
    fs.writeFileSync(file, JSON.stringify(chunk));
    n += 1;
  }
  return n;
}

// 直接実行された場合は変換して書き出す。
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const ci = argv.indexOf('--chunk');
  const chunkSize = ci >= 0 ? Number(argv[ci + 1]) : 1000;

  const entities = buildEntities();
  const chunks = writeChunks(entities, chunkSize);
  console.log(
    `  NGSI-LD: ${entities.length}件 → ${path.relative(ROOT, OUT_DIR)}/ (${chunks}チャンク × ${chunkSize})`,
  );
}
