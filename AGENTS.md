# AGENTS.md

AI コーディングエージェント（Claude Code / Codex 等）向けのガイド。
このリポジトリは、全国の食品営業許可・届出データを収集・正規化し、
**全件CSV**・**ベクトルタイル**・**検索用Parquet** の3形式で GitHub Pages から無料配信するオープンデータプロジェクト。

## このデータでアプリを作る場合

**まず https://gl20percentclub.github.io/japan-facilities-api/llms-full.txt を読むこと。**
データ仕様・コピペで動く利用例・注意事項がすべてまとまっている。要点だけ挙げる:

- 全件CSV（gzip）: `https://gl20percentclub.github.io/japan-facilities-api/api/facilities-all.csv.gz`
  - UTF-8 **BOM付き**、約150万レコード、非圧縮で約540MB
  - 列: `prefecture, city, city_raw, name, name_kana, business_type, address, lat, lng, geocoding_level, phone, license_no, license_date, expire_date, sources, licenses`
- ベクトルタイル（MVT）: `https://gl20percentclub.github.io/japan-facilities-api/api/tiles/{z}/{x}/{y}.pbf`
  - レイヤ名 `facilities`、z6–12、属性 `name` / `business_type` / `pref` / `city`
- 検索用 Parquet（都道府県別・列は CSV と同一）: `https://gl20percentclub.github.io/japan-facilities-api/api/parquet/{JISコード}.parquet`
  - 例: `13.parquet` = 東京都、`99.parquet` = 都道府県不明。一覧は同ディレクトリの `manifest.json`
  - DuckDB（CLI / Python / Wasm）の `read_parquet()` でそのまま検索できる。
    ブラウザで試すには `playground.html`（検索プレイグラウンド）
- サーバー型の検索 API や市区町村別 JSON は**配信していない**。キーワード検索は Parquet、
  一括抽出は CSV（DuckDB 推奨）、地図表示はタイルを使う。ブラウザから非圧縮 CSV を直接 fetch しない
- キーワード・位置検索が必要なら [geosearch](https://github.com/naogify/geosearch)（検索API/MCP）を使う
- データは CC BY 4.0。出典表示: 「© Japan Facilities Data（各自治体オープンデータ）」

## 開発コマンド

```bash
npm ci                  # 依存関係のインストール
npm test                # 全テスト（unit + 統合）。PR 前に必ず通すこと
npm run test:unit       # 純粋関数のユニットテストのみ（高速）
npm run build:dry       # キャッシュを使ったクロール（ダウンロードなし）
npm run build           # 本番クロール（全ソースをダウンロード。重い・メモリ大量消費）
npm run build:llms      # llms.txt / llms-full.txt を README から再生成
npm run build:attribution  # attribution.html を config/sources.yaml から再生成
```

ローカルでの動作確認は `npm run build:dry` か `node scripts/crawl.js --only=<sourceKey>` を使い、
フルクロール（`npm run build`）は避ける（100万件超・Node ヒープ 12GB 必要）。

## リポジトリ構成

```
config/sources.yaml     # データソース定義（単一の情報源）。自治体の追加はここ
scripts/crawl.js        # クローラー本体（取得→正規化→CSV・タイル・Parquet生成のオーケストレーター）
scripts/lib/            # 取得・パース・正規化・ジオコーディング・名寄せの各実装
scripts/*.test.js       # ユニットテスト（自前 assert、純粋関数を固定入力で検証）
docs/COVERAGE.md        # 自治体ごとの収録状況（自動生成）
api/                    # 生成物（.gitignore 対象。Git 管理しない）
llms.txt / llms-full.txt  # AI向けドキュメント（README から自動生成。直接編集しない）
attribution.html        # 出典表示ページ（sources.yaml から自動生成。直接編集しない）
```

## 規約と注意点

- コード・コメントは日本語。すべての関数に doc コメント、非自明なロジックにインラインコメントを書く
- テストは `scripts/*.test.js` に自前 assert で書き、`package.json` の `test:unit` チェーンに追加する
- 整形・生成ロジックは純粋関数として export し、テストは固定入力で検証する（既存テストの流儀に従う）
- `llms.txt` / `llms-full.txt` / `attribution.html` / README の STATS ブロックは自動生成。
  内容を変えたいときは生成元（README 本文・テンプレート・`config/sources.yaml`）を変更する
- 配信ワークフローの設定は `scripts/workflows.test.js` で固定されている。
  `crawl.yml` / `pages.yml` を変更したらこのテストも必ず確認する

## 配信の仕組み

- データ（`api/`）は **gh-pages ブランチのみ**で配信。main には置かない（履歴肥大の防止）
- `crawl.yml`: 毎週月曜 18:00 UTC にクロール → リポジトリ直下ごと gh-pages へ配信（`keep_files: false`）
- `pages.yml`: 静的ページ（LP・地図・出典・llms.txt）の変更を main への push で反映（`keep_files: true` で `api/` を保護）
- `publish_dir: .` のため `.gitignore` を配信対象から除外しないと gh-pages 上の `api/` が
  全消えする事故が起きる（過去に発生済み。workflows.test.js が再発を防いでいる）
