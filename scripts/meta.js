// ---------------------------------------------------------------------------
// 各 JSON 出力の meta を組み立てる共通ヘルパー。
//
// すべての API レスポンス（index.json / data.json / search-index.json）に、
// 出典・ライセンス・免責・詳細な出典情報（attribution.json）への参照を含める。
// 文言・URL は config/notices.js を単一ソースとする。
// ---------------------------------------------------------------------------

import { SERVICE, SHORT_DISCLAIMER } from '../config/notices.js';

/** 詳細な出典・ライセンス・免責を機械可読で返す attribution.json の公開 URL。 */
export function attributionUrl() {
  return `${SERVICE.url.replace(/\/$/, '')}/api/attribution.json`;
}

/**
 * 各出力ファイルの meta を組み立てる。
 * source / license は判っていれば含める（後方互換のため従来キーを維持）。
 */
export function buildFileMeta({ updated, source, license } = {}) {
  const meta = { updated };
  if (source) meta.source = source;
  if (license) meta.license = license;
  meta.disclaimer = SHORT_DISCLAIMER;
  meta.attribution = attributionUrl();
  return meta;
}
