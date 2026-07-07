// ---------------------------------------------------------------------------
// 出典・ライセンス・免責を機械可読でまとめた api/attribution.json を生成する。
//
// config/datasets.js（出典 master）と config/notices.js（免責文言）を単一ソースとし、
// CKAN のメタデータ（resource_show / package_show）からデータ取得日・自治体側の
// 最終更新日・ダウンロード URL などを動的に補完する。
//
// crawl.js からは resolveSource / buildAttribution を再利用する（クロール時に
// 取得済みの resource 情報を使い回して二重取得を避ける）。単独でも実行でき、
// クロールせず出典情報だけを更新できる:
//   node scripts/gen-attribution.js
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASETS } from '../config/datasets.js';
import { SERVICE, NOTICES, NOTICE_ORDER, SHORT_DISCLAIMER } from '../config/notices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ATTRIBUTION_PATH = path.join(ROOT, 'api', 'attribution.json');
const CKAN_BASE = 'https://data.bodik.jp';

// ---------------------------------------------------------------------------
// CKAN API: リソース情報（URL・フォーマット・更新日等）を取得
// ---------------------------------------------------------------------------
export async function fetchResourceInfo(resourceId) {
  const url = `${CKAN_BASE}/api/3/action/resource_show?id=${encodeURIComponent(resourceId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`resource_show failed: ${res.status} ${res.statusText} (${resourceId})`);
  }
  const json = await res.json();
  if (!json.success) {
    throw new Error(`resource_show returned success=false (${resourceId})`);
  }
  return json.result; // { url, format, package_id, last_modified, metadata_modified, ... }
}

// CKAN API: パッケージ（データセット）情報を取得（ライセンス・出典ページ等）。
// best-effort。失敗しても config の curated 値でフォールバックできるよう例外は握る。
export async function fetchPackageInfo(packageId) {
  if (!packageId) return null;
  try {
    const url = `${CKAN_BASE}/api/3/action/package_show?id=${encodeURIComponent(packageId)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json.result : null;
  } catch {
    return null;
  }
}

// ISO 日時文字列（例: 2026-03-05T09:55:45）を YYYY-MM-DD に整形する。
export function toDateString(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// データソース（出典）を解決する。
//   config/datasets.js の curated 値を優先し、欠けている項目は CKAN のメタデータ
//   から自動補完する。取得日・自治体側の最終更新日・ダウンロード URL を動的に付与。
// ---------------------------------------------------------------------------
export async function resolveSource(dataset, resourceInfo, retrievedAt) {
  const pkg = await fetchPackageInfo(resourceInfo.package_id);

  // 自治体側の最終更新日: リソースの last_modified → metadata_modified → パッケージの
  //   metadata_modified の順で最も確からしいものを採用する。
  const sourceUpdatedAt = toDateString(
    resourceInfo.last_modified || resourceInfo.metadata_modified || pkg?.metadata_modified,
  );

  return {
    municipality: dataset.municipality || pkg?.organization?.title || '不明',
    datasetName: dataset.datasetName || pkg?.title || '',
    sourceUrl: dataset.sourceUrl || (pkg?.name ? `${CKAN_BASE}/dataset/${pkg.name}` : null),
    downloadUrl: resourceInfo.url || null,
    license: dataset.license || pkg?.license_title || null,
    licenseUrl: dataset.licenseUrl || pkg?.license_url || null,
    sourceUpdatedAt,
    retrievedAt,
  };
}

// 解決済みの sources[] から attribution.json のオブジェクトを組み立てる。
export function buildAttribution({ updated, retrievedAt, sources }) {
  const notices = {};
  for (const key of NOTICE_ORDER) {
    if (NOTICES[key]) notices[key] = NOTICES[key];
  }
  return {
    meta: { updated, retrievedAt },
    service: SERVICE,
    disclaimer: SHORT_DISCLAIMER,
    sources,
    notices,
  };
}

// api/attribution.json を書き出す。
export function writeAttribution(obj) {
  fs.mkdirSync(path.dirname(ATTRIBUTION_PATH), { recursive: true });
  fs.writeFileSync(ATTRIBUTION_PATH, JSON.stringify(obj, null, 2) + '\n');
  console.log(`  出典情報: ${obj.sources.length}件 → ${path.relative(ROOT, ATTRIBUTION_PATH)}`);
}

// クロールせず、CKAN メタデータだけを取得して attribution.json を生成する。
export async function generateAttribution({ updated, retrievedAt } = {}) {
  const now = Date.now();
  updated = updated ?? Math.floor(now / 1000);
  retrievedAt = retrievedAt ?? new Date(now).toISOString().slice(0, 10);

  const sources = [];
  for (const dataset of DATASETS) {
    const info = await fetchResourceInfo(dataset.resourceId);
    sources.push(await resolveSource(dataset, info, retrievedAt));
  }
  const obj = buildAttribution({ updated, retrievedAt, sources });
  writeAttribution(obj);
  return obj;
}

// 直接実行された場合は生成する。
if (import.meta.url === `file://${process.argv[1]}`) {
  generateAttribution().catch((err) => {
    console.error('❌ エラー:', err.message);
    process.exit(1);
  });
}
