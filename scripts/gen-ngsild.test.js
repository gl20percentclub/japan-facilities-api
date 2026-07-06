// gen-ngsild.js の変換ロジック（施設 → NGSI-LD PointOfInterest）を検証する。
// api/ の生成物に依存しない純粋関数テストなので、単体で実行できる。
//
//   node scripts/gen-ngsild.test.js

import { facilityToEntity } from './gen-ngsild.js';

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

console.log('gen-ngsild 変換テスト\n');

// 代表的な施設 1 件（業種は categories 配列で渡す形に正規化済み）。
const sample = {
  name: 'ステーキハウス○○',
  categories: ['飲食店営業', '喫茶店営業'],
  address: '那覇市松山1-9-9',
  lat: 26.216965935,
  lng: 127.678060421,
  geocoding_level: 8,
  phone: '098-000-0000',
};
const e = facilityToEntity(sample, '沖縄県', '那覇市');

assert(e.type === 'PointOfInterest', 'type は PointOfInterest');
assert(e.id.startsWith('urn:ngsi-ld:PointOfInterest:'), 'id は PointOfInterest の URN');
assert(e.name?.type === 'Property' && e.name.value === 'ステーキハウス○○', 'name が Property で入る');
assert(
  e.category?.type === 'Property' && JSON.stringify(e.category.value) === JSON.stringify(['飲食店営業', '喫茶店営業']),
  'category は業種の配列',
);
assert(
  e.address?.value?.addressRegion === '沖縄県' && e.address.value.addressLocality === '那覇市',
  'address に都道府県・市区町村が入る',
);
assert(e.address?.value?.streetAddress === '那覇市松山1-9-9', 'address.streetAddress が入る');

// location は GeoProperty / GeoJSON Point。coordinates は [lng, lat] で 6 桁丸め。
assert(e.location?.type === 'GeoProperty', 'location は GeoProperty');
assert(e.location?.value?.type === 'Point', 'location は Point');
assert(
  Array.isArray(e.location?.value?.coordinates) &&
    e.location.value.coordinates[0] === 127.67806 &&
    e.location.value.coordinates[1] === 26.216966,
  'coordinates は [lng, lat] で 6 桁に丸められる',
);
assert(e.geocodingLevel?.value === 8, 'geocodingLevel が入る');
assert(e.telephone?.value === '098-000-0000', 'phone があれば telephone が入る');
assert(e.source?.value === 'japan-facilities-address', 'source にデータセット名が入る');

// id は「名前+丸め座標」の安定ハッシュ = 冪等（同入力で同 id、丸め前の座標差は吸収）。
const e2 = facilityToEntity({ ...sample, lat: 26.2169659, lng: 127.6780604 }, '沖縄県', '那覇市');
assert(e.id === e2.id, '丸めて同座標になる同名施設は同じ id（冪等 upsert 用）');
const e3 = facilityToEntity({ ...sample, name: '別の店' }, '沖縄県', '那覇市');
assert(e.id !== e3.id, '名前が違えば id も違う');

// phone が空なら telephone は付けない。
const noPhone = facilityToEntity({ ...sample, phone: '' }, '沖縄県', '那覇市');
assert(!('telephone' in noPhone), 'phone が空なら telephone を付けない');

// geocoding_level が null なら geocodingLevel は付けない。
const noLevel = facilityToEntity({ ...sample, geocoding_level: null }, '沖縄県', '那覇市');
assert(!('geocodingLevel' in noLevel), 'geocoding_level が null なら geocodingLevel を付けない');

if (failures > 0) {
  console.error(`\n❌ ${failures}件のチェックに失敗`);
  process.exit(1);
}
console.log('\n✅ gen-ngsild 変換テストに合格');
