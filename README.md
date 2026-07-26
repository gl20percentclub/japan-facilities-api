<div align="center">

# 🍽️ Japan Facilities Data

**日本全国の飲食施設オープンデータ（食品営業許可・届出）を、無料で使える形に統合して配信**

[![Contributors](https://img.shields.io/github/contributors/gl20percentclub/japan-facilities-api)](https://github.com/gl20percentclub/japan-facilities-api/graphs/contributors)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#コントリビューション)
[![GitHub Issues](https://img.shields.io/github/issues/gl20percentclub/japan-facilities-api)](https://github.com/gl20percentclub/japan-facilities-api/issues)
[![Weekly Crawl](https://img.shields.io/badge/更新-毎週自動-blue)](#更新頻度)

[公式サイト](https://gl20percentclub.github.io/japan-facilities-api/) · [地図で見る](https://gl20percentclub.github.io/japan-facilities-api/map.html) · [全件CSVをダウンロード](https://gl20percentclub.github.io/japan-facilities-api/api/facilities-all.csv.gz) · [収録状況](docs/COVERAGE.md) · [出典・ライセンス](https://gl20percentclub.github.io/japan-facilities-api/attribution.html)

</div>

---

## どんなデータか

全国の自治体が食品衛生法にもとづいて公開している**食品営業許可・届出の施設一覧**（飲食店・喫茶店・食品製造業など）を、毎週自動で収集し、全国共通フォーマットに正規化・ジオコーディングして配信しています。**登録不要・API キー不要・無料**です。

1レコード＝1つの営業許可で、次の項目を持ちます。

| 列 | 内容 |
|---|---|
| `prefecture` / `city` | 都道府県・市区町村（[normalize-japanese-addresses](https://github.com/geolonia/normalize-japanese-addresses) で名寄せした公式表記） |
| `city_raw` | 元データの市区町村表記（郡名の有無などの揺れをそのまま保持） |
| `name` / `name_kana` | 施設名・カナ |
| `business_type` | 業種（飲食店営業・喫茶店営業 など） |
| `address` | 所在地 |
| `lat` / `lng` | 緯度経度（WGS84）。無ければ空 |
| `geocoding_level` | 座標の精度レベル（[精度について](#精度)） |
| `phone` | 電話番号 |
| `license_no` / `license_date` / `expire_date` | 許可番号・許可日・有効期限 |
| `sources` / `licenses` | そのレコードの出典とライセンス |

<!-- STATS:START -->
> **最終更新: 2026-07-24**
>
> | 項目 | 値 |
> |---|---|
> | 施設レコード数 | 1,495,048 件 |
> | 都道府県 | 52 |
> | 市区町村 | 1,958 |
<!-- STATS:END -->

同じ施設が業種違いで複数レコードになることがあります（1施設が複数の許可を持つため）。これは元データの構造どおりで、意図的に残しています。

## どれだけカバーしているか

全国 1,741 市区町村のうち **1,727 市区町村（99%）** のデータを収録しています。

食品営業許可を発行する権限は「保健所設置主体」（都道府県・政令市・中核市・特別区の計157主体）にあり、一般の市町村は許可を発行しません。そのため収集は次の優先順で行っています。

1. 市区町村自身がオープンデータとして公開している
2. 管轄の保健所設置主体（都道府県など）が公開している
3. 厚生労働省「食品衛生申請等システム（i2fas）」のオープンデータに含まれる

**どの自治体をどの経路でカバーしているかの全市区町村一覧**は [`docs/COVERAGE.md`](docs/COVERAGE.md) にあります。未収録の自治体もそこで確認できます。

## 地図で見る

まず中身を見たい場合は、プレビュー地図をどうぞ。座標を持つ全施設を点で表示しています。

**👉 https://gl20percentclub.github.io/japan-facilities-api/map.html**

配信サイトのページ構成は次のとおりです。いずれもリポジトリルートの静的 HTML で、ビルド不要です。

| URL | ファイル | 内容 |
|---|---|---|
| [`/`](https://gl20percentclub.github.io/japan-facilities-api/) | `index.html` | ランディングページ（概要・配布形式） |
| [`/map.html`](https://gl20percentclub.github.io/japan-facilities-api/map.html) | `map.html` | プレビュー地図（ベクトルタイルを MapLibre で表示） |
| [`/attribution.html`](https://gl20percentclub.github.io/japan-facilities-api/attribution.html) | `attribution.html` | 出典・ライセンス一覧（`config/sources.yaml` から自動生成） |

## 配布形式

配信しているのは **全件CSV** と **ベクトルタイル** の2つだけです。用途に応じて選んでください。

### 1. 全件CSV — 分析・加工・DB取り込み向け

| ファイル | URL |
|---|---|
| gzip 圧縮版（推奨） | https://gl20percentclub.github.io/japan-facilities-api/api/facilities-all.csv.gz |
| 非圧縮版 | https://gl20percentclub.github.io/japan-facilities-api/api/facilities-all.csv |

- **文字コード**: UTF-8（BOM 付き。Excel でそのまま開けます）
- **列**: [どんなデータか](#どんなデータか) の表のとおり
- 全列一致の重複は除去済み

```bash
curl -O https://gl20percentclub.github.io/japan-facilities-api/api/facilities-all.csv.gz
gunzip facilities-all.csv.gz
```

```python
import pandas as pd
df = pd.read_csv('https://gl20percentclub.github.io/japan-facilities-api/api/facilities-all.csv.gz')
```

### 2. ベクトルタイル — 地図表示向け

座標を持つ施設を点として焼いた Mapbox Vector Tile（MVT）を `{z}/{x}/{y}.pbf` の静的ディレクトリ形式で配信しています。タイルサーバー不要で MapLibre GL JS からそのまま読めます。

```js
map.addSource('facilities', {
  type: 'vector',
  tiles: ['https://gl20percentclub.github.io/japan-facilities-api/api/tiles/{z}/{x}/{y}.pbf'],
  minzoom: 6, maxzoom: 12,
});
// レイヤ名は "facilities"、各点の属性は name / business_type / pref / city
```

- 非圧縮 pbf で配信するため、追加のヘッダ設定は不要です
- レイヤ定義・ズーム範囲・bounds・件数は [`api/tiles/metadata.json`](https://gl20percentclub.github.io/japan-facilities-api/api/tiles/metadata.json)（TileJSON）を参照

> **市区町村別の JSON や検索インデックスは配信していません。** 実際のユースケースがほぼ無く、生成物が肥大するだけだったため廃止しました。部分的なデータが欲しい場合は CSV をフィルタしてください。

### 更新頻度

GitHub Actions が毎週月曜 18:00 UTC（JST 火曜 AM 3:00）にクロールし、`gh-pages` ブランチへ配信します。URL は変わりません。

## 精度

### 緯度経度

**緯度経度は当サービスが独自に付与した参考情報**であり、自治体が提供しているものではありません。元データに座標が無い施設は、住所をもとに [normalize-japanese-addresses](https://github.com/geolonia/normalize-japanese-addresses) でジオコーディングしています。

`geocoding_level` はその精度レベルです（元データに座標があった場合・補完できなかった場合は空）。

| level | 意味 |
|---|---|
| `1` | 都道府県の代表点 |
| `2` | 市区町村の代表点 |
| `3` | 町丁目の代表点（重心） |
| `8` | 街区・地番レベル |

値が小さいほど大まかな位置です。`3` は丁目の中心であって建物の位置ではありません。**建物単位の正確さが要る用途では level を必ず確認してください。**

「市内一円」のような住所は、正規化しても都道府県の代表点にしか落ちず誤解を招くため、あえて座標を付けていません。

### データの鮮度・網羅性

- 一部データは改正食品衛生法（令和3年6月）以前のスナップショットで、他ソースより古い場合があります（例: 京都市は令和3年3月末時点）
- i2fas のデータは掲載に賛同した施設のみのため、全件ではありません
- 元データに市区町村欄が無く住所も粗い個票は、`prefecture=不明` / `city=不明` のまま収録しています（欠損させるより残す方針）
- 廃業した施設が元データに残っている場合があります

最新かつ正式な情報は、各自治体が公開する情報をご確認ください。

## 利用ガイドライン

### ライセンス

| 対象 | ライセンス |
|---|---|
| 生成データ（CSV・ベクトルタイル） | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja) |
| このリポジトリのコード | MIT |

各自治体の元データは CC BY 4.0 / CC BY 2.1 JP / 公共データ利用規約（PDL1.0）/ 自治体独自の利用規約などライセンスが異なりますが、いずれも**出典を明示すれば商用を含めて自由に利用・改変・再配布できる**条件です。それらを統合した本データセットは、原典の条件を満たす形で **CC BY 4.0** として配布します。レコード単位の出典・ライセンスは CSV の `sources` / `licenses` 列で確認できます。

- 商用利用禁止（NC）・改変禁止（ND）など CC BY 4.0 と両立しない条件のソースは収録しません
- ライセンス表記を確認中のソース（`config/sources.yaml` の `license: 要確認`）は、出典明示のうえで暫定的に収録しています。問題があれば [Issue](https://github.com/gl20percentclub/japan-facilities-api/issues) でご指摘ください

### 出典表示の方法

利用時は次のようにクレジットを表示してください。

**Web ページ・アプリの場合**

```html
出典: <a href="https://github.com/gl20percentclub/japan-facilities-api">Japan Facilities Data</a>
（各自治体の食品営業許可オープンデータを加工して作成）
```

**地図上のアトリビューションの場合**

```
© Japan Facilities Data（各自治体オープンデータ）
```

**論文・レポートの場合**

```
Japan Facilities Data（https://github.com/gl20percentclub/japan-facilities-api）,
各自治体の食品営業許可オープンデータを加工して作成, 取得日: YYYY-MM-DD
```

特定の自治体のデータだけを使う場合は、CSV の `sources` 列にある**元の自治体名を併記**してください（例: 「出典: 大阪市食品営業許可施設一覧 を加工して作成」）。

> 📢 **全ソース分の出典表示文は [出典・ライセンス表示ページ](https://gl20percentclub.github.io/japan-facilities-api/attribution.html) にあります。** 各データのライセンスが求める形式に沿った文をコピーしてそのまま使えます。

### 免責事項

- 本サービスは各自治体のオープンデータを独自に集約・加工したものであり、**各自治体の公式サービスではありません**
- 緯度経度は当サービスが付与した参考情報で、実際の所在地と異なる場合があります
- 内容の正確性・完全性・最新性を保証するものではありません
- 本データの利用によって生じたいかなる損害についても責任を負いません

## 出典

全ソースの出典 URL・ライセンス・出典表示文は [出典・ライセンス表示ページ](https://gl20percentclub.github.io/japan-facilities-api/attribution.html) で一覧できます。このページは [`config/sources.yaml`](config/sources.yaml) から [`scripts/gen-attribution.js`](scripts/gen-attribution.js) が自動生成し、`npm test` で config との同期を検証しています。

機械可読な定義そのものは [`config/sources.yaml`](config/sources.yaml) にあり、各エントリが取得URL（`acquire`）・出典の掲載ページ（`sourceUrl`）・ライセンス（`license`）を持ちます。

主な出典は次の3系統です。

- **各自治体が公開する食品営業許可オープンデータ** — 都道府県・政令市・中核市・特別区などの公開データ
- **BODIK オープンデータカタログ**（`data.bodik.jp`）— 主に九州・中国地方の自治体が利用する共同カタログ
- **厚生労働省「食品衛生申請等システム（i2fas）」** — 全国・保健所設置主体別のオープンデータ。ライセンスは公共データ利用規約（第1.0版, PDL1.0）＝CC BY 4.0 互換。掲載に賛同した施設のみ

## 開発

### セットアップとビルド

```bash
npm ci

# クロール → api/ を生成（結合CSV + ベクトルタイル）
npm run build

# ダウンロードをスキップしキャッシュ（.cache/）を使う
npm run build:dry

# 特定ソースだけ処理（動作確認・部分再生成）
node scripts/crawl.js --only=osaka-city,tokyo-minato

# 生成結果のバリデーション
npm test
```

`node scripts/crawl.js` は次のオプションを取ります。

| オプション | 効果 |
|---|---|
| `--dry-run` | ダウンロードをスキップしキャッシュを使う |
| `--no-geocode` | ジオコーディングをスキップ（座標は補完されない） |
| `--no-normmap` | 市区町村名の名寄せをスキップ（生表記のまま・高速） |
| `--only=key1,key2` | 指定キーのソースだけ処理 |
| `--allow-empty-sources` | 0件のソースがあっても中断しない |

生成物 `api/` は Git 管理せず（`.gitignore`）、配信は `gh-pages` のみです（履歴肥大を避けるため）。README の統計だけを `main` に反映します。

### データソースの追加

データソースの定義は **単一の設定ファイル [`config/sources.yaml`](config/sources.yaml)** に集約されています。`sources:` に1エントリ追加するだけで、新しい自治体のオープンデータを取り込めます。

```yaml
sources:
  # CKAN リソース
  - key: okinawa-bodik
    acquire: { type: ckan, ckanBase: https://data.bodik.jp, resourceId: c9bf82c1-... }
    source: 沖縄県食品営業許可・届出
    sourceUrl: https://data.bodik.jp/dataset/...   # 出典（掲載ページ）。取得URLとは別
    license: CC BY 4.0
  # 直リンク CSV（都道府県・市区町村カラムが無ければ defaultPref / defaultCity を指定）
  - key: osaka-city
    acquire: { type: get, url: https://.../260331zenku.csv, format: csv, encoding: shift_jis }
    source: 大阪市食品営業許可施設一覧
    sourceUrl: https://www.city.osaka.lg.jp/kenko/page/0000575579.html
    license: CC BY 4.0
    defaultPref: 大阪府
    defaultCity: 大阪市
```

- 取得方法（CKAN / 直リンクGET / フォームPOST / 掲載ページ解決）、形式（CSV / TSV / XLSX / XLS）、文字コード、既定の都道府県・市区町村をエントリで指定します
- 列名（ヘッダー）の揺れは、同ファイル冒頭の `columns:`（内部キー → 元ヘッダー表記[] の別名辞書）に集約しています。新しい表記が出てきたら1行足すだけで全ソースに効きます
- ソースを追加・変更したら `npm run build:attribution` で[出典表示ページ](https://gl20percentclub.github.io/japan-facilities-api/attribution.html)（`attribution.html`）を再生成してください（`npm test` が config との同期を検証します）

### コードの構成

```
scripts/
├── crawl.js               オーケストレーター（取得→パース→正規化→ジオコーディング→出力）
├── build-merged-csv.js    全件CSV の書き出し（+ gzip）
├── gen-tiles.js           ベクトルタイル生成（geojson-vt + vt-pbf、pure JS）
├── gen-readme-stats.js    README の統計ブロック更新
├── gen-attribution.js     出典表示ページ attribution.html の生成
├── fetch-i2fas.mjs        厚労省 i2fas オープンデータの取得（ブラウザ自動化）
├── gen-bodik-sources.mjs  BODIK 掲載自治体のソース定義を再生成
└── lib/
    ├── config.js          設定ファイル(YAML)の読み込み
    ├── acquire.js         取得（ckan / get / post / resolve / i2fasglob）
    ├── parse.js           パース（CSV/TSV/XLSX、文字コード、ヘッダー行判定）
    ├── normalize.js       正規化（別名→内部キー、住所結合、日付、座標補正）
    ├── geocode.js         ジオコーディング（住所→座標の補完）
    ├── city-normmap.js    市区町村名の名寄せ（表記ゆれ→公式名）
    └── csv-read.js        CSV のストリーミング読み込み（バリデーション用）
```

## コントリビューション

**コントリビューションは大歓迎です！** バグ報告・機能提案・プルリクエスト、どんな形の貢献でも歓迎します。

- 🗾 **新しい自治体データソースの追加** — [`config/sources.yaml`](config/sources.yaml) に1エントリ追加するだけです。未収録の自治体は [`docs/COVERAGE.md`](docs/COVERAGE.md) で確認できます
- 🐛 **バグ報告・データ品質の問題報告** — [Issues](https://github.com/gl20percentclub/japan-facilities-api/issues) からお気軽にどうぞ（座標のずれ、重複、文字化けなど）
- 💡 **機能提案・改善アイデア** — Issue で議論を始めてください
- 📖 **ドキュメントの改善** — 誤字修正や説明の追加も立派な貢献です

### プルリクエストの流れ

1. Fork する
2. ブランチを作成する（`git checkout -b feature/add-your-city`）
3. 変更をコミットする
4. `npm run test:unit` が通ることを確認する
5. プルリクエストを作成する

小さな変更でも遠慮なくどうぞ。不明点があれば Issue で気軽に質問してください。

### コントリビューター

<a href="https://github.com/gl20percentclub/japan-facilities-api/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=gl20percentclub/japan-facilities-api" alt="Contributors" />
</a>

*Made with [contrib.rocks](https://contrib.rocks).*
