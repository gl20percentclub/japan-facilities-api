// 地図ページ(map.html)の検索窓と、検索 API 仕様との整合性テスト。
//   node scripts/map-search.test.js
//
// map.html は geosearch（https://github.com/naogify/geosearch）の検索 API を
// 直接呼ぶため、使うクエリパラメータやレスポンスのフィールド名が API 仕様
// （geosearch リポジトリの docs/search-api.md）とズレるとページが黙って壊れる。
// ここでは API 仕様のスナップショットをこのファイルに固定し、map.html の
// 記述と突き合わせる。API 仕様が変わったらこのスナップショットも更新すること。
//
// ページはキーワード検索だけの最小構成で、API のプレイグラウンド機能
// （範囲指定・件数指定・リクエストURL表示・CSV出力）は持たない。
// 旧 playground.html は map.html へのリダイレクトだけを残してある。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'map.html'), 'utf-8');
const PLAYGROUND = fs.readFileSync(path.join(ROOT, 'playground.html'), 'utf-8');

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
  for (const key of used) {
    assert.ok(API_QUERY_PARAMS.includes(key), `パラメータ ${key} が API 仕様に存在する`);
  }
  // キーワード検索だけの最小構成なので q は必須。
  assert.ok(used.includes('q'), 'キーワード q で検索している');
});

test('結果リスト・地図が参照するフィールドが API レスポンス仕様に存在する', () => {
  // 検索結果の1行は row.<field> として参照している。仕様外の名前を使っていないか見る。
  const referenced = new Set([...HTML.matchAll(/\brow\.([a-z_]+)\b/g)].map((m) => m[1]));
  assert.ok(referenced.size >= 5, `検索結果のフィールドを参照している (${[...referenced].join(',')})`);
  for (const key of referenced) {
    assert.ok(API_RESULT_FIELDS.includes(key), `フィールド ${key} が API レスポンス仕様に存在する`);
  }
  // 一覧・地図で最低限使うもの（名称・業種・座標）が揃っていること。
  for (const key of ['name', 'business_type', 'lat', 'lng']) {
    assert.ok(referenced.has(key), `フィールド ${key} を画面で使っている`);
  }
});

test('レスポンスの count / results / error を仕様どおり参照している', () => {
  assert.ok(/body\.results/.test(HTML), 'results 配列を読んでいる');
  assert.ok(/body\.count/.test(HTML), 'count を読んでいる');
  assert.ok(/body\.error/.test(HTML), '400 エラー時の error メッセージを読んでいる');
});

test('検索結果を全件タイルとは別のソース・レイヤで重ねている', () => {
  // 検索結果は GeoJSON ソース results として全件タイルの上に描く構成を固定する。
  assert.ok(/source:\s*'results'/.test(HTML), '検索結果レイヤが results ソースを使う');
  assert.ok(/getSource\('results'\)\.setData/.test(HTML), '検索結果を setData で差し替える');
});

test('API プレイグラウンドの UI を持たない（最小構成を維持する）', () => {
  // 統計表示と検索窓だけのページに保つ。復活させたい場合はこのテストも一緒に直す。
  for (const gone of ['request-url', 'downloadCsv', 'RESULT_FIELDS', 'curl']) {
    assert.ok(!HTML.includes(gone), `map.html が ${gone} を持たない`);
  }
});

test('旧 playground.html が map.html へリダイレクトする', () => {
  assert.ok(
    /http-equiv="refresh"[^>]*url=\.\/map\.html/.test(PLAYGROUND),
    'playground.html が map.html へ meta refresh する',
  );
  assert.ok(
    /rel="canonical" href="\.\/map\.html"/.test(PLAYGROUND),
    'playground.html が map.html を canonical に指す',
  );
});

// 廃止した配信形式や、このリポジトリには無いエンドポイントを参照していないこと。
test('廃止した配信形式・存在しないエンドポイントを参照していない', () => {
  for (const gone of ['facilities/index.json', 'search-index', '/data.json', 'api/parquet']) {
    assert.ok(!HTML.includes(gone), `map.html が ${gone} を参照していない`);
  }
});

console.log(`\n✅ 地図ページ 整合性テスト: ${passed}件すべて合格`);
