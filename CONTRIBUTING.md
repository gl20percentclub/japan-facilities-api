# コントリビューションガイド

バグ報告、データソースの追加、ドキュメント改善、機能提案を歓迎します。

このリポジトリは、全国の食品営業許可・届出データを収集・正規化し、
**全件CSV**・**都道府県別CSV**・**ベクトルタイル** の3形式で配信するオープンデータプロジェクトです。

リポジトリの構成と、データが生成・配信される流れは
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) にまとめています。
「やりたいこと別・触るファイル」の対応表もあるので、迷ったらそちらを先に見てください。

---

## いちばん多い貢献: 自治体を追加する

未収録の自治体は、[`config/sources.yaml`](config/sources.yaml) に1エントリ追加するだけで取り込めます。
コードを書く必要はありません。

```yaml
sources:
  - key: osaka-city                    # 一意キー（キャッシュ名・--only 指定に使う）
    acquire:
      type: get                        # 取得方法（get / ckan / post / resolve / i2fasglob）
      url: https://www.city.osaka.lg.jp/contents/wdu280/260331zenku.csv
      format: csv                      # csv / tsv / xlsx / xls（省略時はURLから推定）
      encoding: shift_jis              # utf-8 / shift_jis / utf-16 / auto（既定 auto）
    source: 大阪市食品営業許可施設一覧    # 出典表示名
    sourceUrl: https://www.city.osaka.lg.jp/kenko/page/0000575579.html  # 掲載ページURL
    license: CC BY 4.0                 # 掲載ページに明示されたライセンス表記
    defaultPref: 大阪府                 # 都道府県カラムが無いデータの既定値
    defaultCity: 大阪市                 # 市区町村カラムが無いデータの既定値
```

指定できるフィールドの一覧と意味は、`config/sources.yaml` 冒頭のコメントにまとまっています。

### 追加するときの注意

- **ライセンスが掲載ページに明示されていること。** 明示が見つからない場合は `license: 要確認` とせず、
  Issue で相談してください。ライセンスが確定していないソースは配信対象に含めません。
- **元データの列名が既存の別名辞書に無い場合**は、`config/sources.yaml` の `columns:` に
  元表記を追加します（内部キーの意味は [`scripts/lib/normalize.js`](scripts/lib/normalize.js) を参照）。
- 追加したら、そのソースだけをクロールして確認します。

```bash
node scripts/crawl.js --only=osaka-city
```

BODIK に掲載されているデータは、`scripts/tools/gen-bodik-sources.js` でエントリを生成して
手動マージできます。

---

## 開発環境のセットアップ

Node.js 18 以上が必要です。

```bash
git clone https://github.com/gl20percentclub/japan-food-facilities.git
cd japan-food-facilities
npm ci
```

### 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `npm test` | 全テスト（ユニット + 配信物のバリデーション） |
| `npm run test:unit` | 純粋関数のユニットテストのみ（高速。PR前はこれを通す） |
| `npm run test:api` | 生成済み `api/` のバリデーション（クロール後でないと動かない） |
| `npm run build:dry` | キャッシュを使ったクロール（ダウンロードなし） |
| `npm run build` | 本番クロール（全ソースをダウンロード） |
| `npm run build:llms` | `llms.txt` / `llms-full.txt` を README から再生成 |
| `npm run build:attribution` | `attribution.html` を `config/sources.yaml` から再生成 |

**`npm run build`（フルクロール）はローカルで実行しないでください。**
100万件超のレコードを扱い、Node のヒープを 12GB 必要とします。動作確認は
`npm run build:dry` か `node scripts/crawl.js --only=<sourceKey>` を使ってください。

---

## プルリクエストの手順

1. `main` から作業ブランチを切る
2. 変更を加え、`npm run test:unit` が通ることを確認する
3. 自動生成ファイルの生成元を変えた場合は、生成物を再生成してコミットする（後述）
4. プルリクエストを作成する

### PR の粒度

**小さく、1つの目的に絞ってください。** 「ソース追加」と「リファクタリング」を1つの PR に
混ぜないでください。レビューしやすさが変更の受け入れ速度を決めます。

### CI で確認されること

`.github/workflows/ci.yml` が `npm run test:unit` を実行します。ここには自動生成ファイルの
同期テストが含まれるため、**生成元だけ直して生成物を再生成し忘れた PR は落ちます**。

---

## 自動生成ファイルを直接編集しない

次のファイルは自動生成されます。直接編集しても、CI か配信時に上書きされます。

| 生成物 | 生成元 | 再生成コマンド |
| --- | --- | --- |
| `site/attribution.html` | `config/sources.yaml` | `npm run build:attribution` |
| `site/llms.txt` / `site/llms-full.txt` | `README.md` | `npm run build:llms` |
| `README.md` の STATS ブロック | クロール結果 | 週次クローラーが更新 |
| `docs/COVERAGE.md` | クロール結果 | 週次クローラーが更新 |

内容を変えたいときは、**生成元**（`config/sources.yaml` / README 本文 / 生成スクリプト）を
変更してから再生成してください。

---

## コードの書き方

- **コード・コメントは日本語**で書きます。
- すべての関数に doc コメント、非自明なロジックにインラインコメントを付けます。
- 整形・生成ロジックは**純粋関数として export** し、固定入力でテストできる形にします。
- テストは実装と同じディレクトリに `*.test.js` として置き、外部ライブラリを使わない自前の `assert` で書きます。
  追加したら `package.json` の `test:unit` チェーンにも追加してください。

---

## データについての報告

「この施設のデータが間違っている」という報告は、**元データの提供元（自治体）**への
確認が必要な場合があります。このリポジトリは元データを収集・正規化しているだけで、
内容の訂正は行っていません。

一方、次のものはこのリポジトリのバグです。Issue を立ててください。

- 市区町村名の正規化がおかしい
- ジオコーディングの結果が明らかに違う場所を指している
- CSV の列がずれている・文字化けしている
- 元データには存在するのに収録されていない

---

## ライセンス

コントリビューションは、リポジトリ内のコードと同じ [MIT License](LICENSE) の下で
提供されたものとみなします。

なお、**配信しているデータ（CSV・ベクトルタイル）は MIT ではなく、各元データの提供元が
定めるライセンスに従います**。詳細は
[出典・ライセンス一覧](https://gl20percentclub.github.io/japan-food-facilities/attribution.html)
を参照してください。
