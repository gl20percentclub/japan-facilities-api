// gen-attribution.js の分類・整形ロジックと、生成物 attribution.html の同期を検証する。
//
//   node scripts/generate/attribution.test.js

import fs from 'node:fs';
import {
  OUTPUT_PATH,
  acquireUrls,
  buildAttribution,
  buildEntries,
  classifyLicense,
  derivePublisher,
  generate,
  groupByLicense,
} from './attribution.js';
import { loadConfig } from '../lib/config.js';

let failures = 0;
/** 条件を検証して結果を出力する（失敗数を数える）。 */
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

console.log('attribution.html 生成 テスト\n');

// --- classifyLicense: 表記ゆれを同じ区分にまとめる ---
assert(
  classifyLicense('Creative Commons Attribution 4.0 International').id === 'cc-by-4-0',
  'BODIK の英語表記が CC BY 4.0 に正規化される',
);
assert(classifyLicense('CC BY 4.0').id === 'cc-by-4-0', '「CC BY 4.0」が CC BY 4.0 区分になる');
assert(classifyLicense('CC BY').id === 'cc-by', 'バージョン無しの「CC BY」は別区分になる');
assert(classifyLicense('要確認').id === 'unconfirmed', '「要確認」は未確認区分になる');
assert(
  classifyLicense('柏市オープンデータ利用規約').id === 'local-terms',
  '未知の規約名は自治体独自の利用規約になる',
);
assert(
  classifyLicense('公共データ利用規約（第1.0版, PDL1.0）').id === 'pdl-1-0',
  'PDL1.0 が公共データ利用規約の区分になる',
);

// --- derivePublisher: 提供者とデータセット名の切り出し ---
assert(
  derivePublisher({ source: '横須賀市 【横須賀市】食品営業許可施設公開情報' }).publisher === '横須賀市',
  'BODIK 形式（空白区切り）から提供者を取り出す',
);
assert(
  derivePublisher({ source: '大阪市食品営業許可施設一覧', defaultPref: '大阪府', defaultCity: '大阪市' }).dataset
    === '食品営業許可施設一覧',
  'defaultCity で提供者を判定し、名称から重複を取り除く',
);
assert(
  derivePublisher({ source: '沖縄県食品営業許可・届出' }).publisher === '沖縄県',
  '既定値が無い場合は都道府県名の前方一致で提供者を判定する',
);
assert(
  derivePublisher({ source: '東京都（保健医療局）食品関係営業許可台帳', defaultPref: '東京都' }).dataset
    === '東京都（保健医療局）食品関係営業許可台帳',
  '括弧始まりになる場合は名称を切り詰めない',
);

// --- acquireUrls: 取得方法ごとに URL を求める ---
assert(
  acquireUrls({ type: 'ckan', ckanBase: 'https://data.bodik.jp', resourceId: 'abc' })[0]
    === 'https://data.bodik.jp/api/3/action/resource_show?id=abc',
  'CKAN は resource_show の URL になる',
);
assert(
  acquireUrls({ type: 'get', urls: ['https://a/1.csv', 'https://a/2.csv'] }).length === 2,
  '複数ファイル取得は全 URL を返す',
);
assert(acquireUrls({ type: 'i2fasglob' }).length === 0, '固定 URL を持たない取得方法は空配列');

// --- buildAttribution: 出典表示文の形式 ---
const ccEntry = buildEntries([{
  key: 'x', source: '大阪市食品営業許可施設一覧', sourceUrl: 'https://example.jp/a',
  license: 'CC BY 4.0', defaultCity: '大阪市', acquire: { type: 'get', url: 'https://example.jp/a.csv' },
}])[0];
assert(
  ccEntry.attribution === '出典：大阪市「食品営業許可施設一覧」（https://example.jp/a）を加工して作成（CC BY 4.0）',
  'CC BY は 提供者・名称・出典URL・改変の明示・ライセンス名 を含む',
);
const localEntry = buildEntries([{
  key: 'y', source: '柏市食品営業許可一覧', sourceUrl: 'https://example.jp/b',
  license: '柏市オープンデータ利用規約', defaultCity: '柏市', acquire: { type: 'get', url: 'https://example.jp/b.csv' },
}])[0];
assert(
  localEntry.attribution === '出典：柏市「食品営業許可一覧」（https://example.jp/b）を加工して作成',
  '独自規約は規約名を文中に含めず出典明示のみにする',
);
assert(
  buildAttribution({ ...ccEntry, sourceUrl: null }) === '出典：大阪市「食品営業許可施設一覧」を加工して作成（CC BY 4.0）',
  '出典URLが無い場合も文が壊れない',
);

// --- 実データ: 全ソースが漏れなくページに載る ---
const { sources } = loadConfig();
const entries = buildEntries(sources);
assert(entries.length === sources.length, `全 ${sources.length} ソースがエントリ化される`);
assert(
  entries.every((e) => e.publisher && e.dataset && e.attribution.startsWith('出典：')),
  '全エントリが提供者・名称・出典表示文を持つ',
);
assert(
  entries.filter((e) => !e.sourceUrl).length === 0,
  '全エントリが出典ページ URL を持つ',
);
const grouped = groupByLicense(entries).reduce((n, s) => n + s.entries.length, 0);
assert(grouped === entries.length, 'ライセンス区分への振り分けで取りこぼしが無い');

// --- 生成物が config と同期しているか ---
const html = generate();
const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf-8') : '';
assert(
  current === html,
  'attribution.html が config/sources.yaml と同期している（差分があれば npm run build:attribution）',
);
// HTML 側は & を実体参照にエスケープしているので、同じ変換をかけて突き合わせる。
assert(
  entries.every((e) => html.includes(e.sourceUrl.replaceAll('&', '&amp;'))),
  '全ソースの出典 URL がページに載っている',
);
assert(
  entries.every((e) => html.includes(`id="src-${e.key}"`)),
  '全ソースのアンカー（key）がページに載っている',
);

// --- LP（index.html）に書いたソース数が config と一致しているか ---
// LP は静的に「98 データソース」と表示するため、ソースを増減したら書き換えが要る。
const lp = fs.readFileSync(new URL('../../site/index.html', import.meta.url), 'utf-8');
const lpCounts = [...lp.matchAll(/data-source-count>(\d[\d,]*)</g)].map((m) => Number(m[1].replaceAll(',', '')));
assert(lpCounts.length > 0, 'LP にソース数の記載（data-source-count）がある');
assert(
  lpCounts.every((n) => n === sources.length),
  `LP のソース数の記載が config と一致する（記載: ${lpCounts.join(', ')} / 実際: ${sources.length}）`,
);

if (failures > 0) {
  console.error(`\n❌ ${failures}件のチェックに失敗`);
  process.exit(1);
}
console.log('\n✅ attribution.html 生成 テストに合格');
