/*
 * 엑셀(.xlsx) 고치기(2026-11-28 선생님 "엑셀과 한글 hwpx 포맷만 그렇게 하면 AI 로 업무 처리가 가능할 것 같아").
 * AI 에게는 칸 주소가 붙은 표로 보여 주고(describeXlsx), AI 가 낸 고치기 목록(XlsxEdit[])을 검사한 뒤 새 파일로 만든다(applyXlsxEdits).
 * 원본은 건드리지 않는다. ExcelJS 가 다루지 못하는 차트·피벗 표·매크로는 고친 파일에서 빠질 수 있다(안내에 적음).
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { maskPii } from '@jarvis/shared';
import { assertZipSmall } from './zip-guard';

export type XlsxEdit =
  | {
      op: 'set';
      sheet?: string;
      cell: string;
      value: string | number | boolean | null;
    }
  | { op: 'formula'; sheet?: string; cell: string; formula: string }
  | {
      op: 'append_row';
      sheet?: string;
      values: (string | number | boolean | null)[];
    }
  | { op: 'highlight'; sheet?: string; range: string; color: XlsxColor }
  | { op: 'bold'; sheet?: string; range: string };

export const XLSX_COLORS = ['yellow', 'red', 'green', 'blue', 'orange', 'gray', 'none'] as const;
export type XlsxColor = (typeof XLSX_COLORS)[number];
const COLOR_LABEL: Record<XlsxColor, string> = {
  yellow: '노랑',
  red: '빨강',
  green: '초록',
  blue: '파랑',
  orange: '주황',
  gray: '회색',
  none: '없음',
};
const ARGB: Record<Exclude<XlsxColor, 'none'>, string> = {
  yellow: 'FFFFF2CC',
  red: 'FFF8CBAD',
  green: 'FFD9EAD3',
  blue: 'FFCFE2F3',
  orange: 'FFFCE5CD',
  gray: 'FFEFEFEF',
};

export const XLSX_MAX_EDITS = 500;
const CELL_RE = /^[A-Z]{1,3}[1-9]\d{0,6}$/;
const RANGE_RE = /^[A-Z]{1,3}[1-9]\d{0,6}(:[A-Z]{1,3}[1-9]\d{0,6})?$/;
/** 바깥으로 자료를 보내거나 바깥 것을 부를 수 있는 함수는 막는다(첨부 파일 속 글에 속은 AI 가 넣을 수 있다) */
// '[' 는 다른 파일 참조, '|' 는 DDE(=cmd|'…'!A1) 꼴
// INDIRECT 는 CHAR(91) 로 '[' 를 만들어 다른 파일을 가리킬 수 있고, INFO·REGISTER.ID 는 컴퓨터 정보를 읽는다(제미나이 검토)
const RISKY_FORMULA = /\b(WEBSERVICE|FILTERXML|HYPERLINK|IMPORTXML|IMPORTDATA|IMPORTHTML|IMPORTRANGE|IMAGE|CALL|REGISTER(?:\.ID)?|RTD|DDE|EXEC|INDIRECT|INFO)\s*\(|[[|]/i;

/** 원래 파일에 이미 든 수식 중 저절로 바깥에 닿는 것(HYPERLINK 는 눌러야 열리므로 뺀다) — 고친 파일은 열 때 다시 계산되므로 거절한다(코덱스 검토) */
const RISKY_EXISTING = /\b(WEBSERVICE|FILTERXML|IMPORTXML|IMPORTDATA|IMPORTHTML|IMPORTRANGE|IMAGE|CALL|REGISTER|RTD|DDE|EXEC)\s*\(|[[|]/i;
/** 한 번에 건드릴 수 있는 칸 수(범위 색칠을 되풀이해 수천만 칸을 만들지 않게) */
const MAX_TOTAL_CELLS = 50_000;
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

const colName = (n: number): string => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, any>;
    if ('formula' in o || 'sharedFormula' in o) return `=${o.formula ?? o.sharedFormula}${o.result !== undefined ? ` (→ ${cellText(o.result)})` : ''}`;
    if ('richText' in o) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if ('text' in o) return String(o.text);
    if ('error' in o) return String(o.error);
  }
  return String(v);
}

async function load(buffer: Buffer | Uint8Array): Promise<ExcelJS.Workbook> {
  // 이 모듈만 따로 불려도 압축 폭탄을 막게 실제로 풀리는 크기를 센다(제미나이 검토)
  await assertZipSmall(await JSZip.loadAsync(buffer));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  return wb;
}

/** AI 에게 보여 줄 표: 시트마다 열 글자 머리줄과 행 번호, 칸 값(앞 200행 · 30열, 수식은 =… 로) */
export async function describeXlsx(buffer: Buffer | Uint8Array, maxChars = 30_000): Promise<string> {
  const wb = await load(buffer);
  const out: string[] = [];
  for (const sheet of wb.worksheets.slice(0, 8)) {
    const cols = Math.min(30, Math.max(1, sheet.actualColumnCount || sheet.columnCount || 1));
    const rows = Math.min(200, sheet.rowCount);
    out.push(`[시트 "${sheet.name}" · ${sheet.rowCount}행 × ${sheet.columnCount}열${sheet.rowCount > rows ? ` · 앞 ${rows}행만 보임` : ''}]`);
    out.push(['행', ...Array.from({ length: cols }, (_, i) => colName(i + 1))].join('\t'));
    for (let r = 1; r <= rows; r++) {
      const row = sheet.getRow(r);
      const vals = Array.from({ length: cols }, (_, i) =>
        cellText(row.getCell(i + 1).value)
          .replace(/[\t\n]/g, ' ')
          .slice(0, 80),
      );
      if (vals.some(Boolean)) out.push([String(r), ...vals].join('\t'));
    }
  }
  const text = maskPii(out.join('\n'));
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(길어서 여기까지만 보였습니다)` : text;
}

export interface EditReport {
  /** 화면에 보여 줄 바뀌는 곳(앞 몇 개) */
  lines: string[];
  count: number;
}

function sheetOf(wb: ExcelJS.Workbook, name?: string): ExcelJS.Worksheet {
  const s = name ? wb.getWorksheet(name) : wb.worksheets[0];
  if (!s) throw new Error(`없는 시트입니다: ${name ?? '(첫 시트)'}`);
  return s;
}

function* cellsOf(sheet: ExcelJS.Worksheet, range: string): Generator<ExcelJS.Cell> {
  const [a, b = a] = range.split(':');
  const tl = sheet.getCell(a);
  const br = sheet.getCell(b);
  const r1 = Math.min(+tl.row, +br.row);
  const r2 = Math.max(+tl.row, +br.row);
  const c1 = Math.min(+tl.col, +br.col);
  const c2 = Math.max(+tl.col, +br.col);
  if ((r2 - r1 + 1) * (c2 - c1 + 1) > 20_000) throw new Error(`범위가 너무 큽니다: ${range}`);
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) yield sheet.getCell(r, c);
}

/** 고치기 목록을 검사하고 적용한다. dry 면 파일은 만들지 않고 바뀌는 곳만 돌려준다. 틀리면 첫 문제로 Error. */
export async function applyXlsxEdits(buffer: Buffer | Uint8Array, edits: unknown, dry = false): Promise<{ report: EditReport; file?: Buffer }> {
  if (!Array.isArray(edits) || edits.length === 0) throw new Error('고칠 내용(edits)이 비었습니다.');
  if (edits.length > XLSX_MAX_EDITS) throw new Error(`한 번에 ${XLSX_MAX_EDITS}개까지 고칠 수 있습니다.`);
  const wb = await load(buffer);
  // 원래 파일의 수식부터 본다
  for (const ws of wb.worksheets)
    ws.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (c) => {
        const v = c.value as any;
        const f = v && typeof v === 'object' ? (v.formula ?? v.sharedFormula) : undefined;
        if (typeof f === 'string' && RISKY_EXISTING.test(f)) throw new Error(`이 파일의 ${ws.name}!${c.address} 에 바깥 주소·다른 파일을 부르는 수식이 있어 고치지 않았습니다.`);
      }),
    );
  const lines: string[] = [];
  const note = (s: string) => lines.length < 1000 && lines.push(s);
  let touched = 0;
  const budget = (n: number) => {
    touched += n;
    if (touched > MAX_TOTAL_CELLS) throw new Error(`한 번에 ${MAX_TOTAL_CELLS.toLocaleString()}칸까지 고칠 수 있습니다.`);
  };
  for (const raw of edits as XlsxEdit[]) {
    const e = (raw ?? {}) as XlsxEdit;
    const sheet = sheetOf(wb, typeof e.sheet === 'string' && e.sheet ? e.sheet : undefined);
    const where = (cell: string) => `${wb.worksheets.length > 1 ? `${sheet.name}!` : ''}${cell}`;
    switch (e.op) {
      case 'set': {
        if (!CELL_RE.test(String(e.cell))) throw new Error(`칸 주소가 잘못됐습니다: ${e.cell}`);
        const v = e.value;
        if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) throw new Error(`${e.cell}: 값은 글자·숫자·참거짓·빈칸(null)만 됩니다.`);
        const c = sheet.getCell(e.cell);
        const before = cellText(c.value);
        budget(1);
        // '=' 로 시작하는 글자는 수식으로 바뀌지 않게 글자 그대로 둔다(수식은 formula 로만)
        c.value = typeof v === 'string' ? v.replace(BAD_CHARS, '').slice(0, 32_000) : (v as any);
        note(`${where(e.cell)}: ${before.slice(0, 200) || '(빈칸)'} → ${cellText(c.value).slice(0, 200) || '(빈칸)'}`);
        break;
      }
      case 'formula': {
        if (!CELL_RE.test(String(e.cell))) throw new Error(`칸 주소가 잘못됐습니다: ${e.cell}`);
        const f = String(e.formula ?? '')
          .replace(/^\s*=/, '')
          .trim();
        if (!f || f.length > 2000) throw new Error(`${e.cell}: 수식이 비었거나 너무 깁니다.`);
        if (RISKY_FORMULA.test(f)) throw new Error(`${e.cell}: 바깥 주소·다른 파일을 부르는 수식은 넣을 수 없습니다.`);
        const c = sheet.getCell(e.cell);
        const before = cellText(c.value);
        budget(1);
        c.value = { formula: f } as any;
        note(`${where(e.cell)}: ${before || '(빈칸)'} → =${f}`);
        break;
      }
      case 'append_row': {
        if (!Array.isArray(e.values) || e.values.length === 0 || e.values.length > 200) throw new Error('append_row 의 values 가 잘못됐습니다.');
        // 글자·숫자·참거짓·빈칸만(물건·undefined 가 '[object Object]' 로 들어가지 않게 — 제미나이 검토)
        if (e.values.some((v) => v !== null && !['string', 'number', 'boolean'].includes(typeof v))) throw new Error('append_row 의 값은 글자·숫자·참거짓·빈칸(null)만 됩니다.');
        const vals = e.values.map((v) => (typeof v === 'string' ? v.replace(BAD_CHARS, '').slice(0, 32_000) : v));
        budget(vals.length);
        const row = sheet.addRow(vals);
        note(
          `${sheet.name} ${row.number}행 더함: ${vals
            .map((v) => (v === null ? '' : String(v)))
            .join(' | ')
            .slice(0, 400)}`,
        );
        break;
      }
      case 'highlight': {
        if (!RANGE_RE.test(String(e.range))) throw new Error(`범위가 잘못됐습니다: ${e.range}`);
        if (!(XLSX_COLORS as readonly string[]).includes(e.color)) throw new Error(`색은 ${XLSX_COLORS.join(', ')} 중 하나입니다.`);
        const cells = [...cellsOf(sheet, e.range)];
        budget(cells.length);
        for (const c of cells)
          c.fill =
            e.color === 'none'
              ? ({ type: 'pattern', pattern: 'none' } as any)
              : {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: ARGB[e.color] },
                };
        note(`${where(e.range)}: 바탕 ${e.color === 'none' ? '지움' : COLOR_LABEL[e.color]}`);
        break;
      }
      case 'bold': {
        if (!RANGE_RE.test(String(e.range))) throw new Error(`범위가 잘못됐습니다: ${e.range}`);
        const cells = [...cellsOf(sheet, e.range)];
        budget(cells.length);
        for (const c of cells) c.font = { ...(c.font ?? {}), bold: true };
        note(`${where(e.range)}: 굵게`);
        break;
      }
      default:
        throw new Error(`알 수 없는 고치기입니다: ${(e as { op?: string }).op}. set·formula·append_row·highlight·bold 중 하나입니다.`);
    }
  }
  const report = { lines: lines.map((l) => maskPii(l)), count: edits.length };
  if (dry) return { report };
  // 엑셀에서 열 때 수식을 다시 계산하게 한다(ExcelJS 는 계산하지 않는다)
  (wb as any).calcProperties = {
    ...((wb as any).calcProperties ?? {}),
    fullCalcOnLoad: true,
  };
  const file = Buffer.from(await wb.xlsx.writeBuffer());
  return { report, file };
}
