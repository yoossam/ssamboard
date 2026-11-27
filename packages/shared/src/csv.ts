/** 의존성 없는 CSV 파서(RFC 4180). 따옴표, 줄바꿈이 든 셀, BOM, 구분자 자동 판별을 처리한다. */

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = -1;
  for (const d of [',', '\t', ';']) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === d) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      cell += ch;
    }
    i++;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

/** 첫 행을 머리글로 보고 나머지를 본문으로 나눈다. 열 수가 모자란 행은 빈 칸으로 채운다. */
export function splitHeader(rows: string[][]): { header: string[]; body: string[][] } {
  if (rows.length === 0) return { header: [], body: [] };
  const width = Math.max(...rows.map((r) => r.length));
  const fill = (r: string[]) => (r.length === width ? r : [...r, ...Array(width - r.length).fill('')]);
  const header = fill(rows[0]).map((h, i) => String(h ?? '').trim() || `컬럼 ${i + 1}`);
  return { header, body: rows.slice(1).map(fill) };
}
