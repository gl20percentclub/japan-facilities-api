// gh-pages への配信ワークフローの設定を検証する。
//
//   node scripts/workflows.test.js
//
// 過去に、publish_dir が . のため .gitignore ごと配信され、配信先で git add --all
// された結果 api/ が一切コミットされず（.gitignore が api/ を無視するため）、
// gh-pages 上のデータが全削除される事故があった。同じ壊れ方を繰り返さないよう、
// 配信ステップの設定をテストで固定する。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

/** ワークフロー YAML を読む。`on:` は YAML 1.1 では真偽値 true になるため両方見る。 */
function loadWorkflow(name) {
  const doc = yaml.load(fs.readFileSync(path.join(ROOT, '.github/workflows', name), 'utf8'));
  return { ...doc, on: doc.on ?? doc[true] };
}

/** 全ジョブから actions-gh-pages の配信ステップを集める。 */
function deploySteps(workflow) {
  return Object.values(workflow.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .filter((step) => (step.uses ?? '').startsWith('peaceiris/actions-gh-pages'));
}

console.log('ワークフロー設定テスト\n');

const crawl = loadWorkflow('crawl.yml');
const pages = loadWorkflow('pages.yml');

// --- .gitignore が api/ を無視している前提を確認する ---
// この前提が崩れたら以降の除外チェックの意味も変わるため、最初に固定する。
const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
const ignoresApi = gitignore.split('\n').some((line) => line.trim() === 'api/');
assert(ignoresApi, '.gitignore が api/ を無視している（配信物は Git 管理しない）');

// --- 配信ステップは .gitignore を配信対象から除外する ---
const allDeploySteps = [
  ...deploySteps(crawl).map((step) => ['crawl.yml', step]),
  ...deploySteps(pages).map((step) => ['pages.yml', step]),
];
assert(allDeploySteps.length === 2, '配信ステップが crawl.yml と pages.yml に1つずつある');

for (const [file, step] of allDeploySteps) {
  const withInputs = step.with ?? {};
  const excluded = String(withInputs.exclude_assets ?? '')
    .split(',')
    .map((s) => s.trim());
  assert(
    withInputs.publish_branch === 'gh-pages',
    `${file}: 配信先ブランチが gh-pages である`,
  );
  assert(
    !ignoresApi || withInputs.publish_dir !== '.' || excluded.includes('.gitignore'),
    `${file}: publish_dir が . のとき .gitignore を除外している（api/ 消失の防止）`,
  );
  assert(
    excluded.includes('node_modules') && excluded.includes('.cache'),
    `${file}: node_modules と .cache を配信しない`,
  );
}

// --- それぞれの役割 ---
// crawl.yml は生成し直した api/ をまるごと入れ替える（削除も反映する掃除役）。
// pages.yml はページだけを上書きし、既存の api/ を消さない。
const crawlDeploy = deploySteps(crawl)[0]?.with ?? {};
const pagesDeploy = deploySteps(pages)[0]?.with ?? {};
assert(
  crawlDeploy.keep_files !== true,
  'crawl.yml: keep_files を有効にしない（旧生成物を掃除する）',
);
assert(
  pagesDeploy.keep_files === true,
  'pages.yml: keep_files が true（既存の api/ を消さない）',
);

// --- gh-pages への同時 push を避ける ---
assert(
  crawl.concurrency?.group != null && crawl.concurrency?.group === pages.concurrency?.group,
  '2つのワークフローが同じ concurrency グループで直列化される',
);

// --- ページの変更が push で配信される ---
const pushPaths = pages.on?.push?.paths ?? [];
assert(pages.on?.push?.branches?.includes('main'), 'pages.yml: main への push で動く');
for (const page of ['index.html', 'map.html', 'playground.html', 'attribution.html']) {
  assert(pushPaths.includes(page), `pages.yml: ${page} の変更を配信対象にしている`);
}
// 配信されるページがリポジトリに実在することも確認する（リネーム時の追従漏れ防止）。
for (const page of pushPaths.filter((p) => p.endsWith('.html'))) {
  assert(fs.existsSync(path.join(ROOT, page)), `pages.yml: ${page} がリポジトリに存在する`);
}

console.log('');
if (failures > 0) {
  console.error(`❌ ワークフロー設定テストに ${failures} 件の失敗`);
  process.exit(1);
}
console.log('✅ ワークフロー設定テストに合格');
