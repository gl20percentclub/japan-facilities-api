// パース: 取得したファイル(CSV/TSV/XLSX/XLS)を行→レコード配列に変換する。
// 文字コードのデコード、ヘッダー行の自動判定、引用符対応の区切りパースを担う。

import fs from 'node:fs';
import { DEFAULT_COLUMN_MAP } from './normalize.js';

// CSV のバイト列を文字列にデコードする。
//   encoding 明示（'utf-8' / 'shift_jis' / 'utf-16' / 'utf-16le' / 'utf-16be'）があればそれを使う。
//   'auto'（既定）は BOM と UTF-8 妥当性から判定し、化ける場合は Shift_JIS にフォールバック。
export async function decodeCsvBuffer(buf, encoding) {
  const { default: iconv } = await import('iconv-lite');
  const enc = (encoding || 'auto').toLowerCase();

  if (enc === 'shift_jis' || enc === 'sjis' || enc === 'cp932') return iconv.decode(buf, 'Shift_JIS');
  if (enc === 'utf-8' || enc === 'utf8') return iconv.decode(buf, 'utf-8');
  if (enc === 'utf-16' || enc === 'utf16' || enc === 'utf-16le' || enc === 'utf16le') return iconv.decode(buf, 'utf-16le');
  if (enc === 'utf-16be' || enc === 'utf16be') return iconv.decode(buf, 'utf-16be');

  // auto: BOM から判定
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return iconv.decode(buf, 'utf-16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return iconv.decode(buf, 'utf-16be');
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return iconv.decode(buf, 'utf-8');
  // UTF-8 としてデコードし、置換文字（U+FFFD）が出るようなら Shift_JIS とみなす
  const asUtf8 = iconv.decode(buf, 'utf-8');
  if (asUtf8.includes('�')) return iconv.decode(buf, 'Shift_JIS');
  return asUtf8;
}

// 表（行の配列）から、ヘッダー行を自動判定する。
// 一部データは先頭にタイトル行や空行があるため、先頭行をヘッダーと決め打ちにしない。
// columnMap に載っている見出しを最も多く含む行をヘッダーとみなす（無ければ先頭行）。
export function detectHeaderRow(rows, columnMap = DEFAULT_COLUMN_MAP) {
  let bestIdx = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 8);
  for (let i = 0; i < limit; i++) {
    const score = rows[i].reduce(
      (n, c) => n + (columnMap[String(c).trim().replace(/^﻿/, '')] ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestScore >= 2 ? bestIdx : 0;
}

export function rowsToRecords(rows, columnMap = DEFAULT_COLUMN_MAP) {
  if (rows.length === 0) return [];
  const hi = detectHeaderRow(rows, columnMap);
  const headers = rows[hi].map((h) => String(h).trim().replace(/^﻿/, ''));
  return rows.slice(hi + 1).map((cells) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (!h) return;
      const v = cells[i];
      obj[h] = v === undefined || v === null ? '' : typeof v === 'string' ? v : String(v);
    });
    return obj;
  });
}

// RFC4180 風の区切りテキストパーサ（引用符・引用符内の改行/区切り文字に対応）。
// delimiter を切り替えれば CSV（,）でも TSV（\t）でも扱える。
export function parseCSVText(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // 次の \n と合わせて1改行として扱う
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  // 末尾フィールド/行
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 空行を除去
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export async function parseCSV(cachePath, encoding, delimiter = ',', columnMap = DEFAULT_COLUMN_MAP) {
  const buf = fs.readFileSync(cachePath);
  const text = await decodeCsvBuffer(buf, encoding);
  return rowsToRecords(parseCSVText(text, delimiter), columnMap);
}

// XLSX / XLS パース。allSheets=true の場合は全シートを結合する（例: 京都市は区ごとにシート）。
export async function parseExcel(cachePath, { allSheets = false } = {}, columnMap = DEFAULT_COLUMN_MAP) {
  const xlsx = await import('xlsx');
  const wb = xlsx.read(fs.readFileSync(cachePath), { type: 'buffer' });
  const names = allSheets ? wb.SheetNames : [wb.SheetNames[0]];
  const out = [];
  for (const name of names) {
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
    out.push(...rowsToRecords(rows, columnMap));
  }
  return out;
}

// ソース1件のキャッシュファイルを、形式に応じてレコード配列に変換する。
export async function parseSource(source, cachePath, format, columnMap = DEFAULT_COLUMN_MAP) {
  if (format === 'xlsx' || format === 'xls') {
    return parseExcel(cachePath, { allSheets: !!source.allSheets }, columnMap);
  }
  // TSV（タブ区切り）は delimiter を切り替える
  const delimiter = format === 'tsv' || source.acquire.format === 'tsv' ? '\t' : ',';
  return parseCSV(cachePath, source.encoding, delimiter, columnMap);
}
