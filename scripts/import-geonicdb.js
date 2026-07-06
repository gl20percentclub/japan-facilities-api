// ---------------------------------------------------------------------------
// build/ngsild/ のエンティティチャンクを GeonicDB に一括投入する。
//
// 認証は geonicdb-pulse と同じ Bearer JWT 方式（POST /auth/login でトークン取得）。
// 投入は NGSI-LD の batch upsert（POST /ngsi-ld/v1/entityOperations/upsert、
// geonic CLI の `entityOperations upsert` と同じエンドポイント）。id が安定ハッシュ
// なので upsert は冪等（再投入で重複しない）。
//
// 認証情報は環境変数で渡す（履歴・ログに残さない）:
//   GEONICDB_URL       例) https://geonicdb.geolonia.com
//   GEONICDB_TENANT    例) ohashi
//   GEONICDB_EMAIL     例) naoki@geolonia.com
//   GEONICDB_PASSWORD  パスワード
//
// 使い方:
//   node scripts/gen-ngsild.js                       まずチャンクを生成
//   GEONICDB_URL=... GEONICDB_TENANT=ohashi \
//   GEONICDB_EMAIL=... GEONICDB_PASSWORD=... \
//     node scripts/import-geonicdb.js                投入
//   ... node scripts/import-geonicdb.js --limit 1    先頭1チャンクだけ（動作確認用）
//   ... node scripts/import-geonicdb.js --dry-run    ログインだけして投入しない
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build', 'ngsild');

// GeonicDB の batch upsert は 1 リクエスト 100 件が上限。チャンクファイルが
// それより大きくても、送信時に 100 件ずつに分割して投げる。
const BATCH_SIZE = 100;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`環境変数 ${name} が未設定です`);
    process.exit(1);
  }
  return v;
}

/** POST /auth/login で Bearer トークンを取得する（pulse と同じログインフロー）。 */
async function login(url, tenant, email, password) {
  const res = await fetch(`${url}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, tenantName: tenant }),
  });
  if (!res.ok) {
    throw new Error(`ログイン失敗: HTTP ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const token = json.accessToken || json.token;
  if (!token) throw new Error('ログイン応答にトークンがありません');
  return token;
}

/** 1 チャンクを batch upsert する。 */
async function upsertChunk(url, tenant, token, entities) {
  const res = await fetch(`${url}/ngsi-ld/v1/entityOperations/upsert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'NGSILD-Tenant': tenant,
    },
    body: JSON.stringify(entities),
  });
  if (!res.ok) {
    throw new Error(`upsert 失敗: HTTP ${res.status} ${await res.text()}`);
  }
  return res.status;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const li = argv.indexOf('--limit');
  const limit = li >= 0 ? Number(argv[li + 1]) : Infinity;

  const url = requireEnv('GEONICDB_URL').replace(/\/$/, '');
  const tenant = requireEnv('GEONICDB_TENANT');
  const email = requireEnv('GEONICDB_EMAIL');
  const password = requireEnv('GEONICDB_PASSWORD');

  if (!fs.existsSync(OUT_DIR)) {
    console.error(`${path.relative(ROOT, OUT_DIR)} がありません。先に gen-ngsild.js を実行してください`);
    process.exit(1);
  }
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.json')).sort();
  console.log(`チャンク: ${files.length}件 (${url}, tenant=${tenant})`);

  const token = await login(url, tenant, email, password);
  console.log('ログイン成功');
  if (dryRun) {
    console.log('--dry-run のため投入しません');
    return;
  }

  let done = 0;
  let total = 0;
  for (const file of files) {
    if (done >= limit) break;
    const entities = JSON.parse(fs.readFileSync(path.join(OUT_DIR, file), 'utf-8'));
    // 1 ファイルを 100 件ずつに分けて upsert（サーバのバッチ上限に合わせる）。
    for (let i = 0; i < entities.length; i += BATCH_SIZE) {
      const batch = entities.slice(i, i + BATCH_SIZE);
      await upsertChunk(url, tenant, token, batch);
      total += batch.length;
    }
    done += 1;
    console.log(`  ${file}: ${entities.length}件 upsert  [${done}/${Math.min(files.length, limit)}]`);
  }
  console.log(`完了: ${total}件を投入しました`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
