// 週次クロールを実行する Fargate 側（japan-facilities-crawler）との契約を固定するテスト。
//   node scripts/crawler-contract.test.js
//
// クローラーはこのリポジトリの scripts/ を**実行時に毎回 clone して**そのまま動かす
// （イメージにコピーを焼かない。コピーが古くなる事故を避けるため）。
// つまりここでファイル名や配置を変えると、次の週次実行がそのまま落ちる。
// 壊れたことに気づくのは「配信データが1週間更新されない」ときなので、
// クローラーが依存している入口だけをテストで固定しておく。
//
// クローラー側の実行内容（docker/entrypoint.sh）:
//   npm ci --omit=dev            ... clone 直下で依存を入れる（package-lock.json が要る）
//   node scripts/crawl.js        ... クロール本体（api/ を生成し README 統計を更新）
//   node scripts/test.js         ... 配信物バリデーション（落ちたら配信しない）
//   node scripts/fetch-i2fas.mjs ... 月次の厚労省 i2fas 取得（別タスク）

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_PATH } from './lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// --- 実行時に clone して呼ばれる入口 ---------------------------------------
// 名前を変えるならクローラー側の entrypoint.sh も同じ PR で直すこと。
const ENTRYPOINTS = [
  ['scripts/crawl.js', '週次クロール本体'],
  ['scripts/test.js', '配信物バリデーション'],
  ['scripts/fetch-i2fas.mjs', '月次 i2fas 取得'],
];

for (const [rel, role] of ENTRYPOINTS) {
  test(`${rel} がある（${role}としてクローラーが実行する）`, () => {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} が見つからない`);
  });
}

// --- 実行時の依存インストール -------------------------------------------------
// クローラーは clone 直下で `npm ci --omit=dev` を走らせる。lockfile が無いと
// npm ci は失敗する（npm install へのフォールバックはしていない）。
test('package-lock.json がある（クローラーが npm ci で依存を入れる）', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'package-lock.json')));
});

// クロールに必要な依存は dependencies 側に無いといけない。--omit=dev で入るのは
// dependencies だけで、devDependencies（playwright 等）は入らない。
test('クロールが使うパッケージが dependencies に宣言されている', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const deps = Object.keys(pkg.dependencies || {});
  for (const name of ['@geolonia/normalize-japanese-addresses', 'js-yaml', 'geojson-vt', 'vt-pbf', 'xlsx', 'iconv-lite', 'fflate']) {
    assert.ok(deps.includes(name), `${name} が dependencies にない`);
  }
});

// --- 設定の位置 ---------------------------------------------------------------
// クローラーは clone をそのまま作業ディレクトリにするため、環境変数で場所を
// 教えずに既定パスの config/sources.yaml が読める状態でなければならない。
test('config/sources.yaml が既定パスにある（環境変数なしで読める）', () => {
  assert.ok(fs.existsSync(CONFIG_PATH), `${CONFIG_PATH} が見つからない`);
  assert.equal(path.relative(ROOT, CONFIG_PATH), path.join('config', 'sources.yaml'));
});

console.log(`\n✅ クローラー契約テスト: ${passed}件すべて合格`);
