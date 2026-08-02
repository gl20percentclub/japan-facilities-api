# AGENTS.md

AI コーディングエージェント（Claude Code / Codex 等）向けのガイド。
このリポジトリは、全国の食品営業許可・届出データを収集・正規化し、
**全件CSV**・**都道府県別CSV**・**ベクトルタイル** の3形式で無料配信するオープンデータプロジェクト。
静的ページは GitHub Pages、データ（`api/`）は S3 + CloudFront（独自ドメイン
`food.japan-facilities.com`）から配信する。

## このデータでアプリを作る場合

**まず https://gl20percentclub.github.io/japan-food-facilities/llms-full.txt を読むこと。**
データ仕様・コピペで動く利用例・注意事項がすべてまとまっている。要点だけ挙げる:

- 全件CSV: `https://food.japan-facilities.com/api/facilities-all.csv`
  - UTF-8 **BOMなし**、100万件超・数百MB（gzip 版は配信していない）。
    正確な件数・サイズは README の統計ブロック（自動生成）を参照する
  - 列: `prefecture, city, city_raw, name, name_kana, business_type, address, lat, lng, geocoding_level, phone, license_no, license_date, expire_date, sources, licenses`
- 都道府県別CSV: `https://food.japan-facilities.com/api/prefectures/{都道府県コード2桁}.csv`
  - 例 `13.csv`（東京都）/ `01.csv`（北海道）。47都道府県すべて存在し、列・内容は全件CSV と同じ。
    ファイル一覧と件数は `api/prefectures/index.json`。1県だけ必要ならこちらを使う
- ベクトルタイル（MVT）: `https://food.japan-facilities.com/api/tiles/{z}/{x}/{y}.pbf`
  - レイヤ名 `facilities`、z6–12、属性 `name` / `business_type` / `pref` / `city`
- 市区町村別 CSV/JSON や検索 API は**このリポジトリからは配信していない**。データ抽出は
  CSV（DuckDB 推奨）、地図表示はタイルを使う。ブラウザから非圧縮 CSV を直接 fetch しない
- `map.html` は統計表示と業種フィルターだけの最小構成のプレビュー地図。業種の分類は
  食品衛生法の定義（営業許可32業種＋営業届出の業種＋2021年改正前の旧法業種）に沿った
  `CATEGORY_GROUPS` が単一の情報源で、タイルの `business_type` にキーワード部分一致を
  かける（表記が自治体ごとにゆれるため完全一致では拾えない。業種欄が無い自治体もあるので
  「業種の記載なし」を別枠にしている）。検索機能は持たない（検索 API は未公開）。
  旧 `playground.html` は `map.html` へのリダイレクトだけを残した薄いページ
- 商用・非商用を問わず利用可だが出典表示が必要。ライセンスは元データの提供元ごとに異なる
  （単一ライセンスではないので「CC BY 4.0」と一括で書かない）。出典表示:
  「出典：Japan Food Facilities（各自治体・厚生労働省が公開する食品営業許可オープンデータを加工して作成）」
  ＋ 出典・ライセンス一覧 `https://gl20percentclub.github.io/japan-food-facilities/attribution.html`
  地図（ベクトルタイル）では source の `attribution` に指定する

## 開発コマンド

```bash
npm ci                  # 依存関係のインストール
npm test                # 全テスト（unit + 配信物バリデーション）。PR 前に必ず通すこと
npm run test:unit       # 純粋関数のユニットテストのみ（高速）
npm run test:api        # 生成済み api/ のバリデーション（クロール後でないと動かない）
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
scripts/crawl.js        # クローラー本体（取得→正規化→CSV・タイル生成のオーケストレーター）
scripts/validate-api.js # 生成済み api/ のバリデーション（ユニットテストではない）
scripts/lib/            # 取得・パース・正規化・ジオコーディング・名寄せの各実装
scripts/build/          # 配信物の生成（結合CSV・都道府県別CSV・ベクトルタイル）
scripts/generate/       # ドキュメントの生成（attribution.html・llms*.txt・README統計）
scripts/tools/          # 単発・保守用スクリプト（本番パイプラインからは呼ばれない）
scripts/**/*.test.js    # ユニットテスト（自前 assert、純粋関数を固定入力で検証）
docs/COVERAGE.md        # 自治体ごとの収録状況（自動生成）
api/                    # 生成物（.gitignore 対象。Git 管理しない）
llms.txt / llms-full.txt  # AI向けドキュメント（README から自動生成。直接編集しない）
attribution.html        # 出典表示ページ（sources.yaml から自動生成。直接編集しない）
```

## 規約と注意点

- コード・コメントは日本語。すべての関数に doc コメント、非自明なロジックにインラインコメントを書く
- テストは実装と同じディレクトリに `*.test.js` として自前 assert で書き、`package.json` の `test:unit` チェーンに追加する
- 整形・生成ロジックは純粋関数として export し、テストは固定入力で検証する（既存テストの流儀に従う）
- `llms.txt` / `llms-full.txt` / `attribution.html` / README の STATS ブロックは自動生成。
  内容を変えたいときは生成元（README 本文・テンプレート・`config/sources.yaml`）を変更する
- 配信ワークフローの設定は `scripts/workflows.test.js` で固定されている。
  `pages.yml` / `generated-docs.yml` / `ci.yml` を変更したらこのテストも必ず確認する

## 配信の仕組み

- **データ（`api/`）は S3 + CloudFront で配信**する。ベース URL は
  `https://food.japan-facilities.com`（CORS 全オリジン許可済み）。
  クロールと S3 への配信は別リポジトリ
  [japan-facilities-crawler](https://github.com/gl20percentclub/japan-facilities-crawler)
  の Fargate タスクが毎週月曜 18:00 UTC に実行する。このリポジトリでは `api/` を生成も
  管理もしない（結合CSV は 430MB あり、GitHub の 100MB 制限で Git 配信できないため）
- `pages.yml`: 静的ページ（LP・地図・出典・llms.txt）の変更を main への push で
  gh-pages へ反映する
- gh-pages へ配信するワークフローは `pages.yml` **1本だけ**。gh-pages へデータを配信して
  いた旧 `crawl.yml` は廃止した（週次クロールは Fargate 側に一本化。復活していないことを
  `scripts/workflows.test.js` で固定している）
- `publish_dir: .` のため `.gitignore` を配信対象から除外しないと、配信先で `git add --all`
  したときに `api/` が一切コミットされない（過去に gh-pages のデータが全消えした。
  workflows.test.js が再発を防いでいる）
- `pages.yml` は `keep_files: true` のためファイル削除が反映されない。ページを削除・リネーム
  したときは gh-pages 上の旧ファイルを手動で消す

## 生成物の所有権（このリポジトリが単一の情報源）

`config/sources.yaml` と、そこから作られる `attribution.html` / `llms.txt` / `llms-full.txt`
は**このリポジトリが唯一の情報源**。クロールを実行する外部の基盤（private リポジトリ
`gl20percentclub/japan-facilities-crawler` + Fargate）は、これらを生成・push してはならない。
外部が渡してよいのは README の STATS ブロック（クロール結果の統計）だけ。

- `pages.yml` は配信前に必ず生成物を作り直すため、公開ページは常に main の生成元と一致する
- `generated-docs.yml` は main 上の生成物がずれていたら再生成してコミットする（自己修復）
- `ci.yml` は PR でユニットテストを走らせる。生成物の同期テスト（`scripts/generate/attribution.test.js` 等）が
  含まれるため、生成元だけ直して生成物を再生成し忘れた PR はここで落ちる
- 過去の事故: クローラーが自リポジトリに持っていた古い `config/sources.yaml` の
  スナップショットから `attribution.html` を生成して main に push し、旧リポジトリ名と
  ライセンス未確定で除外したソースが公開ページに巻き戻った
- 過去の事故: 2026-08-01、Fargate クローラーが push した STATS ブロックを、同日に走った
  旧 `crawl.yml`（GitHub Actions 上のクロール）が自分の結果で上書きし、README の件数が
  実際に配信しているデータより約14万件少ない状態になった。STATS を push してよいのは
  配信データを作った主体だけ。`crawl.yml` は廃止済みで、復活しないことを
  `scripts/workflows.test.js` で固定している
