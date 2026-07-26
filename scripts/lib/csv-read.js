// CSV をストリーミングで1行ずつ読む（バリデーション用）。
//
// 結合CSV は 500MB 級になるためファイル全体をメモリに載せられない。また住所等の
// セルに改行が含まれ得るので、単純な行分割ではなく引用符の内外を追いながら
// パースする必要がある。ここでは同期読み込みのジェネレータとして実装する。

import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

/**
 * CSV ファイルを1行（セルの配列）ずつ yield する。
 * 先頭の UTF-8 BOM は取り除く。空行はスキップする。
 */
export function* readCsvRows(filePath, { chunkSize = 1 << 20 } = {}) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(chunkSize);
  const decoder = new StringDecoder('utf-8');

  let row = [];
  let cell = '';
  let inQuotes = false;
  let quoteJustClosed = false; // 引用符直後の "" をエスケープとして扱うため
  let atStart = true;

  /** 1文字を状態機械に流し、行が完成したら返す（未完成なら null）。 */
  function feed(ch) {
    if (inQuotes) {
      if (ch === '"') {
        // 閉じ引用符かエスケープ("")かは次の1文字で決まるため保留する。
        inQuotes = false;
        quoteJustClosed = true;
      } else {
        cell += ch;
      }
      return null;
    }

    if (quoteJustClosed) {
      quoteJustClosed = false;
      if (ch === '"') {
        // "" はエスケープされた引用符。引用の内側へ戻る。
        cell += '"';
        inQuotes = true;
        return null;
      }
      // それ以外は通常の文字として続けて処理する。
    }

    if (ch === '"') {
      inQuotes = true;
      return null;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      return null;
    }
    if (ch === '\n' || ch === '\r') {
      // \r\n の \n 側は、直前で行を確定済みなら空行として無視される。
      if (cell === '' && row.length === 0) return null;
      row.push(cell);
      cell = '';
      const done = row;
      row = [];
      return done;
    }
    cell += ch;
    return null;
  }

  try {
    for (;;) {
      const bytes = fs.readSync(fd, buf, 0, chunkSize, null);
      if (bytes === 0) break;
      let text = decoder.write(buf.subarray(0, bytes));
      if (atStart) {
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM 除去
        atStart = false;
      }
      for (const ch of text) {
        const done = feed(ch);
        if (done) yield done;
      }
    }
    // 末尾に改行が無い場合の最終行。
    const tail = decoder.end();
    for (const ch of tail) {
      const done = feed(ch);
      if (done) yield done;
    }
    if (cell !== '' || row.length > 0) {
      row.push(cell);
      yield row;
    }
  } finally {
    fs.closeSync(fd);
  }
}
