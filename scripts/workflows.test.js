// gh-pages への配信ワークフローの設定を検証する。
//
//   node scripts/workflows.test.js
//
// 過去に、publish_dir が . のため .gitignore ごと配信され、配信先で git add --all
// された結果 api/ が一切コミットされず（.gitignore が api/ を無視するため）、
// gh-pages 上のデータが全削除される事故があった。現在は配信元を site/ に限定して
// 同じ壊れ方を構造的に起きなくしてあるので、その前提のほうをテストで固定する。
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

// --- 配信元が公開用ディレクトリ（site/）に限定されている ---
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
  // 配信元は公開用ディレクトリ（site/）に限定する。リポジトリのルートを配信すると
  // README・docs/・config/ まで公開され、さらに .gitignore ごと配信された場合は
  // 配信先の git add --all で api/ が無視されて gh-pages 上のデータが消える。
  // 除外リストで塞ぐより、配信元を分けて構造的に起きなくするほうが確実。
  const publishDir = String(withInputs.publish_dir ?? '');
  assert(
    publishDir !== '.' && publishDir !== '' && publishDir !== './',
    `${file}: publish_dir がリポジトリのルートではない（実際: ${publishDir || '未指定'}）`,
  );
  // 配信元に混ざってはいけないものが実際に無いことを確認する（除外リストの代わり）。
  for (const forbidden of ['.gitignore', 'node_modules', 'scripts', 'package.json']) {
    assert(
      !fs.existsSync(path.join(ROOT, publishDir, forbidden)),
      `${file}: 配信元 ${publishDir}/ に ${forbidden} が無い`,
    );
  }
  // 除外リストを併用する場合は、上の前提を崩さない範囲であること。
  assert(
    excluded.every((e) => e === ''),
    `${file}: 配信元を site/ に絞ったため exclude_assets は不要`,
  );
}

// --- 役割 ---
// pages.yml はページだけを上書きし、gh-pages 上の既存ファイルを消さない。
const pagesDeploy = deploySteps(pages)[0]?.with ?? {};
const pagesPublishDir = String(pagesDeploy.publish_dir ?? 'site');
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
// 配信元ディレクトリ配下は一括で拾う。個別列挙だとページ追加時に書き忘れる。
assert(
  pushPaths.includes(`${pagesPublishDir}/**`),
  `pages.yml: ${pagesPublishDir}/** の変更を配信対象にしている`,
);
// 公開しているページが配信元に実在することを確認する（移動・リネーム時の追従漏れ防止）。
for (const page of ['index.html', 'map.html', 'playground.html', 'attribution.html', 'llms.txt', 'llms-full.txt']) {
  assert(
    fs.existsSync(path.join(ROOT, pagesPublishDir, page)),
    `pages.yml: ${pagesPublishDir}/${page} がリポジトリに存在する`,
  );
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
for (const generated of ['site/attribution.html', 'site/llms.txt', 'site/llms-full.txt']) {
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
