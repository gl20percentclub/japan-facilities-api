// 取得(acquire): ソース定義に従ってファイルを取得し .cache に保存する。
// 取得方法は5種: ckan / get / post / resolve / i2fasglob。
// 一過性の失敗はリトライ、恒久的な失敗(4xx)は即失敗。ZIP は中の csv/xlsx/xls を展開する。

import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// bot 対策で User-Agent 等を求めるサーバがあるため、常識的なヘッダを付ける。
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; japan-facilities-api/1.0; +https://github.com/gl20percentclub/japan-facilities-api)',
  'Accept-Language': 'ja,en;q=0.8',
  Accept: '*/*',
};

// CKAN API: リソース情報（URL・フォーマット）を取得。403/429/5xx は指数バックオフでリトライ。
export async function fetchCkanResourceInfo(ckanBase, resourceId, attempt = 0) {
  const url = `${ckanBase}/api/3/action/resource_show?id=${encodeURIComponent(resourceId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      return fetchCkanResourceInfo(ckanBase, resourceId, attempt + 1);
    }
    throw new Error(`resource_show failed: ${res.status} ${res.statusText} (${resourceId})`);
  }
  const json = await res.json();
  if (!json.success) throw new Error(`resource_show returned success=false (${resourceId})`);
  return json.result; // { url, format, ... }
}

// キャッシュ済みファイルを拡張子から探す（dry-run で CKAN 問い合わせを避けるため）
function findCachedFile(cacheDir, key) {
  for (const ext of ['csv', 'tsv', 'xlsx', 'xls']) {
    const p = path.join(cacheDir, `${key}.${ext}`);
    if (fs.existsSync(p)) return { cachePath: p, format: ext };
  }
  return null;
}

// HTTP GET/POST をリトライ付きで実行し、本文を ArrayBuffer で返す。
// 一過性の失敗（ネットワーク例外・5xx・429）は指数バックオフで再試行、4xx（429除く）は即失敗。
export async function fetchWithRetry(url, opts = {}, { retries = 3, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.log(`    リトライ ${attempt}/${retries}（${delay}ms 待機）: ${lastErr.message}`);
      await sleep(delay);
    }
    try {
      const res = await fetch(url, opts);
      if (res.ok) return await res.arrayBuffer();
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        const err = new Error(`ダウンロード失敗: ${res.status} ${res.statusText}`);
        err.permanent = true;
        throw err;
      }
      lastErr = new Error(`ダウンロード失敗: ${res.status} ${res.statusText}`);
    } catch (e) {
      if (e.permanent) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

// href/リンク文言中の基本的な HTML 実体参照を復元する（&amp; 等）。
function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// HTML から、リンク文言が pattern に一致する <a href> を1件解決する。
// 返り値: { url, text, count }（一致0件なら null。複数時は先頭を採用）
export function resolveLinkFromHtml(htmlText, { pattern, format, baseUrl } = {}) {
  const textRe = pattern ? new RegExp(pattern, 'i') : null;
  const extRe = format ? new RegExp(`\\.${format}(?:$|[?#])`, 'i') : null;
  const anchorRe = /<a\b[^>]*\shref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const candidates = [];
  let m;
  while ((m = anchorRe.exec(htmlText))) {
    const href = decodeHtmlEntities(m[1]);
    const text = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (extRe && !extRe.test(href)) continue;
    if (textRe && !textRe.test(text)) continue;
    candidates.push({ href, text });
  }
  if (candidates.length === 0) return null;
  const { href, text } = candidates[0];
  const url = baseUrl ? new URL(href, baseUrl).toString() : href;
  return { url, text, count: candidates.length };
}

// ZIP バイト列から対象の csv/xlsx/xls を取り出す。
async function extractFromZip(zipBuf, entryPattern) {
  const { unzipSync } = await import('fflate');
  const files = unzipSync(new Uint8Array(zipBuf));
  const names = Object.keys(files).filter((n) => !n.endsWith('/'));
  const re = entryPattern ? new RegExp(entryPattern, 'i') : /\.(csv|xlsx|xls)$/i;
  const name = names.find((n) => re.test(n)) || names.find((n) => /\.(csv|xlsx|xls)$/i.test(n));
  if (!name) throw new Error(`ZIP 内に csv/xlsx/xls が見つかりません: [${names.join(', ')}]`);
  const mm = name.toLowerCase().match(/\.(csv|xlsx|xls)$/);
  return { buf: Buffer.from(files[name]), format: mm[1] };
}

// ソースが取得すべきファイル群を返す。単一 url でも複数 urls[] でも扱える。
// 返り値: [{ cachePath, format }, ...]（複数ファイルはパース後に結合される）
export async function acquire(source, { cacheDir, dryRun = false } = {}) {
  const a = source.acquire;

  // i2fasglob: scripts/fetch-i2fas.mjs が取得した .cache/i2fas/*.csv をまとめて読む。
  if (a.type === 'i2fasglob') {
    const dir = path.join(cacheDir, 'i2fas');
    if (!fs.existsSync(dir)) throw new Error(`.cache/i2fas がありません（先に node scripts/fetch-i2fas.mjs を実行）`);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
    if (files.length === 0) throw new Error('.cache/i2fas に CSV がありません');
    console.log(`  i2fas キャッシュ ${files.length} ファイルを使用`);
    return files.map((f) => ({ cachePath: path.join(dir, f), format: 'csv' }));
  }

  const urls = a.urls || (a.url ? [a.url] : [null]); // ckan は url なしで resourceId 解決
  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const suffix = urls.length > 1 ? `-${i}` : '';
    const key = `${source.key}${suffix}`;

    // dry-run はキャッシュのみ使用。CKAN 問い合わせをせず拡張子からファイルを特定する。
    if (dryRun) {
      const hit = findCachedFile(cacheDir, key);
      if (!hit) throw new Error(`--dry-run ですがキャッシュが存在しません: ${key}`);
      console.log(`  [dry-run] キャッシュを使用: ${hit.cachePath}`);
      results.push(hit);
      continue;
    }

    let downloadUrl = urls[i];
    let format = (a.format || '').toLowerCase();

    if (a.type === 'ckan') {
      const info = await fetchCkanResourceInfo(a.ckanBase, a.resourceId);
      downloadUrl = info.url;
      if (!format) format = (info.format || '').toLowerCase();
    }
    // resolve: 掲載ページ(pageUrl)を取得し、リンク文言が linkPattern に一致する
    // <a href> を実ダウンロードURLとして解決する（ファイル名に日時が入る自治体向け）。
    if (a.type === 'resolve') {
      console.log(`  リンク解決中: ${a.pageUrl}`);
      const html = Buffer.from(await fetchWithRetry(a.pageUrl, { headers: { ...DEFAULT_HEADERS } })).toString('utf-8');
      const hit = resolveLinkFromHtml(html, { pattern: a.linkPattern, format, baseUrl: a.pageUrl });
      if (!hit) {
        throw new Error(
          `リンク解決に失敗: ${a.pageUrl} に「${a.linkPattern || '(指定なし)'}」に一致する` +
            `${format ? ` .${format}` : ''} リンクが見つかりません`,
        );
      }
      if (hit.count > 1) console.log(`  ⚠ ${hit.count}件一致。先頭を採用: 「${hit.text}」`);
      console.log(`  リンク解決: 「${hit.text}」 -> ${hit.url}`);
      downloadUrl = hit.url;
    }
    if (!format) {
      const mm = String(downloadUrl).toLowerCase().match(/\.(csv|tsv|txt|xlsx|xls|zip)(?:$|\?)/);
      format = mm ? mm[1] : 'csv';
    }
    if (format === 'txt') format = 'tsv'; // LinkData 等の tab 区切り txt

    const fetchOpts = { headers: { ...DEFAULT_HEADERS } };
    if (a.type === 'post') {
      fetchOpts.method = 'POST';
      fetchOpts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchOpts.body = new URLSearchParams(a.body || {}).toString();
    }

    console.log(`  ダウンロード中: ${downloadUrl}`);
    let buf = Buffer.from(await fetchWithRetry(downloadUrl, fetchOpts));

    // format: 'zip' のとき、中の csv/xlsx/xls を取り出す（acquire.zipEntry で対象指定可）。
    if (format === 'zip') {
      const extracted = await extractFromZip(buf, a.zipEntry);
      buf = extracted.buf;
      format = extracted.format;
    }

    const ext = format === 'xlsx' ? 'xlsx' : format === 'xls' ? 'xls' : format === 'tsv' ? 'tsv' : 'csv';
    const cachePath = path.join(cacheDir, `${key}.${ext}`);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cachePath, buf);
    console.log(`  キャッシュに保存: ${cachePath} (${buf.length} bytes)`);
    results.push({ cachePath, format });
  }
  return results;
}
