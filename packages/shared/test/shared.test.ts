import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  BLOCK_TYPES,
  DEFAULT_BLOCK_SIZE,
  DEFAULT_MEMO_COLOR,
  GRID_COLS,
  GRID_MAX_H,
  MEMO_COLORS,
  MEMO_COLOR_LABEL,
  MIN_BLOCK_SIZE,
  VIEW_EVENT_DAYS_MAX,
  buildColumns,
  checkViewData,
  inferColumnType,
  maskPii,
  memoColor,
  mobileOrder,
  nextColumnId,
  normalizeRows,
  normalizeValue,
  parseCsv,
  parseDate,
  parseDateTime,
  parseNumber,
  placeBlock,
  readViewData,
  splitHeader,
  validateQuery,
  type TableSchema,
} from '../src';

describe('숫자·날짜 변환 (LLM-11)', () => {
  it('쉼표·통화 기호·단위를 뗀다', () => {
    assert.equal(parseNumber('1,200원'), 1200);
    assert.equal(parseNumber('₩ 3,100,000'), 3100000);
    assert.equal(parseNumber('-12.5%'), -12.5);
    assert.equal(parseNumber('(1,000)'), -1000);
    assert.equal(parseNumber('△500'), -500);
    assert.equal(parseNumber('42'), 42);
  });
  it('뜻이 달라지는 값은 숫자로 바꾸지 않는다', () => {
    assert.equal(parseNumber('1,200만원'), null);
    assert.equal(parseNumber('12,34'), null);
    assert.equal(parseNumber('가나다'), null);
    assert.equal(parseNumber('010-1234-5678'), null);
  });
  it('날짜를 ISO 8601로 맞춘다', () => {
    assert.equal(parseDate('2026.11.3'), '2026-11-03');
    assert.equal(parseDate('2026/11/03'), '2026-11-03');
    assert.equal(parseDate('2026년 11월 3일'), '2026-11-03');
    assert.equal(parseDate('20261103'), '2026-11-03');
    assert.equal(parseDate('2026-11-03T09:00:00+09:00'), '2026-11-03');
    assert.equal(parseDate('2026-02-30'), null);
    assert.equal(parseDate('11/03/2026'), null);
  });
  it('날짜·시간에 시간대를 붙인다', () => {
    assert.equal(parseDateTime('2026-11-26 15:00'), '2026-11-26T15:00:00+09:00');
    assert.equal(parseDateTime('2026-11-26T15:00:00Z'), '2026-11-26T15:00:00Z');
    assert.equal(parseDateTime('2026-11-26T15:00:00+0900'), '2026-11-26T15:00:00+09:00');
    assert.equal(parseDateTime('2026-11-26'), '2026-11-26T00:00:00+09:00');
    assert.equal(parseDateTime('2026-11-26 25:00'), null);
  });
  it('타입별로 값을 정규화한다', () => {
    assert.deepEqual(normalizeValue(' 예 ', 'boolean'), { ok: true, value: true });
    assert.deepEqual(normalizeValue('X', 'boolean'), { ok: true, value: false });
    assert.deepEqual(normalizeValue('', 'number'), { ok: true, value: null });
    assert.deepEqual(normalizeValue('abc', 'number'), { ok: false, value: null });
    assert.deepEqual(normalizeValue('https://example.com/a', 'url'), { ok: true, value: 'https://example.com/a' });
    assert.deepEqual(normalizeValue('example.com', 'url'), { ok: false, value: null });
    assert.deepEqual(normalizeValue(1200, 'number'), { ok: true, value: 1200 });
  });
});

describe('컬럼 타입 추정과 행 변환 (LLM-3·12)', () => {
  it('표본으로 타입을 추정한다', () => {
    assert.equal(inferColumnType(['1,200원', '850,000원', '', '2,400,000원']), 'number');
    assert.equal(inferColumnType(['2026-11-03', '2026.11.10', '2026/11/12']), 'date');
    assert.equal(inferColumnType(['2026-11-03 09:00', '2026-11-10 13:30']), 'datetime');
    assert.equal(inferColumnType(['예', '아니오', '예']), 'boolean');
    assert.equal(inferColumnType(['가나상사', '다라물산']), 'text');
    assert.equal(inferColumnType(['', null, undefined]), 'text');
  });
  it('실패가 20%를 넘으면 그 타입을 고르지 않는다', () => {
    assert.equal(inferColumnType(['1', '2', '3', '4', '미정']), 'number');
    assert.equal(inferColumnType(['1', '2', '미정', '확인 중']), 'text');
  });
  it('컬럼 ID는 겹치지 않고 이어서 붙는다', () => {
    const first = buildColumns([
      { name: '거래처', type: 'text' },
      { name: '금액', type: 'number' },
      { name: '금액', type: 'number' },
      { name: '', type: 'text' },
    ]);
    assert.deepEqual(first.map((c) => c.id), ['c_1', 'c_2', 'c_3', 'c_4']);
    assert.deepEqual(first.map((c) => c.name), ['거래처', '금액', '금액 2', '컬럼 4']);
    assert.equal(nextColumnId(first), 'c_5');
    const added = buildColumns([{ name: '금액', type: 'number' }], first);
    assert.deepEqual(added, [{ id: 'c_5', name: '금액 3', type: 'number' }]);
  });
  it('변환에 실패한 셀은 값을 비우고 원문을 남긴다', () => {
    const cols = buildColumns([
      { name: '거래처', type: 'text' },
      { name: '금액', type: 'number' },
    ]);
    const r = normalizeRows(cols, [
      ['가나상사', '1,200,000원'],
      ['다라물산', '협의 중'],
    ]);
    assert.deepEqual(r.rows[0], { values: { c_1: '가나상사', c_2: 1200000 }, raw: null });
    assert.deepEqual(r.rows[1], { values: { c_1: '다라물산', c_2: null }, raw: { c_2: '협의 중' } });
    assert.deepEqual(r.failures, { c_2: 1 });
  });
  it('원본 열 순서를 바꿔 매핑할 수 있다', () => {
    const cols = buildColumns([{ name: '금액', type: 'number' }]);
    const r = normalizeRows(cols, [['가나상사', '500']], [1]);
    assert.deepEqual(r.rows[0].values, { c_1: 500 });
  });
});

describe('CSV 파서', () => {
  it('따옴표·쉼표·줄바꿈이 든 셀을 읽는다', () => {
    const rows = parseCsv('﻿이름,메모,금액\r\n"가나, 상사","첫 줄\n둘째 ""줄""","1,200"\r\n다라물산,,850\r\n');
    assert.deepEqual(rows, [
      ['이름', '메모', '금액'],
      ['가나, 상사', '첫 줄\n둘째 "줄"', '1,200'],
      ['다라물산', '', '850'],
    ]);
  });
  it('탭·세미콜론 구분자를 알아낸다', () => {
    assert.deepEqual(parseCsv('a\tb\n1\t2'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
    assert.deepEqual(parseCsv('a;b\n1;2'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('머리글을 나누고 모자란 열을 채운다', () => {
    const { header, body } = splitHeader([['거래처', '', '금액'], ['가나상사', '미수']]);
    assert.deepEqual(header, ['거래처', '컬럼 2', '금액']);
    assert.deepEqual(body, [['가나상사', '미수', '']]);
  });
});

describe('조회·집계 규격 검증 (QRY-1·2·4)', () => {
  const schema: TableSchema = {
    columns: [
      { id: 'c_1', name: '거래처', type: 'text' },
      { id: 'c_2', name: '상태', type: 'select' },
      { id: 'c_3', name: '금액', type: 'number' },
      { id: 'c_4', name: '날짜', type: 'date' },
    ],
  };
  it('PRD 예시 규격을 통과시키고 값을 정규화한다', () => {
    const r = validateQuery(
      {
        table_id: 't_123',
        filter: [
          { col_id: 'c_2', op: 'eq', value: '미수' },
          { col_id: 'c_3', op: 'gte', value: '1,000,000원' },
        ],
        group_by: [{ col_id: 'c_4', bucket: 'month' }],
        agg: [{ col_id: 'c_3', fn: 'sum' }],
        sort: [{ col_id: 'c_4', dir: 'asc' }],
        limit: 100,
      },
      schema,
    );
    assert.ok(r.ok);
    assert.deepEqual(r.spec.filter, [
      { col_id: 'c_2', op: 'eq', value: '미수' },
      { col_id: 'c_3', op: 'gte', value: 1000000 },
    ]);
    assert.deepEqual(r.spec.group_by, [{ col_id: 'c_4', bucket: 'month' }]);
  });
  it('없는 컬럼과 타입에 맞지 않는 연산을 막는다', () => {
    const bad = (q: unknown) => {
      const r = validateQuery(q, schema);
      assert.equal(r.ok, false);
    };
    bad({ filter: [{ col_id: 'c_9', op: 'eq', value: 1 }] });
    bad({ filter: [{ col_id: 'c_1', op: 'gt', value: 'a' }] });
    bad({ filter: [{ col_id: 'c_3', op: 'contains', value: '1' }] });
    bad({ filter: [{ col_id: 'c_3', op: 'eq', value: '많음' }] });
    bad({ filter: [{ col_id: 'c_3', op: 'between', value: [1] }] });
    bad({ filter: [{ col_id: 'c_1', op: 'like', value: 'a' }] });
    bad({ group_by: [{ col_id: 'c_1', bucket: 'month' }] });
    bad({ agg: [{ col_id: 'c_1', fn: 'sum' }] });
    bad({ group_by: [{ col_id: 'c_2' }], sort: [{ col_id: 'c_3', dir: 'asc' }] });
    bad({ agg: [{ fn: 'count' }], sort: [{ agg: 3, dir: 'desc' }] });
    bad({ limit: 0 });
    bad('select * from data_rows');
  });
  it('묶기만 하면 건수를 세고, limit에 상한을 둔다', () => {
    const r = validateQuery({ group_by: ['c_2'], limit: 50000 }, schema);
    assert.ok(r.ok);
    assert.deepEqual(r.spec.agg, [{ fn: 'count' }]);
    assert.equal(r.spec.limit, 1000);
  });
});

describe('개인정보 가리기', () => {
  it('주민등록번호와 카드번호 모양을 가린다', () => {
    assert.equal(maskPii('주민번호 900101-1234567 입니다'), '주민번호 900101-******* 입니다');
    assert.equal(maskPii('카드 1234-5678-9012-3456'), '카드 ****-****-****-3456');
    assert.equal(maskPii('금액 1,200,000원, 전화 010-1234-5678'), '금액 1,200,000원, 전화 010-1234-5678');
  });
});

describe('블록 배치', () => {
  const board = [
    { x: 0, y: 0, w: 4, h: 4 },
    { x: 4, y: 0, w: 4, h: 4 },
  ];
  it('처음 비는 칸에 놓는다', () => {
    assert.equal(GRID_COLS, 24);
    assert.deepEqual(placeBlock(board, { w: 4, h: 4 }), { x: 8, y: 0, w: 4, h: 4 });
    assert.deepEqual(placeBlock(board, { w: 16, h: 4 }), { x: 8, y: 0, w: 16, h: 4 });
    assert.deepEqual(placeBlock(board, { w: 18, h: 4 }), { x: 0, y: 4, w: 18, h: 4 });
    assert.deepEqual(placeBlock([], { w: 3, h: 4 }), { x: 0, y: 0, w: 3, h: 4 });
  });
  it('힌트가 있으면 그 모서리에 놓는다', () => {
    assert.deepEqual(placeBlock(board, { w: 3, h: 4 }, 'top-right'), { x: 21, y: 0, w: 3, h: 4 });
    assert.deepEqual(placeBlock(board, { w: 3, h: 4 }, 'bottom-left'), { x: 0, y: 4, w: 3, h: 4 });
  });
  it('기본 크기와 최소 크기는 격자 안에 들고, 최소가 기본보다 크지 않다', () => {
    for (const type of BLOCK_TYPES) {
      const size = DEFAULT_BLOCK_SIZE[type];
      const min = MIN_BLOCK_SIZE[type];
      assert.ok(size.w <= GRID_COLS && size.h <= GRID_MAX_H, type);
      assert.ok(min.w >= 1 && min.h >= 1 && min.w <= size.w && min.h <= size.h, type);
    }
  });
  it('메모 색은 모르는 값이면 기본색으로 본다', () => {
    assert.equal(memoColor('pink'), 'pink');
    assert.equal(memoColor(undefined), DEFAULT_MEMO_COLOR);
    assert.equal(memoColor('#ff0000'), DEFAULT_MEMO_COLOR);
    assert.deepEqual(Object.keys(MEMO_COLOR_LABEL), [...MEMO_COLORS]);
  });
  it('메모 색 이름마다 화면에 색 값이 있다', () => {
    const css = readFileSync(join(__dirname, '../../../apps/web/src/styles.css'), 'utf8');
    const inCss = [...css.matchAll(/\[data-memo='([a-z]+)'\]/g)].map((m) => m[1]);
    assert.deepEqual(inCss, [...MEMO_COLORS]);
  });
  it('휴대폰 순서는 저장한 순서가 없으면 데스크톱 배치를 따른다', () => {
    const blocks = [
      { id: 'b', layout_lg: { x: 4, y: 0, w: 4, h: 4 }, layout_sm: null },
      { id: 'c', layout_lg: { x: 0, y: 4, w: 4, h: 4 }, layout_sm: null },
      { id: 'a', layout_lg: { x: 0, y: 0, w: 4, h: 4 }, layout_sm: null },
    ];
    assert.deepEqual(mobileOrder(blocks).map((b) => b.id), ['a', 'b', 'c']);
    const custom = blocks.map((b, i) => ({ ...b, layout_sm: { order: 2 - i } }));
    assert.deepEqual(mobileOrder(custom).map((b) => b.id), ['a', 'c', 'b']);
  });
});

describe('AI 화면 블록의 자료 정의', () => {
  const schema: TableSchema = { columns: [{ id: 'c_1', name: '항목', type: 'text' }, { id: 'c_2', name: '금액', type: 'number' }] };
  const TABLE = '11111111-2222-4333-8444-555555555555';
  const lookup = (id: string) => (id === TABLE ? schema : null);

  it('없으면 자료 없음, 할 일·일정은 그대로 받는다', () => {
    assert.deepEqual(checkViewData(undefined, lookup), { ok: true, data: { kind: 'none' } });
    assert.deepEqual(checkViewData({ kind: 'tasks' }, lookup), { ok: true, data: { kind: 'tasks' } });
    assert.deepEqual(checkViewData({ kind: 'events' }, lookup), { ok: true, data: { kind: 'events', days_before: 0, days_after: 30 } });
    assert.deepEqual(checkViewData({ kind: 'events', days_before: -3, days_after: 9999 }, lookup), { ok: true, data: { kind: 'events', days_before: 0, days_after: VIEW_EVENT_DAYS_MAX } });
  });
  it('표 자료는 표가 있어야 하고 query를 검증한다', () => {
    const good = checkViewData({ kind: 'table', table_id: TABLE, query: { group_by: [{ col_id: 'c_1' }], agg: [{ col_id: 'c_2', fn: 'sum' }] } }, lookup);
    assert.ok(good.ok && good.data.kind === 'table' && good.data.table_id === TABLE);
    assert.equal(checkViewData({ kind: 'table', table_id: 'nope' }, lookup).ok, false);
    assert.equal(checkViewData({ kind: 'table' }, lookup).ok, false);
    assert.equal(checkViewData({ kind: 'table', table_id: TABLE, query: { agg: [{ col_id: 'c_9', fn: 'sum' }] } }, lookup).ok, false);
    assert.equal(checkViewData({ kind: 'web', url: 'https://example.test' }, lookup).ok, false);
    assert.equal(checkViewData('tasks', lookup).ok, false);
  });
  it('저장된 값이 이상하면 자료 없음으로 읽는다', () => {
    assert.deepEqual(readViewData(null), { kind: 'none' });
    assert.deepEqual(readViewData({ kind: 'table', table_id: 5 }), { kind: 'none' });
    assert.deepEqual(readViewData({ kind: 'events', days_before: 7, days_after: 14 }), { kind: 'events', days_before: 7, days_after: 14 });
    assert.equal(readViewData({ kind: 'table', table_id: TABLE, query: { limit: 10 } }).kind, 'table');
  });
});
