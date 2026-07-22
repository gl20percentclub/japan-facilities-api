// 設定ファイル（config/sources.yaml）のローダー。
//
// このファイル1つが「どこから・どうやって取得し、どの列をどう正規化するか」の
// 単一の情報源。crawl.js とその lib モジュールはここから設定を読む。
//
//   sources    取得対象の配列（key / acquire / source / sourceUrl / license / 既定値 …）
//   columns    内部キー → 元ヘッダー表記[] の対応表（YAML では読みやすさ優先でこの向き）
//   columnMap  上記を反転した 元ヘッダー → 内部キー のフラットな別名辞書（パースで使う）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const CONFIG_PATH = path.join(ROOT, 'config', 'sources.yaml');

const _cache = new Map();

/**
 * config/sources.yaml を読み込み、{ sources, columns, columnMap } を返す。
 * 同一パスは一度読んだらキャッシュする（複数モジュールから呼ばれるため）。
 */
export function loadConfig(configPath = CONFIG_PATH) {
  if (_cache.has(configPath)) return _cache.get(configPath);

  const doc = yaml.load(fs.readFileSync(configPath, 'utf-8')) || {};
  const columns = doc.columns || {};

  // columns（内部キー → 元ヘッダー[]）を 元ヘッダー → 内部キー に反転する。
  // 元ヘッダーは全体で一意なので、最初に現れた対応を採用すれば十分。
  const columnMap = {};
  for (const [internal, headers] of Object.entries(columns)) {
    for (const h of headers || []) {
      if (columnMap[h] === undefined) columnMap[h] = internal;
    }
  }

  const value = { sources: doc.sources || [], columns, columnMap };
  _cache.set(configPath, value);
  return value;
}
