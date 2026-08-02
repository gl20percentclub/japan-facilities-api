// ---------------------------------------------------------------------------
// 出典表示（attribution）ページ attribution.html を config/sources.yaml から生成する。
//
// 収録している全データソースについて「提供者・データセット名・出典ページ URL・
// 取得 URL・ライセンス」を一覧化し、各ライセンスが求める出典表示形式に沿った
// 表示文（コピーしてそのまま使える文字列）を出力する。
//
// 生成物 attribution.html は Git 管理し、gh-pages にもそのまま配信される
// （ワークフローの publish_dir が リポジトリルート のため）。config/sources.yaml を
// 変更したら本スクリプトを実行して再生成すること（`npm test` で同期を検証する）。
//
// 使い方:
//   node scripts/generate/attribution.js           attribution.html を再生成
//   node scripts/generate/attribution.js --check   再生成せず、内容が最新かだけを検証
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, ROOT } from '../lib/config.js';

/** 生成先。gh-pages のルートに配置され https://…/attribution.html で公開される。 */
export const OUTPUT_PATH = path.join(ROOT, 'site', 'attribution.html');

/** 公開サイトの URL（一括表記の例で使う）。 */
const SITE_URL = 'https://gl20percentclub.github.io/japan-food-facilities/';
/** リポジトリ URL（ページ内リンクで使う）。 */
const REPO_URL = 'https://github.com/gl20percentclub/japan-food-facilities';

/** 都道府県名（`source` の先頭から提供者を推定する際に使う）。 */
const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

/**
 * ライセンス区分の定義。config/sources.yaml の `license` 表記は自治体ごとに
 * 揺れる（例: 「CC BY 4.0」と「Creative Commons Attribution 4.0 International」）ため、
 * ここで正規化したうえで「そのライセンスが求める出典表示形式」を対応づける。
 *
 *   id       区分の識別子（HTML の見出し id / セクション順に使う）
 *   label    正規化後の表示名
 *   url      ライセンス本文の URL（自治体独自規約・未確認は null）
 *   match    config の license 表記のうちこの区分に含めるもの
 *   requirement セクション見出し直下に出す「表示要件」の説明
 *   noteModified 出典表示文に「加工して作成」を含めるか
 */
const LICENSE_GROUPS = [
  {
    id: 'cc-by-4-0',
    label: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/deed.ja',
    match: ['CC BY 4.0', 'Creative Commons Attribution 4.0 International'],
    requirement:
      '出典（提供者名・データセット名・出典 URL）の明示と、改変した旨の表示が必要です。'
      + '本 API は正規化・緯度経度付与などの加工を行っているため、「加工して作成」の旨を必ず含めてください。',
    noteModified: true,
  },
  {
    id: 'cc-by-3-0',
    label: 'CC BY 3.0',
    url: 'https://creativecommons.org/licenses/by/3.0/deed.ja',
    match: ['CC BY 3.0'],
    requirement: '出典の明示と、改変した旨の表示が必要です。',
    noteModified: true,
  },
  {
    id: 'cc-by-2-1-jp',
    label: 'CC BY 2.1 JP',
    url: 'https://creativecommons.org/licenses/by/2.1/jp/',
    match: ['CC BY 2.1 JP'],
    requirement: '出典の明示と、改変した旨の表示が必要です。',
    noteModified: true,
  },
  {
    id: 'cc-by-2-0',
    label: 'CC BY 2.0',
    url: 'https://creativecommons.org/licenses/by/2.0/deed.ja',
    match: ['CC BY 2.0'],
    requirement: '出典の明示と、改変した旨の表示が必要です。',
    noteModified: true,
  },
  {
    id: 'cc-by',
    label: 'CC BY（バージョン表記なし）',
    url: 'https://creativecommons.org/licenses/by/4.0/deed.ja',
    match: ['CC BY', 'Creative Commons Attribution', 'CC BY相当'],
    requirement:
      '掲載ページに「CC BY」とのみ記載されており、バージョンが特定できないソースです。'
      + 'CC BY 共通の要件である出典の明示と改変した旨の表示を行ってください（元の表記は各行に併記しています）。',
    noteModified: true,
  },
  {
    id: 'pdl-1-0',
    label: '公共データ利用規約（第1.0版・PDL1.0）',
    url: 'https://www.digital.go.jp/resources/open_data/public_data_license_v1.0',
    match: ['公共データ利用規約（第1.0版, PDL1.0）', '公共データ利用規約'],
    requirement:
      '出典の明示が必要です（商用利用を含めて再利用可・CC BY 4.0 互換）。'
      + '編集・加工した情報を提供する場合は、加工した旨も併記してください。',
    noteModified: true,
  },
  {
    id: 'cc0-1-0',
    label: 'CC0 1.0',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.ja',
    match: ['CC0 1.0', 'CC0', 'Creative Commons CCZero'],
    requirement:
      'CC0（パブリックドメイン提供）のため出典表示は法的には不要ですが、'
      + '本 API ではデータの来歴を示すため出典を明示しています（表示例も同形式で掲載します）。',
    noteModified: true,
  },
  {
    id: 'local-terms',
    label: '自治体独自の利用規約',
    url: null,
    match: [], // 上記いずれにも当てはまらず「要確認」でもないものが入る
    requirement:
      '各自治体が定める独自の利用規約に従ってください（いずれも出典の明示が必要です）。'
      + '規約の内容は各行の出典ページから確認できます。',
    noteModified: true,
  },
  {
    id: 'unconfirmed',
    label: 'ライセンス表記が未確認',
    url: null,
    match: ['要確認'],
    requirement:
      '掲載ページでライセンスの明示が確認できなかったソースです。本 API では出典を明示したうえで収録しています。'
      + '再利用にあたっては、各自治体の利用条件を必ずご自身でご確認ください。',
    noteModified: true,
  },
];

/**
 * config の license 表記をライセンス区分に振り分ける。
 * どの区分の match にも該当しない表記（「柏市オープンデータ利用規約」など）は
 * 自治体独自の利用規約として扱う。
 *
 * @param {string} license config/sources.yaml の license の値
 * @returns {{ id: string, label: string, url: string|null, requirement: string, noteModified: boolean }}
 */
export function classifyLicense(license) {
  const raw = (license ?? '').trim();
  const group =
    LICENSE_GROUPS.find((g) => g.match.includes(raw))
    ?? LICENSE_GROUPS.find((g) => g.id === 'local-terms');
  return group;
}

/**
 * `source`（出典表示名）と既定値から「提供者」と「データセット名」を切り出す。
 *
 * config の source は次の2形式が混在する。
 *   - BODIK 由来 : "横須賀市 【横須賀市】食品営業許可施設公開情報" のように 提供者＋半角空白＋名称
 *   - 個別追加分 : "大阪市食品営業許可施設一覧" のように 提供者名が先頭に連結
 * 後者は defaultCity / defaultPref、それも無ければ都道府県名の前方一致で提供者を判定する。
 *
 * @param {object} src config/sources.yaml の1エントリ
 * @returns {{ publisher: string, dataset: string }} 提供者とデータセット名
 */
export function derivePublisher(src) {
  const source = (src.source ?? '').trim();

  // BODIK 形式（提供者と名称が半角空白で区切られている）はそのまま分割する。
  const spaceIdx = source.indexOf(' ');
  if (spaceIdx > 0) {
    return { publisher: source.slice(0, spaceIdx), dataset: source.slice(spaceIdx + 1).trim() };
  }

  // 既定値（defaultCity → defaultPref）→ 都道府県名の前方一致 の順で提供者を推定する。
  const publisher =
    src.defaultCity
    ?? src.defaultPref
    ?? PREFECTURES.find((p) => source.startsWith(p))
    ?? source;

  // 名称が提供者名で始まる場合（例: 大阪市 + 食品営業許可施設一覧）は重複を避けて切り落とす。
  // ただし残りが括弧始まり（例: 東京都（保健医療局）…）だと名称として不自然なので元のまま使う。
  const rest = source.startsWith(publisher) ? source.slice(publisher.length).trim() : '';
  const dataset = rest && !rest.startsWith('（') ? rest : source;
  return { publisher, dataset };
}

/**
 * 実際にデータを取得している URL を求める（出典ページ sourceUrl とは別で、来歴として掲載する）。
 * 取得方法が CKAN の場合は resource_show の API URL、複数ファイル取得の場合は全 URL を返す。
 *
 * @param {object} acquire config の acquire ブロック
 * @returns {string[]} 取得 URL の配列（掲載ページ解決や i2fas など URL が定まらない場合は空配列）
 */
export function acquireUrls(acquire = {}) {
  switch (acquire.type) {
    case 'ckan':
      return [`${acquire.ckanBase}/api/3/action/resource_show?id=${acquire.resourceId}`];
    case 'get':
      return acquire.urls ?? (acquire.url ? [acquire.url] : []);
    case 'post':
      return acquire.url ? [acquire.url] : [];
    case 'resolve':
      // 掲載ページ内のリンクを毎回解決するため、固定の取得 URL は掲載ページそのもの。
      return acquire.pageUrl ? [acquire.pageUrl] : [];
    default:
      // i2fasglob など、ローカルキャッシュ経由で URL が1本に定まらないもの。
      return [];
  }
}

/**
 * 1ソース分の出典表示文（コピーしてそのまま使える1行）を組み立てる。
 * 形式は「出典：{提供者}「{データセット名}」（{出典URL}）を加工して作成（{ライセンス}）」。
 * CC BY 系が求める "提供者・タイトル・出典元・改変の明示" をこの1行で満たす。
 *
 * @param {object} entry buildEntries() が返すエントリ
 * @returns {string} 出典表示文
 */
export function buildAttribution(entry) {
  const url = entry.sourceUrl ? `（${entry.sourceUrl}）` : '';
  const modified = entry.license.noteModified ? 'を加工して作成' : '';
  // 定型ライセンス（CC BY 系・PDL）はライセンス名まで併記する。自治体独自規約・未確認は
  // 規約名を文中に入れても表示要件を満たさないため入れず、ページ側のセクションと
  // 「元の表記」バッジで示す。
  const suffix = entry.license.url ? `（${entry.license.label}）` : '';
  return `出典：${entry.publisher}「${entry.dataset}」${url}${modified}${suffix}`;
}

/**
 * config の sources を、ページ描画に必要な形へ整形する。
 *
 * @param {object[]} sources loadConfig().sources
 * @returns {object[]} key / publisher / dataset / sourceUrl / acquire / license / attribution を持つ配列
 */
export function buildEntries(sources) {
  return sources.map((src) => {
    const { publisher, dataset } = derivePublisher(src);
    const entry = {
      key: src.key,
      publisher,
      dataset,
      sourceName: src.source,
      sourceUrl: src.sourceUrl ?? null,
      acquireUrls: acquireUrls(src.acquire),
      licenseRaw: (src.license ?? '').trim(),
      license: classifyLicense(src.license),
    };
    entry.attribution = buildAttribution(entry);
    return entry;
  });
}

/**
 * エントリをライセンス区分ごとにまとめる（LICENSE_GROUPS の並び順を維持し、0件の区分は落とす）。
 *
 * @param {object[]} entries buildEntries() の戻り値
 * @returns {{ group: object, entries: object[] }[]} 区分ごとのセクション
 */
export function groupByLicense(entries) {
  return LICENSE_GROUPS
    .map((group) => ({
      group,
      // 表示順は提供者名の五十音（ロケール）順で安定させる。
      entries: entries
        .filter((e) => e.license.id === group.id)
        .sort((a, b) => a.publisher.localeCompare(b.publisher, 'ja')),
    }))
    .filter((section) => section.entries.length > 0);
}

/** HTML に埋め込むテキストをエスケープする。 */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** 表示用に URL を短く省略する（リンク先は元の URL のまま）。 */
function shortenUrl(url, max = 72) {
  return url.length <= max ? url : `${url.slice(0, max - 1)}…`;
}

/** 1ソース分のカード（提供者・出典リンク・取得URL・出典表示文）を描画する。 */
function renderEntry(entry) {
  // 取得 URL は複数のことがあるため、すべてリンクとして並べる。
  const acquire = entry.acquireUrls.length
    ? entry.acquireUrls
      .map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(shortenUrl(u))}</a>`)
      .join('<br>')
    : '<span class="muted">（キャッシュ経由・固定URLなし）</span>';

  // ライセンスの元表記が正規化後の表示名と違う場合だけ併記する（情報を失わせないため）。
  const rawNote = entry.licenseRaw && entry.licenseRaw !== entry.license.label
    ? `<span class="badge">元の表記: ${esc(entry.licenseRaw)}</span>`
    : '';

  return `      <article class="src" id="src-${esc(entry.key)}">
        <h3>${esc(entry.publisher)}<span class="dataset">${esc(entry.dataset)}</span></h3>
        <dl>
          <dt>出典ページ</dt>
          <dd>${entry.sourceUrl
    ? `<a href="${esc(entry.sourceUrl)}" target="_blank" rel="noopener">${esc(entry.sourceUrl)}</a>`
    : '<span class="muted">（なし）</span>'}</dd>
          <dt>取得URL</dt>
          <dd>${acquire}</dd>
        </dl>
        ${rawNote}
        <div class="attr">
          <code>${esc(entry.attribution)}</code>
          <button type="button" class="copy" data-copy="${esc(entry.attribution)}">コピー</button>
        </div>
      </article>`;
}

/** ライセンス区分ごとのセクションを描画する。 */
function renderSection({ group, entries }) {
  const licenseLink = group.url
    ? ` — <a href="${esc(group.url)}" target="_blank" rel="noopener">ライセンス本文</a>`
    : '';
  return `    <section class="license" id="${esc(group.id)}">
      <h2>${esc(group.label)} <span class="count">${entries.length} ソース</span></h2>
      <p class="requirement">${esc(group.requirement)}${licenseLink}</p>
${entries.map(renderEntry).join('\n')}
    </section>`;
}

/**
 * 出典表示ページの HTML 全体を描画する（純粋関数：同じ入力なら常に同じ出力）。
 * 生成日時などの変動値は埋め込まない。`npm test` で config との同期を検証するため。
 *
 * @param {object[]} entries buildEntries() の戻り値
 * @returns {string} attribution.html の中身
 */
export function renderHtml(entries) {
  const sections = groupByLicense(entries);
  // 目次はセクション（ライセンス区分）単位。件数も出して全体像がすぐ分かるようにする。
  const toc = sections
    .map(({ group, entries: es }) =>
      `      <li><a href="#${esc(group.id)}">${esc(group.label)}</a> <span class="count">${es.length}</span></li>`)
    .join('\n');

  return `<!DOCTYPE html>
<!--
  このファイルは scripts/generate/attribution.js が config/sources.yaml から自動生成しています。
  直接編集せず、config/sources.yaml を更新して \`npm run build:attribution\` を実行してください。
-->
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>出典・ライセンス表示 — Japan Food Facilities</title>
  <meta name="description" content="Japan Food Facilities が収録する全データソースの出典URL・ライセンスと、各データの出典表示形式に沿った表示文の一覧です。">
  <style>
    :root {
      --accent: #e8563f;
      --ink: #1f2933;
      --sub: #52606d;
      --muted: #9aa5b1;
      --border: rgba(31, 41, 51, 0.12);
      --panel: #f7f8fa;
      --bg: #ffffff;
    }
    /* 端末のダークモード設定に追随する（LP・地図と配色をそろえる） */
    @media (prefers-color-scheme: dark) {
      :root {
        --ink: #e4e7eb;
        --sub: #b0b8c0;
        --muted: #7b8794;
        --border: rgba(228, 231, 235, 0.16);
        --panel: #1c2229;
        --bg: #14181d;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
      color: var(--ink);
      line-height: 1.7;
      background: var(--bg);
    }
    .wrap { max-width: 920px; margin: 0 auto; padding: 32px 20px 80px; }
    a { color: var(--accent); }
    h1 { font-size: 24px; margin: 0 0 8px; }
    h2 {
      font-size: 18px;
      margin: 48px 0 4px;
      padding-bottom: 6px;
      border-bottom: 2px solid var(--accent);
      scroll-margin-top: 16px;
    }
    h3 { font-size: 15px; margin: 0 0 6px; }
    h3 .dataset { display: block; font-size: 13px; font-weight: 400; color: var(--sub); }
    p { margin: 0 0 12px; }
    .lead { color: var(--sub); font-size: 14px; }
    .count { font-size: 12px; color: var(--muted); font-weight: 400; }
    .muted { color: var(--muted); }
    .requirement { font-size: 13px; color: var(--sub); margin: 10px 0 16px; }

    /* まとめて1行で表示する場合の例 */
    .callout {
      background: var(--panel);
      border: 1px solid var(--border);
      border-left: 4px solid var(--accent);
      border-radius: 8px;
      padding: 14px 16px;
      font-size: 14px;
    }

    /* 目次 */
    .toc { background: var(--panel); border-radius: 10px; padding: 12px 16px; font-size: 14px; }
    .toc ul { margin: 6px 0 0; padding-left: 20px; }

    /* ソース1件分のカード */
    .src {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 12px;
      scroll-margin-top: 16px;
    }
    .src dl {
      display: grid;
      grid-template-columns: 84px 1fr;
      gap: 2px 12px;
      margin: 8px 0;
      font-size: 12.5px;
    }
    .src dt { color: var(--muted); }
    .src dd { margin: 0; overflow-wrap: anywhere; }
    .badge {
      display: inline-block;
      font-size: 11px;
      color: var(--sub);
      background: var(--panel);
      border-radius: 999px;
      padding: 1px 10px;
      margin-bottom: 8px;
    }

    /* 出典表示文（コピー用） */
    .attr {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      background: var(--panel);
      border-radius: 8px;
      padding: 10px 12px;
    }
    .attr code {
      flex: 1;
      font-size: 12.5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow-wrap: anywhere;
    }
    .copy {
      flex: none;
      font: inherit;
      font-size: 12px;
      color: #fff;
      background: var(--accent);
      border: 0;
      border-radius: 6px;
      padding: 4px 12px;
      cursor: pointer;
    }
    .copy:hover { opacity: 0.85; }

    footer { margin-top: 56px; font-size: 12.5px; color: var(--sub); }
    @media (max-width: 560px) {
      .src dl { grid-template-columns: 1fr; }
      .src dt { margin-top: 6px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>出典・ライセンス表示（Attribution）</h1>
    <p class="lead">
      <a href="${SITE_URL}">Japan Food Facilities</a> は、各自治体・省庁が公開する食品営業許可・届出のオープンデータを
      取得し、全国共通フォーマットへの正規化と緯度経度の付与を行って配信しています。
      本ページは収録している全 ${entries.length} ソースの出典 URL とライセンス、および
      各データが求める出典表示形式に沿った表示文の一覧です。
    </p>

    <h2 id="how-to">出典の表示方法</h2>
    <p>
      本データは、商用・非商用を問わず、アプリ、Webサービス、研究、分析、再配布などに利用できます。
      ただし本データには複数の提供元によるデータが含まれており、各元データには、それぞれの提供元が定める
      ライセンスおよび利用条件が適用されます（全体が単一のライセンスで提供されているわけではありません）。
    </p>
    <p>
      本 API のデータを利用・再配布する場合は、利用したデータのソースについて下記の表示文をそのまま掲載してください。
      本 API は元データに加工（正規化・名寄せ・ジオコーディング）を加えているため、表示文には「加工して作成」の旨を含めています。
    </p>
    <p>全国データをまとめて利用する場合は、次の一括表記でも構いません（個別ソースの一覧として本ページを参照させてください）。</p>
    <div class="callout">
      <code>出典：Japan Food Facilities（各自治体・厚生労働省が公開する食品営業許可オープンデータを加工して作成）<br>${SITE_URL}attribution.html</code>
    </div>
    <p class="lead" style="margin-top:12px">
      緯度経度は本サービスが住所からジオコーディングして独自に付与した参考情報であり、各自治体が提供しているものではありません。
      加工したデータについて、提供元が本サービスを推奨・関与していると誤解させる表示は行わないでください。
    </p>

    <nav class="toc" aria-label="ライセンス別の目次">
      <strong>ライセンス別の一覧</strong>
      <ul>
${toc}
      </ul>
    </nav>

${sections.map(renderSection).join('\n')}

    <footer>
      <p>
        このページは <a href="${REPO_URL}/blob/main/config/sources.yaml">config/sources.yaml</a> から
        <a href="${REPO_URL}/blob/main/scripts/generate/attribution.js">scripts/generate/attribution.js</a> が自動生成しています。
        誤りを見つけた場合は <a href="${REPO_URL}/issues">Issue</a> でお知らせください。
      </p>
      <p>
        <a href="./">← トップへ戻る</a> · <a href="./map.html">プレビュー地図</a> ·
        <a href="${REPO_URL}">GitHub リポジトリ</a>
      </p>
    </footer>
  </div>

  <script>
    // 出典表示文をクリップボードへコピーする（コピー後は一時的にボタン表示を変える）。
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.copy');
      if (!btn) return;
      navigator.clipboard.writeText(btn.dataset.copy).then(() => {
        btn.textContent = 'コピーしました';
        setTimeout(() => { btn.textContent = 'コピー'; }, 1500);
      }).catch(() => { btn.textContent = 'コピー失敗'; });
    });
  </script>
</body>
</html>
`;
}

/**
 * config/sources.yaml から attribution.html の内容を生成する。
 *
 * @returns {string} HTML 文字列
 */
export function generate() {
  const { sources } = loadConfig();
  return renderHtml(buildEntries(sources));
}

// CLI 実行時のみ書き出す（--check の場合は差分の有無だけを終了コードで返す）。
// パスに記号（% 等）が含まれても比較できるよう pathToFileURL で URL 化して突き合わせる。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const html = generate();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf-8') : '';
    if (current !== html) {
      console.error('❌ attribution.html が config/sources.yaml と同期していません。'
        + '`npm run build:attribution` を実行してください。');
      process.exit(1);
    }
    console.log('✅ attribution.html は最新です');
  } else {
    fs.writeFileSync(OUTPUT_PATH, html);
    console.log(`✅ ${path.relative(ROOT, OUTPUT_PATH)} を生成しました`);
  }
}
