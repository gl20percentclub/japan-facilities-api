// ---------------------------------------------------------------------------
// config/notices.js から、人が読む NOTICE.md（利用規約・免責事項）を生成する。
//
// 文言はすべて config/notices.js を単一ソースとし、ここでは Markdown 体裁に
// 組み立てるだけ。文言を変えたいときは config/notices.js を編集して
// `npm run build:notice`（または `npm run build`）を実行する。
//
// 使い方:
//   node scripts/gen-notice.js       config/notices.js から NOTICE.md を生成
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICE, NOTICES, NOTICE_ORDER } from '../config/notices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NOTICE_PATH = path.join(ROOT, 'NOTICE.md');

/** config/notices.js から NOTICE.md の本文を組み立てて返す。 */
export function renderNotice() {
  const lines = [];
  lines.push('# 利用規約・免責事項');
  lines.push('');
  lines.push(
    '> このファイルは `config/notices.js` から自動生成しています。文言を変更する場合は `config/notices.js` を編集し、`npm run build:notice` を実行してください。',
  );
  lines.push('');
  lines.push(`## ${SERVICE.name} について`);
  lines.push('');
  lines.push(SERVICE.description);
  lines.push('');

  for (const key of NOTICE_ORDER) {
    const notice = NOTICES[key];
    if (!notice) continue;
    lines.push(`## ${notice.title}`);
    lines.push('');
    const body = Array.isArray(notice.body) ? notice.body : [notice.body];
    for (const paragraph of body) {
      lines.push(paragraph);
      lines.push('');
    }
  }

  lines.push('## 出典・データソース');
  lines.push('');
  lines.push(
    '各データセットの出典（自治体名・データセット名・元データURL・ライセンス・データ取得日・自治体側の最終更新日）は、`api/attribution.json` で確認できます。',
  );
  lines.push('');

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** NOTICE.md を書き出す。 */
export function generateNotice() {
  const content = renderNotice();
  fs.writeFileSync(NOTICE_PATH, content);
  console.log(`  利用規約・免責: → ${path.relative(ROOT, NOTICE_PATH)}`);
  return content;
}

// 直接実行された場合は生成する。
if (import.meta.url === `file://${process.argv[1]}`) {
  generateNotice();
}
