# Japan-facilities-api

日本自治体が公開しているオープンデータ（食品営業許可・届出）をクロールし、APIとして配信するシステムです。

- **ソース**: 沖縄県BODIK オープンデータ（CKAN: `https://data.bodik.jp`）、将来的に追加予定。
- **運用**: GitHub Actions で毎週自動クロール → GitHub Pages で配信
- **ライセンス**: 元データは CC BY 4.0

> [!IMPORTANT]
> 本サービスは各自治体が公開するオープンデータを独自に集約・加工したサービスであり、
> **各自治体の公式サービスではありません**。内容の正確性・完全性・最新性は保証しません。
> 緯度経度は当サービスが付与した参考情報です。詳しくは [NOTICE.md](./NOTICE.md)（利用規約・免責事項）と
> `api/attribution.json`（出典・ライセンス）をご確認ください。

## 収録データ

以下はクロール（`npm run build`）のたびに自動更新されます。ファイルサイズは目安です。

<!-- STATS:START -->
> **最終更新: 2026-07-06**
>
> | 項目 | 値 |
> |---|---|
> | 施設レコード数 | 35,039 件 |
> | ユニーク施設数（名前+座標） | 26,374 件 |
> | 都道府県 | 1 |
> | 市区町村 | 39 |
> | `api/` 合計サイズ | 約 15.8 MB |
> | `data.json` 合計 | 約 13.4 MB |
> | `search-index.json` | 約 2.5 MB |
<!-- STATS:END -->

## API 構造

**都道府県 > 市区町村 > `data.json`** の3階層構造です。

```
api/
├── attribution.json           # 出典・ライセンス・免責（機械可読）。UIフッター等はこれを読む
├── search-index.json           # 施設名検索用のコンパクトな索引（全市区町村横断）
└── facilities/
    ├── index.json              # 都道府県一覧（都道府県名 → 市区町村名の配列）
    └── 沖縄県/
        ├── index.json          # 市区町村名 → 施設数 のマップ
        ├── 那覇市/
        │   └── data.json       # その市区町村の全施設オブジェクトの配列
        └── 宜野湾市/
            └── data.json
```

すべての JSON レスポンスの `meta` には、出典・ライセンス・免責の要約が含まれます。

```json
"meta": {
  "updated": 1749600000,
  "source": "沖縄県食品営業許可・届出一覧",
  "license": "CC BY 4.0",
  "disclaimer": "本データは各自治体のオープンデータを加工・統合した非公式の参考情報です。…",
  "attribution": "https://geolonia.github.io/japan-facilities-address/api/attribution.json"
}
```

### `attribution.json`（出典・ライセンス・免責）

データソースの詳細（自治体名・データセット名・元データURL・ライセンス・データ取得日・
自治体側の最終更新日）と免責事項を機械可読でまとめたファイル。地図アプリ等の UI は
このファイルを読めば、出典表記やフッターの免責文を動的に表示できます。

```json
{
  "meta": { "updated": 1749600000, "retrievedAt": "2026-07-07" },
  "service": { "name": "…", "description": "…", "url": "…", "termsPath": "NOTICE.md" },
  "disclaimer": "本データは各自治体のオープンデータを加工・統合した非公式の参考情報です。…",
  "sources": [
    {
      "municipality": "沖縄県",
      "datasetName": "食品営業許可・届出一覧",
      "sourceUrl": "https://data.bodik.jp/dataset/okinawa-dpf_okinawa_pref",
      "downloadUrl": "https://data.bodik.jp/.../download/....xlsx",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/deed.ja",
      "sourceUpdatedAt": "2026-03-05",
      "retrievedAt": "2026-07-07"
    }
  ],
  "notices": { "accuracy": { "title": "…", "body": ["…"] }, "geocoding": { … }, "unofficial": { … } }
}
```

### `search-index.json`（施設名検索用）

施設名で横断検索したい利用側（地図アプリ等）向けの軽量な索引。各 `data.json` を
個別に読むと重い（合計〜14MB）ため、検索に必要な項目だけを配列形式で 1 ファイルに
まとめています（gzip 配信で数百KB 程度）。`npm run build:search-index` で再生成、
クロール時（`npm run build`）にも自動生成されます。

```json
{
  "meta": { "updated": 1700000000, "count": 26374, "schema": ["name", "address", "lat", "lng", "level"] },
  "data": [
    ["ココストアうるま江洲店", "うるま市江洲３９８番地", 26.350128, 127.825863, 8]
  ]
}
```

- 各行は `meta.schema` の順（`name, address, lat, lng, level`）。
- 同一施設（業種違いで複数行）は `名前+座標` で重複排除済み。座標を持つ施設のみ収録。

### `index.json`

```json
{
  "meta": { "updated": 1749600000, "source": "沖縄県食品営業許可・届出一覧", "license": "CC BY 4.0", "disclaimer": "…", "attribution": "…/api/attribution.json" },
  "data": { "沖縄県": ["那覇市", "宜野湾市"] }
}
```

### `{都道府県}/index.json`

```json
{
  "meta": { "updated": 1749600000, "source": "…", "license": "…", "disclaimer": "…", "attribution": "…/api/attribution.json" },
  "data": { "那覇市": 342, "宜野湾市": 128 }
}
```

### `{都道府県}/{市区町村}/data.json`

業種ごとには分割せず、その市区町村の全施設を1ファイルにまとめます。
業種は各施設の `business_type` で判別できます。

```json
{
  "meta": { "updated": 1749600000, "source": "…", "license": "…", "disclaimer": "…", "attribution": "…/api/attribution.json" },
  "data": [
    {
      "name": "ステーキハウス○○",
      "name_kana": "ステーキハウスマルマル",
      "business_type": "飲食店営業",
      "address": "那覇市松山1-9-9",
      "lat": 26.216965935,
      "lng": 127.678060421,
      "geocoding_level": 8,
      "phone": "098-XXX-XXXX",
      "license_no": "第01202300556号",
      "license_date": "2023-12-07",
      "expire_date": "2030-01-31"
    }
  ]
}
```

#### 緯度経度（ジオコーディング）

元データに緯度経度が無い施設は、住所をもとに
[@geolonia/normalize-japanese-addresses](https://github.com/geolonia/normalize-japanese-addresses)
で座標を補完します。

- `lat` / `lng`: WGS84（EPSG:4326）。補完できなかった場合は `null`。
- `geocoding_level`: 補完した座標の**精度レベル**。元データに座標があった場合や補完できなかった場合は `null`。
  - `1` = 都道府県の代表点 / `2` = 市区町村の代表点 / `3` = 町丁目の代表点（重心） / `8` = 街区・地番レベル
  - 値が小さいほど大まかな位置（例: `3` は丁目の中心であり、建物の正確な位置ではない）。

補完結果は `.cache/geocode-cache.json` にキャッシュされ、再クロール時に再利用されます。

## 使い方

```bash
npm ci

# クロール → api/ を生成
npm run build

# ダウンロードをスキップしキャッシュ（.cache/）を使う
npm run build:dry

# ジオコーディングをスキップして高速に生成（座標は補完されない）
node scripts/crawl.js --no-geocode

# 出典情報 api/attribution.json だけを再生成（クロール不要）
node scripts/gen-attribution.js

# 利用規約・免責 NOTICE.md を config/notices.js から再生成
npm run build:notice

# 生成結果のバリデーション
npm test
```

## 出典・ライセンス・免責

出典・ライセンス・表示文言は **データモデル / 設定として保持**し、ハードコードを避けています。

| ファイル | 役割 |
| --- | --- |
| [`config/datasets.js`](./config/datasets.js) | データソース（出典）の master data。自治体名・データセット名・元データURL・ライセンスを保持。 |
| [`config/notices.js`](./config/notices.js) | 免責・注意事項・サービス情報の**単一ソース**。文言はここだけを編集する。 |
| `api/attribution.json` | 上記から生成する機械可読の出典・ライセンス・免責（データ取得日・自治体側の最終更新日を含む）。 |
| [`NOTICE.md`](./NOTICE.md) | `config/notices.js` から生成する人間可読の利用規約・免責事項。 |

- **出典**（requirement 1）: 自治体名・データセット名・元データURL・ライセンス・データ取得日・
  自治体側の最終更新日を `api/attribution.json` と各 `meta` に保持・表示します。
- **ライセンス**（requirement 2）: 自治体ごとに `config/datasets.js` で保持（`CC BY 4.0` / `PDL1.0` /
  自治体独自ライセンス等）。空欄なら CKAN のメタデータから自動補完します。
- **更新日時**（requirement 3）: 自治体側の最終更新日（`sourceUpdatedAt`）と当サービスの取得日
  （`retrievedAt`）の両方を保持します。
- **免責・非公式の明記**（requirement 4〜7）: 正確性・加工・緯度経度・非公式について
  `config/notices.js` に文言を集約し、`NOTICE.md`・`api/attribution.json`・各 `meta.disclaimer` へ反映します。

文言や UI を変えたいときは `config/*.js` を編集し `npm run build`（または `build:notice` /
`gen-attribution.js`）を実行すれば、生成物すべてに反映されます。

## 複数の自治体データへの対応

[`config/datasets.js`](./config/datasets.js) の `DATASETS` 配列にエントリを追加するだけで、
複数自治体のデータを1つのツリーに統合できます。

```js
export const DATASETS = [
  {
    resourceId: 'c9bf82c1-0689-4354-aada-c422f052be5e',
    municipality: '沖縄県',
    datasetName: '食品営業許可・届出一覧',
    sourceUrl: 'https://data.bodik.jp/dataset/okinawa-dpf_okinawa_pref',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/deed.ja',
  },
  // 別の自治体データをここに追加
];
```

`municipality` 等の項目を空欄にすると、CKAN のメタデータ（`package_show` / `resource_show`）から
自動補完します。

## 自動更新

`.github/workflows/crawl.yml` が毎週月曜 18:00 UTC（JST 火曜 AM 3:00）に実行され、
変更があれば `api/` と README（「収録データ」の件数・サイズ）をコミットし、`gh-pages` ブランチへデプロイします。
`workflow_dispatch` から手動実行も可能（`dry_run` オプション付き）。
