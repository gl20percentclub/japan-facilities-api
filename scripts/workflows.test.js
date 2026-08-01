// gh-pages への配信ワークフローの設定を検証する。
//
//   node scripts/workflows.test.js
//
// 過去に、publish_dir が . のため .gitignore ごと配信され、配信先で git add --all
// された結果 api/ が一切コミットされず（.gitignore が api/ を無視するため）、
// gh-pages 上のデータが全削除される事故があった。同じ壊れ方を繰り返さないよう、
// 配信ステップの設定をテストで固定する。
//
// データ（api/）の配信は外部の Fargate クローラー（S3 + CloudFront）へ移したため、
// gh-pages へ配信するのは静的ページだけ。旧 crawl.yml は廃止済みで、復活しないことも
// ここで固定する。

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

const pages = loadWorkflow('pages.yml');

// --- 旧 crawl.yml が復活していない ---
// gh-pages へデータを配信していた旧ワークフロー。クロールと配信は外部の Fargate
// クローラー（S3 + CloudFront）に移ったため廃止した。復活すると (1) 100MB を超える
// 結合CSV で push 全体が失敗し、(2) 生成物（attribution.html / llms*.txt）を main へ
// push して古い内容に巻き戻す事故が再発する。
assert(
  !fs.existsSync(path.join(ROOT, '.github/workflows/crawl.yml')),
  '廃止した crawl.yml が復活していない（クロールと配信は外部の Fargate クローラーが担う）',
);

// --- .gitignore が api/ を無視している前提を確認する ---
// この前提が崩れたら以降の除外チェックの意味も変わるため、最初に固定する。
const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
const ignoresApi = gitignore.split('\n').some((line) => line.trim() === 'api/');
assert(ignoresApi, '.gitignore が api/ を無視している（配信物は Git 管理しない）');

// --- 配信ステップは .gitignore を配信対象から除外する ---
const allDeploySteps = deploySteps(pages).map((step) => ['pages.yml', step]);
assert(allDeploySteps.length === 1, '配信ステップは pages.yml の1つだけ');

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

// --- 役割 ---
// pages.yml はページだけを上書きし、gh-pages 上の既存ファイルを消さない。
const pagesDeploy = deploySteps(pages)[0]?.with ?? {};
assert(
  pagesDeploy.keep_files === true,
  'pages.yml: keep_files が true（gh-pages 上の既存ファイルを消さない）',
);

// --- gh-pages への同時 push を避ける ---
// main への連続 push で配信が重なると push が競合するため直列化する。
assert(
  pages.concurrency?.group != null && pages.concurrency?.['cancel-in-progress'] !== true,
  'pages.yml: concurrency グループで配信を直列化する（実行中をキャンセルしない）',
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

// --- 自動生成ページは配信前に生成元から作り直す ---
// コミット済みの attribution.html / llms*.txt が古くても（外部の自動コミット等）、
// 公開ページは常に config/sources.yaml・README.md と一致させるための固定。
const pagesRun = Object.values(pages.jobs ?? {})
  .flatMap((job) => job.steps ?? [])
  .map((step) => step.run ?? '')
  .join('\n');
assert(
  pagesRun.includes('build:attribution') && pagesRun.includes('build:llms'),
  'pages.yml: 配信前に attribution.html / llms*.txt を再生成する',
);
// 再生成が配信ステップより前にあること（順序が入れ替わると意味がない）。
const pagesStepNames = Object.values(pages.jobs ?? {})
  .flatMap((job) => job.steps ?? [])
  .map((step) => (step.uses ?? '').startsWith('peaceiris/actions-gh-pages')
    ? 'DEPLOY'
    : (step.run ?? ''));
assert(
  pagesStepNames.findIndex((s) => s.includes('build:attribution'))
    < pagesStepNames.indexOf('DEPLOY'),
  'pages.yml: 再生成ステップが配信ステップより前にある',
);
// 生成元の変更だけでも配信が走る（生成物のコミット漏れで公開ページが古くならない）。
for (const src of ['README.md', 'config/sources.yaml']) {
  assert(pushPaths.includes(src), `pages.yml: ${src} の変更を配信対象にしている`);
}

// --- 生成物のドリフトを検知・自己修復するワークフロー ---
const genDocs = loadWorkflow('generated-docs.yml');
const genDocsPushPaths = genDocs.on?.push?.paths ?? [];
assert(
  genDocs.on?.push?.branches?.includes('main'),
  'generated-docs.yml: main への push で動く',
);
// PR でのドリフト検査は ci.yml のユニットテスト（同期テストを含む）が担う。
const ci = loadWorkflow('ci.yml');
const ciRun = Object.values(ci.jobs ?? {})
  .flatMap((job) => job.steps ?? [])
  .map((step) => step.run ?? '')
  .join('\n');
assert(ci.on?.pull_request !== undefined, 'ci.yml: PR でテストが走る');
assert(ciRun.includes('test:unit'), 'ci.yml: ユニットテスト（生成物の同期検査を含む）を実行する');
for (const generated of ['attribution.html', 'llms.txt', 'llms-full.txt']) {
  assert(
    genDocsPushPaths.includes(generated),
    `generated-docs.yml: ${generated} への push を検査対象にしている（外部の古い自動コミット対策）`,
  );
}
assert(
  genDocs.permissions?.contents === 'write',
  'generated-docs.yml: 自己修復コミットのため contents: write を持つ',
);

console.log('');
if (failures > 0) {
  console.error(`❌ ワークフロー設定テストに ${failures} 件の失敗`);
  process.exit(1);
}
console.log('✅ ワークフロー設定テストに合格');
