// ---------------------------------------------------------------------------
// AI エージェント向けの llms.txt / llms-full.txt を README.md から生成する。
//
//   llms.txt       … llms.txt 仕様（https://llmstxt.org）に沿った索引。
//                    プロジェクト概要・配信 URL・主要ドキュメントへのリンク集。
//   llms-full.txt  … README 全文（相対リンクを絶対 URL 化）＋ AI エージェント向けの
//                    利用レシピを 1 ファイルにまとめた全仕様。URL を 1 つ渡すだけで
//                    コーディングエージェントがアプリを書ける状態にする。
//
// README を単一の情報源とし、統計ブロック（STATS マーカー間）も README から
// 抽出して埋め込む。クロール（crawl.js）の最後に呼ばれるため、週次更新のたびに
// 最新の統計へ追従する。生成物はリポジトリ直下に置かれ、gh-pages 配信で
// サイトルート（/llms.txt /llms-full.txt）から取得できる。
//
//   node scripts/generate/llms.js   単体実行（README.md を読んで2ファイルを書き出す）
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const README_PATH = path.join(ROOT, 'README.md');

// 配信 URL の基点。静的ページは GitHub Pages、データ（api/）は S3 + CloudFront
// （独自ドメイン food.japan-facilities.com）と配信元が分かれている。
// RAW はリポジトリ内 Markdown の取得先。
const PAGES = 'https://gl20percentclub.github.io/japan-food-facilities';
const DATA = 'https://food.japan-facilities.com';
const REPO = 'https://github.com/gl20percentclub/japan-food-facilities';
const RAW = 'https://raw.githubusercontent.com/gl20percentclub/japan-food-facilities/main';

const STATS_START = '<!-- STATS:START -->';
const STATS_END = '<!-- STATS:END -->';

/**
 * README から統計ブロック（STATS マーカー間）を抽出する（純粋関数）。
 * blockquote の `> ` 接頭辞は除去し、素の Markdown テーブルとして返す。
 * マーカーが無ければ空文字列を返す。
 */
export function extractStats(readme) {
  const start = readme.indexOf(STATS_START);
  const end = readme.indexOf(STATS_END);
  if (start === -1 || end === -1 || end < start) return '';
  return readme
    .slice(start + STATS_START.length, end)
    .split('\n')
    // blockquote を外してプレーンな Markdown にする（llms.txt では引用装飾が不要なため）
    .map((line) => line.replace(/^>\s?/, ''))
    .join('\n')
    .trim();
}

/**
 * README 内の相対リンクを絶対 URL に変換する（純粋関数）。
 * llms-full.txt は単体ファイルとして読まれるため、相対リンクのままだと
 * エージェントがリンク先を辿れない。リンク先の拡張子で基点を出し分ける:
 *   - .md   → GitHub raw（Markdown をそのまま fetch できる）
 *   - それ以外（.html 等） → GitHub Pages（配信されている実体）
 * http(s)・ページ内アンカー（#）・mailto は変換しない。
 */
export function absolutizeLinks(markdown) {
  return markdown.replace(
    /\]\((?!https?:\/\/|#|mailto:)([^)]+)\)/g,
    (_, target) => (target.endsWith('.md') ? `](${RAW}/${target})` : `](${PAGES}/${target})`),
  );
}

/**
 * README からバッジ画像・HTML 装飾（<div> 等）を取り除く（純粋関数）。
 * llms 系ファイルはプレーンな Markdown として読まれるため、
 * shields.io バッジや center 寄せの HTML はノイズにしかならない。
 */
export function stripHtmlNoise(markdown) {
  return markdown
    .split('\n')
    // バッジ行（shields.io への画像リンク）と div タグ行を落とす
    .filter((line) => !line.includes('img.shields.io') && !/^<\/?div/.test(line.trim()))
    .join('\n')
    // 行削除で 3 連以上になった空行を 2 連（段落区切り）まで詰める
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * llms.txt（索引）を組み立てる（純粋関数）。`readme` は README.md の全文。
 * 先頭に H1 と blockquote 要約を置き、続けて重要な事実・リンク集を並べる
 * llms.txt 仕様の構成に従う。
 */
export function renderLlmsTxt(readme) {
  const stats = extractStats(readme);
  return `# Japan Food Facilities Data

> 日本全国の食品営業許可・届出施設（飲食店・喫茶店・食品製造業など）を収集し、
> 全国共通フォーマットの全件CSVとベクトルタイルで無料配信するオープンデータ。
> 登録不要・APIキー不要・商用利用可（出典表示が必要。ライセンスは元データの提供元ごとに異なる）。毎週自動更新。

重要な事実:

- 全件CSV（gzip 版は配信していない）: ${DATA}/api/facilities-all.csv
- 都道府県別CSV（列・内容は全件CSV と同じ。1県だけ必要ならこちらを使う）:
  ${DATA}/api/prefectures/{都道府県コード2桁}.csv
  例 13.csv（東京都）/ 01.csv（北海道）/ 47.csv（沖縄県）。47都道府県すべて存在する。
  ファイル一覧と件数: ${DATA}/api/prefectures/index.json
- CSV は UTF-8（BOMなし）。列: prefecture, city, city_raw, name, name_kana,
  business_type, address, lat, lng, geocoding_level, phone, license_no,
  license_date, expire_date, sources, licenses
- ベクトルタイル（MVT）: ${DATA}/api/tiles/{z}/{x}/{y}.pbf （レイヤ名 facilities、z6–12）
- 市区町村別 CSV/JSON や検索 API はこのリポジトリからは配信していない。抽出は CSV から、
  地図表示はタイルで行う
- 全ファイル CORS 開放済み（Access-Control-Allow-Origin: *）。URL は更新後も不変
- 毎週月曜 18:00 UTC（JST 火曜 3:00）に自動更新

${stats}

## ドキュメント

- [llms-full.txt](${PAGES}/llms-full.txt): データ仕様・利用例・注意事項の全文（まずこれを読む）
- [README](${RAW}/README.md): プロジェクト概要
- [データの詳細](${RAW}/docs/DATA.md): 収集元・正規化・収録範囲・緯度経度の精度・鮮度・更新頻度
- [収録状況](${RAW}/docs/COVERAGE.md): 自治体ごとの収録有無・取得元・ライセンスの一覧
- [タイルメタデータ](${DATA}/api/tiles/metadata.json): TileJSON（レイヤ定義・ズーム範囲・bounds）
- [地図ページ](${PAGES}/map.html): 収録データをベクトルタイルで表示するプレビュー地図
- [出典・ライセンス表示](${PAGES}/attribution.html): 利用時に必要な出典表示の文例
`;
}

/**
 * llms-full.txt（全仕様）を組み立てる（純粋関数）。`readme` は README.md の全文。
 * README を絶対リンク化・ノイズ除去した本文に、AI エージェント向けの
 * 利用レシピ（コピペで動くコード例）を付録として連結する。
 */
export function renderLlmsFullTxt(readme) {
  const body = absolutizeLinks(stripHtmlNoise(readme)).trim();
  return `<!-- このファイルは README.md から自動生成されています（scripts/generate/llms.js）。直接編集しないでください。 -->

${body}

---

## 付録: AI エージェント向け利用レシピ

このデータを使うアプリをコーディングエージェント（Claude Code / Codex 等）が書くための、
コピペで動く最小コード例。

### CSV から必要な範囲を抽出する（DuckDB・推奨）

数百MB規模の CSV 全体をメモリに載せずに、リモートの CSV へ HTTP range request で直接クエリできる。

\`\`\`sql
INSTALL httpfs; LOAD httpfs;
SELECT name, address, lat, lng
FROM read_csv_auto('${DATA}/api/facilities-all.csv')
WHERE prefecture = '沖縄県' AND city = '那覇市' AND business_type = '飲食店営業';
\`\`\`

### 1都道府県だけ使う（都道府県別CSV）

対象が1〜数県なら、全件CSV（数百MB）ではなく都道府県別CSV を落とす。列は全件CSV と同じ。

\`\`\`python
import pandas as pd

# ファイル名は {都道府県コード2桁}.csv（01.csv 〜 47.csv。13.csv は東京都）
df = pd.read_csv('${DATA}/api/prefectures/13.csv')
minato = df[df['city'] == '港区']
\`\`\`

ファイル名・件数の一覧は \`${DATA}/api/prefectures/index.json\` にある
（\`prefectures[].file\` / \`records\` / \`bytes\`）。

### pandas で読む（全件CSV）

\`\`\`python
import pandas as pd

df = pd.read_csv('${DATA}/api/facilities-all.csv')
naha = df[(df['prefecture'] == '沖縄県') & (df['city'] == '那覇市')]
\`\`\`

### 地図に表示する（MapLibre GL JS・タイル利用）

ブラウザで施設を地図表示する場合は CSV ではなくベクトルタイルを使う（軽量・タイルサーバー不要）。

\`\`\`js
map.addSource('facilities', {
  type: 'vector',
  tiles: ['${DATA}/api/tiles/{z}/{x}/{y}.pbf'],
  minzoom: 6,
  maxzoom: 12,
  // 出典表示は必須。source の attribution に入れると地図の出典表示に自動で出る
  attribution:
    '出典：<a href="${PAGES}/" target="_blank" rel="noopener">Japan Food Facilities</a>'
    + '（<a href="${PAGES}/attribution.html" target="_blank" rel="noopener">各自治体・厚生労働省のオープンデータを加工して作成</a>）',
});
map.addLayer({
  id: 'facilities-points',
  type: 'circle',
  source: 'facilities',
  'source-layer': 'facilities', // レイヤ名は facilities 固定
  paint: { 'circle-radius': 4, 'circle-color': '#e74c3c' },
});
\`\`\`

### 実装時の注意

- **ブラウザから数百MBの CSV を fetch しない。** 地図表示はタイル、データ抽出はサーバー側
  （または DuckDB-Wasm + HTTP range request）で行う。
- CSV は UTF-8 **BOMなし**。gzip 圧縮版（.csv.gz）は配信していない。
- \`lat\` / \`lng\` は座標を補完できなかった施設では空になる。地図利用時は必ず除外する。
- \`geocoding_level\` が小さいほど座標は大まか（1=都道府県、2=市区町村、3=町丁目、8=街区・地番）。
  建物単位の精度が必要なら level を確認する。
- 同一施設が業種違いで複数レコード存在する。ユニーク施設が必要なら name + lat/lng で重複排除する。
- キーワード検索・位置検索（「近くのラーメン屋」等）を提供したい場合は、静的配信のみの
  ため検索 API は無い。CSV を SQLite や PostgreSQL 等に取り込んで自前の検索を実装する。
- 商用・非商用を問わず利用できるが、利用・再配布時は出典表示が必要:
  「出典：Japan Food Facilities（各自治体・厚生労働省が公開する食品営業許可オープンデータを加工して作成）」
  と、元データの出典・ライセンス一覧（${PAGES}/attribution.html）を併記する。
  地図の場合は上記のとおり source の \`attribution\` に入れれば自動で表示される。
- 複数の提供元のデータを含むため、各元データにはそれぞれの提供元が定めるライセンス・
  利用条件が適用される（単一のライセンスではない）。特定自治体のデータだけを使う場合は、
  その自治体の条件を ${PAGES}/attribution.html で確認する。
`;
}

/**
 * README.md を読み、llms.txt / llms-full.txt をリポジトリ直下に書き出す。
 * 変更が無ければ書き込まない（タイムスタンプ更新による無駄な差分を避ける）。
 * 戻り値は書き出した（または既存と一致した）ファイルパスの配列。
 */
export function generateLlmsFiles() {
  const readme = fs.readFileSync(README_PATH, 'utf-8');
  const outputs = [
    ['llms.txt', renderLlmsTxt(readme)],
    ['llms-full.txt', renderLlmsFullTxt(readme)],
  ];
  const written = [];
  for (const [name, content] of outputs) {
    const outPath = path.join(ROOT, name);
    // 既存内容と比較し、変わったときだけ書き込む
    const prev = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf-8') : null;
    if (prev !== content) {
      fs.writeFileSync(outPath, content);
      console.log(`  ${name} を更新`);
    } else {
      console.log(`  ${name} に変更なし`);
    }
    written.push(outPath);
  }
  return written;
}

// 単体実行（node scripts/generate/llms.js）されたときだけ生成を走らせる
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('llms.txt / llms-full.txt を生成');
  generateLlmsFiles();
}
