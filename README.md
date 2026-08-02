<div align="center">

# 🍽️ Japan Food Facilities Data

**全国の食品営業許可・届出データを、共通形式で配信するオープンデータプロジェクト**

[![Contributors](https://img.shields.io/github/contributors/gl20percentclub/japan-food-facilities)](https://github.com/gl20percentclub/japan-food-facilities/graphs/contributors)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![GitHub Issues](https://img.shields.io/github/issues/gl20percentclub/japan-food-facilities)](https://github.com/gl20percentclub/japan-food-facilities/issues)
[![Weekly Crawl](https://img.shields.io/badge/更新-毎週自動-blue)](#更新頻度)

[公式サイト](https://gl20percentclub.github.io/japan-food-facilities/) ·
[地図で見る](https://gl20percentclub.github.io/japan-food-facilities/map.html) ·
[CSVをダウンロード](https://food.japan-facilities.com/api/facilities-all.csv) ·
[収録状況](docs/COVERAGE.md) ·
[出典・ライセンス](https://gl20percentclub.github.io/japan-food-facilities/attribution.html)

</div>

---

## 概要

自治体や厚生労働省が公開している、飲食店・喫茶店・食品製造業などの**食品営業許可・届出施設一覧**を収集し、全国共通の形式に統合しています。

- 全件CSV・都道府県別CSV・ベクトルタイルで配信
- 住所の正規化と緯度経度の補完に対応

<!-- STATS:START -->
> **最終更新: 2026-08-02**
>
> | 項目 | 値 |
> |---|---|
> | 施設レコード数 | 1,353,429 件 |
> | 座標を持つ施設 | 1,251,781 件 |
> | 収録市区町村 | 1,726 / 1,741 |
> | 結合CSV | 約 397.3 MB |
> | ベクトルタイル | 8,769 枚 / 約 434.1 MB |
<!-- STATS:END -->

1レコードは、原則として1件の営業許可または届出を表します。同じ施設が複数の業種で許可を持つ場合は、複数レコードとして収録されます。

## データを使う

### CSV

分析、加工、データベースへの取り込みには、全件CSVを利用してください。

```text
https://food.japan-facilities.com/api/facilities-all.csv
```

* 文字コード: UTF-8（BOMなし）
* 全列が一致する重複レコードは除去済み
* 市区町村別CSVや検索APIは配信していません

### ベクトルタイル

座標を持つ施設をMapbox Vector Tile形式で配信しています。MapLibre GL JSなどから直接読み込めます。

| 項目            | 値                                                             |
| ------------- | ------------------------------------------------------------- |
| タイルURL        | `https://food.japan-facilities.com/api/tiles/{z}/{x}/{y}.pbf` |
| Source ID     | `facilities`                                                  |
| Source layer名 | `facilities`                                                  |
| 対応ズーム         | `6`〜`12`                                                      |
| 主な属性          | `name` / `business_type` / `pref` / `city`                    |

```js
map.addSource("facilities", {
  type: "vector",
  tiles: [
    "https://food.japan-facilities.com/api/tiles/{z}/{x}/{y}.pbf",
  ],
  minzoom: 6,
  maxzoom: 12,
  attribution:
    '出典：<a href="https://gl20percentclub.github.io/japan-food-facilities/" target="_blank" rel="noopener">Japan Food Facilities</a>'
    + '（<a href="https://gl20percentclub.github.io/japan-food-facilities/attribution.html" target="_blank" rel="noopener">元データの出典・ライセンス</a>）',
});

map.addLayer({
  id: "facilities-points",
  type: "circle",
  source: "facilities",
  "source-layer": "facilities",
  paint: {
    "circle-radius": 4,
    "circle-stroke-width": 1,
  },
});
```

`source`には`addSource`で指定したSource IDを、`source-layer`にはベクトルタイル内部のレイヤー名である`facilities`を指定してください。

詳細は[metadata.json](https://food.japan-facilities.com/api/tiles/metadata.json)を参照してください。

収録データは[地図ページ](https://gl20percentclub.github.io/japan-food-facilities/map.html)でも確認できます。

### AIエージェントから使う

Claude CodeやCodexなどに、次のURLを渡してください。

| ファイル          | URL                                                                   |
| ------------- | --------------------------------------------------------------------- |
| llms.txt      | https://gl20percentclub.github.io/japan-food-facilities/llms.txt      |
| llms-full.txt | https://gl20percentclub.github.io/japan-food-facilities/llms-full.txt |

## 主なデータ項目

| 列                              | 内容            |
| ------------------------------ | ------------- |
| `prefecture`                   | 都道府県          |
| `city`                         | 正規化後の市区町村名    |
| `city_raw`                     | 元データの市区町村表記   |
| `name` / `name_kana`           | 施設名・カナ        |
| `business_type`                | 営業許可・届出の業種    |
| `address`                      | 所在地           |
| `lat` / `lng`                  | 緯度経度（WGS84）   |
| `geocoding_level`              | ジオコーディングの精度   |
| `phone`                        | 電話番号          |
| `license_no`                   | 許可番号          |
| `license_date` / `expire_date` | 許可日・有効期限      |
| `sources` / `licenses`         | 元データの出典・ライセンス |

市区町村名は、[normalize-japanese-addresses](https://github.com/geolonia/normalize-japanese-addresses)を利用して正規化しています。

* 政令指定都市の行政区は市に集約
  例: `横浜市戸塚区` → `横浜市`
* 町村は郡名を除去
  例: `河北郡津幡町` → `津幡町`
* 元の表記は`city_raw`に保存

都道府県や市区町村を特定できなかった場合は、`不明`が入ります。

## 収録範囲

全国1,741市区町村のうち、**1,727市区町村（99%）**をカバーしています。

データは主に次の公開元から収集しています。

1. 市区町村のオープンデータ
2. 都道府県や保健所設置主体のオープンデータ
3. 厚生労働省「食品衛生申請等システム（i2fas）」のオープンデータ

自治体ごとの収録状況は、[`docs/COVERAGE.md`](docs/COVERAGE.md)で確認できます。

## データ利用時の注意

### 緯度経度

元データに座標がない場合は、住所からジオコーディングしています。

| level | 精度       |
| ----- | -------- |
| `1`   | 都道府県の代表点 |
| `2`   | 市区町村の代表点 |
| `3`   | 町丁目の代表点  |
| `8`   | 街区・地番レベル |

値が小さいほど位置は大まかです。建物単位の精度が必要な場合は、`geocoding_level`を確認してください。

### 鮮度と網羅性

次のようなデータが含まれる場合があります。

* 古い時点のスナップショット
* 掲載に同意した施設のみを含むデータ
* 廃業後も公開元に残っている施設
* 許可期限が切れている施設
* 所在地を正確に特定できない施設

最新かつ正式な情報は、各自治体の公開情報を確認してください。

収集元・加工方法・精度のより詳しい説明は、[`docs/DATA.md`](docs/DATA.md)を参照してください。

## 更新頻度

毎週月曜18:00 UTC（日本時間 火曜3:00）に自動更新します。

更新後もCSVとベクトルタイルのURLは変わりません。

## ライセンスと出典表示

| 対象          | 条件                  |
| ----------- | ------------------- |
| CSV・ベクトルタイル | 各元データのライセンス・利用条件に従う |
| リポジトリ内のコード  | MIT License         |

本データは、商用・非商用を問わず、アプリ、Webサービス、研究、分析、再配布などに利用できます。

利用時は、次の出典を表示してください。

```text
出典：Japan Food Facilities
元データの出典・ライセンス一覧：
https://gl20percentclub.github.io/japan-food-facilities/attribution.html
```

より詳しく表示する場合は、次の表記を利用できます。

```text
出典：Japan Food Facilities
（各自治体・厚生労働省が公開する食品営業許可オープンデータを加工して作成）
元データの出典・ライセンス一覧：
https://gl20percentclub.github.io/japan-food-facilities/attribution.html
```

各レコードの出典とライセンスは、CSVの`sources`列と`licenses`列でも確認できます。

特定の自治体のデータだけを利用する場合は、該当する自治体名も併記してください。

## コントリビューション

バグ報告、データソース追加、ドキュメント改善、機能提案を歓迎します。

開発環境のセットアップやプルリクエストの手順は、[`CONTRIBUTING.md`](CONTRIBUTING.md)を参照してください。
