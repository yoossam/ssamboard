import type { Column, ColumnType, TableSchema } from './types';

export type CellValue = string | number | boolean | null;
export interface Normalized {
  ok: boolean;
  value: CellValue;
}

const EMPTY = new Set(['', '-', 'null', 'NULL', 'N/A', 'n/a', '없음']);
const TRUE_WORDS = new Set(['true', 'yes', 'y', '예', '네', 'o', '참', '완료']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '아니오', '아니요', 'x', '거짓', '미완료']);
const FAIL: Normalized = { ok: false, value: null };

/** "1,200원" → 1200. 만·억 같은 배수 단위는 뜻이 달라지므로 실패로 돌려 사용자에게 보인다. */
export function parseNumber(input: string): number | null {
  let t = input.replace(/\s+/g, '');
  let negative = false;
  if (/^\(.+\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  if (/^[-−△▲]/.test(t)) {
    negative = true;
    t = t.slice(1);
  } else if (t.startsWith('+')) {
    t = t.slice(1);
  }
  t = t.replace(/^[₩￦$€¥]/, '');
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?([^\d.,]{0,4})$/.exec(t);
  if (!m) return null;
  if (/[만억천조]/.test(m[3])) return null;
  const n = Number(m[1].replace(/,/g, '') + (m[2] ?? ''));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const pad = (n: number) => String(n).padStart(2, '0');

/** 날짜를 ISO 8601(YYYY-MM-DD)로 맞춘다. 월/일 순서가 모호한 형식은 받지 않는다. */
export function parseDate(input: string): string | null {
  const s = input.trim();
  let m = /^(\d{4})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})\.?(?:[T\s].*)?$/.exec(s) || /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s.*)?$/.exec(s);
  if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
}

/** 날짜·시간을 오프셋이 붙은 ISO 8601로 맞춘다. 시간대가 없으면 tzOffset(기본 +09:00)을 붙인다. */
export function parseDateTime(input: string, tzOffset = '+09:00'): string | null {
  const s = input.trim();
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    const [y, mo, d, h, mi, sec] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i] ?? 0));
    if (!validYmd(y, mo, d) || h > 23 || mi > 59 || sec > 59) return null;
    let zone = m[7] ?? tzOffset;
    if (zone !== 'Z' && !zone.includes(':')) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
    return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(sec)}${zone}`;
  }
  const dateOnly = parseDate(s);
  return dateOnly ? `${dateOnly}T00:00:00${tzOffset}` : null;
}

export function normalizeValue(raw: unknown, type: ColumnType, tzOffset = '+09:00'): Normalized {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return FAIL;
    raw = raw.toISOString();
  }
  if (typeof raw === 'number' && type === 'number') return Number.isFinite(raw) ? { ok: true, value: raw } : FAIL;
  if (typeof raw === 'boolean' && type === 'boolean') return { ok: true, value: raw };
  const s = String(raw).trim();
  if (EMPTY.has(s)) return { ok: true, value: null };
  switch (type) {
    case 'text':
    case 'select':
      return { ok: true, value: s };
    case 'number': {
      const n = parseNumber(s);
      return n === null ? FAIL : { ok: true, value: n };
    }
    case 'date': {
      const d = parseDate(s);
      return d ? { ok: true, value: d } : FAIL;
    }
    case 'datetime': {
      const d = parseDateTime(s, tzOffset);
      return d ? { ok: true, value: d } : FAIL;
    }
    case 'boolean': {
      const w = s.toLowerCase();
      if (TRUE_WORDS.has(w)) return { ok: true, value: true };
      if (FALSE_WORDS.has(w)) return { ok: true, value: false };
      return FAIL;
    }
    case 'url':
      return /^https?:\/\/\S+$/i.test(s) ? { ok: true, value: s } : FAIL;
  }
}

/** 표 형식 입력의 컬럼 타입을 서버가 먼저 추정한다. 실패가 20%를 넘는 타입은 고르지 않는다(LLM-12). */
export function inferColumnType(samples: unknown[]): ColumnType {
  const values = samples.map((v) => (v === null || v === undefined ? '' : String(v).trim())).filter((v) => !EMPTY.has(v));
  if (values.length === 0) return 'text';
  const rate = (type: ColumnType) => values.filter((v) => normalizeValue(v, type).ok).length / values.length;
  // 시각이 든 값이 하나라도 있으면 날짜보다 날짜·시간을 먼저 본다(날짜만 보면 시각이 버려진다).
  const hasTime = values.some((v) => /\d:\d{2}/.test(v));
  const order: ColumnType[] = hasTime ? ['boolean', 'number', 'datetime', 'url'] : ['boolean', 'number', 'date', 'url'];
  for (const type of order) {
    if (rate(type) >= 0.8) return type;
  }
  return 'text';
}

/**
 * 새 열 id. 처음 만드는 표(fresh)는 c_1, c_2… 로, 있는 표에 더하는 열은 겹치지 않는 무작위 꼬리를 붙인다 —
 * 지운 열의 번호를 새 열이 다시 쓰면, 그 번호를 기억하는 공유 링크·저장된 질의가 새 열(개인정보일 수 있음)을 옛 열로 착각한다(2026-11-28 코덱스 검토).
 */
export function nextColumnId(columns: Column[], fresh = false): string {
  let max = 0;
  for (const c of columns) {
    const m = /^c_(\d+)/.exec(c.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  if (fresh) return `c_${max + 1}`;
  const tail = Array.from({ length: 6 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)]).join('');
  return `c_${max + 1}_${tail}`;
}

/** 이름·타입 목록으로 고정 ID가 붙은 컬럼을 만든다. 이름이 비거나 겹치면 뒤에 번호를 붙인다. */
export function buildColumns(defs: { name: string; type: ColumnType }[], existing: Column[] = []): Column[] {
  const out: Column[] = [...existing];
  const fresh = existing.length === 0;
  const used = new Set(out.map((c) => c.name));
  const created: Column[] = [];
  defs.forEach((d, i) => {
    const base = (d.name ?? '').trim() || `컬럼 ${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base} ${n}`;
    used.add(name);
    const col: Column = { id: nextColumnId(out, fresh), name, type: d.type };
    out.push(col);
    created.push(col);
  });
  return created;
}

export interface NormalizedRow {
  values: Record<string, CellValue>;
  raw: Record<string, string> | null;
}
export interface NormalizeResult {
  rows: NormalizedRow[];
  /** 컬럼 ID → 변환에 실패한 셀 수 */
  failures: Record<string, number>;
}

/**
 * 원본 행(셀 배열)을 컬럼 타입에 맞춰 저장 형식으로 바꾼다.
 * 변환에 실패한 셀은 값을 비우고 원문을 raw에 남긴다(LLM-12).
 * sourceIndex[i]는 columns[i]가 원본의 몇 번째 열인지를 뜻한다(기본: 같은 순서).
 */
export function normalizeRows(columns: Column[], rawRows: unknown[][], sourceIndex?: number[], tzOffset = '+09:00'): NormalizeResult {
  const failures: Record<string, number> = {};
  const rows = rawRows.map((cells) => {
    const values: Record<string, CellValue> = {};
    let raw: Record<string, string> | null = null;
    columns.forEach((col, i) => {
      const cell = cells[sourceIndex ? sourceIndex[i] : i];
      const n = normalizeValue(cell, col.type, tzOffset);
      values[col.id] = n.value;
      if (!n.ok) {
        failures[col.id] = (failures[col.id] ?? 0) + 1;
        (raw ??= {})[col.id] = String(cell);
      }
    });
    return { values, raw };
  });
  return { rows, failures };
}

export function findColumn(schema: TableSchema, id: string): Column | undefined {
  return schema.columns.find((c) => c.id === id);
}
