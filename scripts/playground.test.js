// 検索プレイグラウンド(playground.html)と検索 API 仕様との整合性テスト。
//   node scripts/playground.test.js
//
// playground.html は geosearch（https://github.com/naogify/geosearch）の検索 API を
// 直接呼ぶため、使うクエリパラメータやレスポンスのフィールド名が API 仕様
// （geosearch リポジトリの docs/search-api.md）とズレるとページが黙って壊れる。
// ここでは API 仕様のスナップショットをこのファイルに固定し、playground.html の
// 記述と突き合わせる。API 仕様が変わったらこのスナップショットも更新すること。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'playground.html'), 'utf-8');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// --- geosearch 検索 API 仕様のスナップショット（docs/search-api.md より） ---
// クエリパラメータ一覧。ページが使ってよいのはこの範囲だけ。
const API_QUERY_PARAMS = ['q', 'center', 'radius', 'bbox', 'limit'];
// レスポンス results[] のフィールド一覧。
const API_RESULT_FIELDS = [
  'name', 'name_kana', 'prefecture', 'city', 'address', 'business_type', 'lat', 'lng', 'level',
];

test('API エンドポイントを ?api= で上書きでき、既定値の定数を持つ', () => {
  // デプロイの CDK 出力（SearchApiUrl）を差し替えられる構造を固定する。
  assert.ok(HTML.includes('DEFAULT_API_URL'), '差し替え用の定数 DEFAULT_API_URL がある');
  assert.ok(/URLSearchParams\(location\.search\)\.get\('api'\)/.test(HTML), '?api= で上書きできる');
});

test('ページが組み立てるクエリパラメータが API 仕様の範囲内である', () => {
  // params.set('xxx', ...) で使っているキーを抽出して仕様と突き合わせる。
  const used = [...HTML.matchAll(/params\.set\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(used.length >= 3, `クエリパラメータを組み立てている (${used.join(',')})`);
  for (const key of used) {
    assert.ok(API_QUERY_PARAMS.includes(key), `パラメータ ${key} が API 仕様に存在する`);
  }
  // 主要な検索パラメータは一通り使っていること（機能の退行防止）。
  for (const key of API_QUERY_PARAMS) {
    assert.ok(used.includes(key), `パラメータ ${key} をページが利用している`);
  }
});

test('結果テーブル・CSV が使うフィールドが API レスポンス仕様と一致する', () => {
  // RESULT_FIELDS 配列（テーブル・CSV の列定義）を抽出して仕様と突き合わせる。
  const m = HTML.match(/const RESULT_FIELDS = \[([^\]]+)\]/);
  assert.ok(m, 'RESULT_FIELDS が定義されている');
  const fields = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  for (const f of fields) {
    assert.ok(API_RESULT_FIELDS.includes(f), `フィールド ${f} が API レスポンス仕様に存在する`);
  }
  // レスポンス仕様の全フィールドを表に出していること（情報の取りこぼし防止）。
  for (const f of API_RESULT_FIELDS) {
    assert.ok(fields.includes(f), `API のフィールド ${f} をページが表示する`);
  }
});

test('レスポンスの count / results / error を仕様どおり参照している', () => {
  assert.ok(/body\.results/.test(HTML), 'results 配列を読んでいる');
  assert.ok(/body\.count/.test(HTML), 'count を読んでいる');
  assert.ok(/body\.error/.test(HTML), '400 エラー時の error メッセージを読んでいる');
});

// 廃止した配信形式や、このリポジトリには無いエンドポイントを参照していないこと。
test('廃止した配信形式・存在しないエンドポイントを参照していない', () => {
  for (const gone of ['facilities/index.json', 'search-index', '/data.json', 'api/parquet']) {
    assert.ok(!HTML.includes(gone), `playground.html が ${gone} を参照していない`);
  }
});

console.log(`\n✅ playground 整合性テスト: ${passed}件すべて合格`);
