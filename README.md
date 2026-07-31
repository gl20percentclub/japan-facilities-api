<div align="center">

# 🍽️ Japan Food Facilities Data

**全国の食品営業許可・届出データを、共通形式で無料配信するオープンデータプロジェクト**

[![Contributors](https://img.shields.io/github/contributors/gl20percentclub/japan-food-facilities-api)](https://github.com/gl20percentclub/japan-food-facilities-api/graphs/contributors)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![GitHub Issues](https://img.shields.io/github/issues/gl20percentclub/japan-food-facilities-api)](https://github.com/gl20percentclub/japan-food-facilities-api/issues)
[![Weekly Crawl](https://img.shields.io/badge/更新-毎週自動-blue)](#更新頻度)

[公式サイト](https://gl20percentclub.github.io/japan-food-facilities-api/) ·
[地図で見る](https://gl20percentclub.github.io/japan-food-facilities-api/map.html) ·
[検索プレイグラウンド](https://gl20percentclub.github.io/japan-food-facilities-api/playground.html) ·
[CSVをダウンロード](https://gl20percentclub.github.io/japan-food-facilities-api/api/facilities-all.csv) ·
[収録状況](docs/COVERAGE.md) ·
[出典・ライセンス](https://gl20percentclub.github.io/japan-food-facilities-api/attribution.html)

</div>

---

## 概要

自治体が食品衛生法にもとづいて公開している、飲食店・喫茶店・食品製造業などの**食品営業許可・届出施設一覧**を収集し、全国共通のフォーマットに統合しています。

- 登録不要・APIキー不要
- 商用利用可能
- 全件CSV・ベクトルタイル・検索用Parquetで配信
- 住所の正規化と緯度経度の補完に対応
- 毎週自動更新

<!-- STATS:START -->
> **最終更新: 2026-07-31**
>
> | 項目 | 値 |
> |---|---|
> | 施設レコード数 | 1,488,756 件 |
> | 座標を持つ施設 | 1,359,323 件 |
> | 都道府県 | 48 |
> | 市区町村 | 1,796 |
> | 結合CSV | 約 430.3 MB |
> | ベクトルタイル | 8,866 枚 / 約 469.1 MB |
<!-- STATS:END -->

1レコードは、原則として1件の営業許可・届出を表します。同じ施設が複数の業種で許可を持つ場合は、複数レコードとして収録されます。

## データを使う

### 全件CSV

分析、加工、データベースへの取り込みにはCSVを利用してください。

| ファイル | URL |
|---|---|
| 全件CSV | https://gl20percentclub.github.io/japan-food-facilities-api/api/facilities-all.csv |

- 文字コード: UTF-8（BOMなし）
- 全列が一致する重複レコードは除去済み

```bash
curl -O https://gl20percentclub.github.io/japan-food-facilities-api/api/facilities-all.csv
```

```python
import pandas as pd

df = pd.read_csv(
    "https://gl20percentclub.github.io/japan-food-facilities-api/api/facilities-all.csv"
)
```

市区町村別JSONは配信していません。地域・業種・キーワードで絞り込む場合は、後述の検索用Parquetを利用するか、CSVから必要な範囲を抽出してください。

### ベクトルタイル

座標を持つ施設をMapbox Vector Tile形式で配信しています。タイルサーバーを用意せず、MapLibre GL JSから直接読み込めます。

```js
map.addSource("facilities", {
  type: "vector",
  tiles: [
    "https://gl20percentclub.github.io/japan-food-facilities-api/api/tiles/{z}/{x}/{y}.pbf",
  ],
  minzoom: 6,
  maxzoom: 12,
});
```

- レイヤー名: `facilities`
- 主な属性: `name` / `business_type` / `pref` / `city`
- 詳細: [`api/tiles/metadata.json`](https://gl20percentclub.github.io/japan-food-facilities-api/api/tiles/metadata.json)

収録データは[プレビュー地図](https://gl20percentclub.github.io/japan-food-facilities-api/map.html)でも確認できます。

### 検索用Parquet

キーワード・地域・業種での検索には、都道府県別のParquetファイルを利用してください。列指向フォーマットのため、DuckDBがHTTP Rangeリクエストで必要な列だけを取得します。サーバーを立てずに、静的ファイルのまま検索APIとして機能します。

| ファイル | URL |
|---|---|
| 都道府県別Parquet | `https://gl20percentclub.github.io/japan-food-facilities-api/api/parquet/{都道府県コード}.parquet` |
| ファイル一覧（manifest） | https://gl20percentclub.github.io/japan-food-facilities-api/api/parquet/manifest.json |

- 都道府県コードは JIS X 0401（`01`=北海道 〜 `47`=沖縄県、`99`=都道府県不明）
- 列は全件CSVと同一
- ブラウザで試すには[検索プレイグラウンド](https://gl20percentclub.github.io/japan-food-facilities-api/playground.html)を利用してください

```sql
-- DuckDB（CLI / Python / Wasm）からそのまま検索できます
SELECT name, business_type, address, lat, lng
FROM read_parquet('https://gl20percentclub.github.io/japan-food-facilities-api/api/parquet/13.parquet')  -- 13 = 東京都
WHERE name LIKE '%ラーメン%'
LIMIT 100;
```

### AIエージェントから使う

Claude Code や Codex などのコーディングエージェントでこのデータを使ったアプリを作る場合は、次のURLを渡してください。データ仕様・利用例・注意事項がまとまっています。

| ファイル | URL |
|---|---|
| llms.txt（索引） | https://gl20percentclub.github.io/japan-food-facilities-api/llms.txt |
| llms-full.txt（全仕様） | https://gl20percentclub.github.io/japan-food-facilities-api/llms-full.txt |

## データ項目

| 列 | 内容 |
|---|---|
| `prefecture` | 都道府県 |
| `city` | 正規化後の市区町村名 |
| `city_raw` | 元データの市区町村表記 |
| `name` / `name_kana` | 施設名・カナ |
| `business_type` | 営業許可・届出の業種 |
| `address` | 所在地 |
| `lat` / `lng` | 緯度経度（WGS84） |
| `geocoding_level` | ジオコーディングの精度 |
| `phone` | 電話番号 |
| `license_no` | 許可番号 |
| `license_date` / `expire_date` | 許可日・有効期限 |
| `sources` / `licenses` | 元データの出典・ライセンス |

市区町村名は、[normalize-japanese-addresses](https://github.com/geolonia/normalize-japanese-addresses) を利用して公式表記に正規化しています。

## 収録範囲

全国1,741市区町村のうち、**1,727市区町村（99%）** をカバーしています。

データは主に次の順序で収集しています。

1. 市区町村が公開するオープンデータ
2. 都道府県など、管轄する保健所設置主体のオープンデータ
3. 厚生労働省「食品衛生申請等システム（i2fas）」のオープンデータ

自治体ごとの収録状況と取得元は、[`docs/COVERAGE.md`](docs/COVERAGE.md) で確認できます。

## データの精度と注意事項

### 緯度経度

元データに座標がない場合は、住所をもとに当プロジェクトがジオコーディングしています。

| level | 意味 |
|---|---|
| `1` | 都道府県の代表点 |
| `2` | 市区町村の代表点 |
| `3` | 町丁目の代表点 |
| `8` | 街区・地番レベル |

値が小さいほど位置は大まかです。建物単位の精度が必要な場合は、必ず `geocoding_level` を確認してください。

「市内一円」など、正確な位置を特定できない住所には座標を付けていない場合があります。

### 鮮度と網羅性

次のようなデータが含まれる場合があります。

- 改正食品衛生法施行以前の古いスナップショット
- 掲載に賛同した施設のみを含むi2fasのデータ
- 市区町村を特定できないデータ
- 廃業後も元データに残っている施設
- 許可期限が切れている施設

最新かつ正式な情報は、各自治体が公開する情報を確認してください。

## 更新頻度

GitHub Actionsで毎週月曜18:00 UTC（日本時間 火曜3:00）に更新し、`gh-pages` ブランチへ配信します。CSVやベクトルタイルのURLは変わりません。

## ライセンスと出典表示

| 対象 | ライセンス |
|---|---|
| 生成データ（CSV・ベクトルタイル・Parquet） | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja) |
| リポジトリ内のコード | MIT |

各レコードの出典とライセンスは、CSVの `sources` 列と `licenses` 列で確認できます。

### 表示例

```html
出典:
<a href="https://github.com/gl20percentclub/japan-food-facilities-api">
  Japan Food Facilities Data
</a>
（各自治体の食品営業許可オープンデータを加工して作成）
```

地図上では、次のように表示できます。

```text
© Japan Food Facilities Data（各自治体オープンデータ）
```

特定自治体のデータだけを利用する場合は、CSVの `sources` 列に記載された自治体名も併記してください。

自治体ごとの出典表示文は、[出典・ライセンス表示ページ](https://gl20percentclub.github.io/japan-food-facilities-api/attribution.html)で確認できます。

## 免責事項

- 本サービスは各自治体の公式サービスではありません
- 緯度経度は実際の所在地と異なる場合があります
- データの正確性、完全性、最新性を保証するものではありません
- 本データの利用によって生じた損害について、当プロジェクトは責任を負いません

## コントリビューション

バグ報告、データソース追加、ドキュメント改善、機能提案を歓迎します。

開発環境のセットアップやプルリクエストの手順は、[`CONTRIBUTING.md`](CONTRIBUTING.md) を参照してください。
