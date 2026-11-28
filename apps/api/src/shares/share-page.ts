/*
 * 공유 페이지 만들기 — 블록 하나의 지금 자료를 모아(ShareView) 스크립트 없는 HTML 한 장으로 그린다.
 * 서버 트랙은 /s/<열쇠> 로 이 HTML 을 내보내고, 구글 드라이브 트랙은 이 HTML 을 구글 문서로 바꿔 올린다.
 *
 * 지키는 것:
 *  - 모든 글은 escape 한다(사용자·AI·시트에서 온 글이 HTML 로 해석되지 않게). 스크립트·외부 그림·외부 글꼴 없음.
 *  - 주민등록번호·카드번호 모양은 가린다(maskPii). 표는 고른 칸을 빼고, 줄은 MAX_ROWS 까지만.
 *  - 알림·AI 화면 블록은 공유하지 않는다(SHAREABLE_BLOCKS).
 */
import { eventDaysOf, maskPii, SHAREABLE_BLOCKS, taskFilterOf, type BlockDto, type Column, type ShareOptions } from '@jarvis/shared';
import { bad } from '../common/http';
import type { ItemsService } from '../items/items.service';
import type { TablesService } from '../tables/tables.service';

export const SHARE_MAX_ROWS = 500;
const MAX_TEXT = 20_000;

export interface ShareView {
  title: string;
  kind: 'list' | 'table' | 'text';
  /** 목록: 할 일·일정 */
  items?: { title: string; when: string; done?: boolean }[];
  /** 표 */
  columns?: string[];
  rows?: string[][];
  total?: number;
  /** 글: 메모·AI 결과 */
  text?: string;
  /** 비었을 때 보여 줄 말 */
  empty: string;
  updated_at: string;
  /** 이번에 보인 칸(표 열 id · 결과 열 이름) — 만들 때 options.show_columns 로 저장한다 */
  shown?: string[];
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clean = (s: unknown): string => maskPii(typeof s === 'string' ? s : s === null || s === undefined ? '' : String(s));

/** 그 시간대의 오늘 0시(ms) */
function startOfDay(timeZone: string): number {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const off = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).format(now).split('GMT')[1] || '+00:00';
  return new Date(`${ymd}T00:00:00${off === '' ? 'Z' : off}`).getTime();
}

function fmtDate(iso: string | null | undefined, timeZone: string, withTime: boolean): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return clean(iso);
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(d);
}

function cell(v: unknown, c: Pick<Column, 'type'>, timeZone: string): string {
  if (v === null || v === undefined || v === '') return '';
  // 어떤 자료형이든 먼저 원래 글자로 가려 본다 — 숫자 칸에 든 카드번호 같은 것(코덱스 검토)
  const raw = String(v);
  if (maskPii(raw) !== raw) return maskPii(raw);
  switch (c.type) {
    case 'boolean':
      return v === true || v === 'true' ? '예' : v === false || v === 'false' ? '아니오' : clean(v);
    case 'number':
      return typeof v === 'number' ? v.toLocaleString('ko-KR') : clean(v);
    case 'datetime':
      return fmtDate(String(v), timeZone, true);
    default:
      return clean(v);
  }
}

/**
 * 보일 칸 고르기: 저장된 show_columns 가 있으면 그것만(뒤에 더한 칸은 안 보임), 없으면(처음 만들 때) hide_columns 를 뺀 전부.
 */
function pickColumns<T>(all: T[], key: (c: T) => string, options: ShareOptions): T[] {
  if (Array.isArray(options.show_columns)) {
    const show = new Set(options.show_columns);
    return all.filter((c) => show.has(key(c)));
  }
  const hidden = new Set(options.hide_columns ?? []);
  return all.filter((c) => !hidden.has(key(c)));
}

/** 블록 하나의 지금 자료 — 그 사용자 것만 읽는다(서비스들이 user_id 로 거른다). */
export async function buildShareView(deps: { items: ItemsService; tables: TablesService }, userId: string, timeZone: string, block: BlockDto, options: ShareOptions): Promise<ShareView> {
  if (!SHAREABLE_BLOCKS.includes(block.type)) bad('이 블록은 공유할 수 없습니다(할 일·일정·표·메모·AI 결과만 됩니다).');
  const title = clean(block.title).slice(0, 120) || '쌤보드';
  const updated_at = new Date().toISOString();
  switch (block.type) {
    case 'tasks': {
      // 블록에 보이는 만큼만 — 블록의 '보여 줄 할 일' 설정을 그대로 따른다(코덱스 검토)
      const f = taskFilterOf(block.config);
      const all = await deps.items.listTasks(userId, f === 'all' ? undefined : 'open');
      const limit = startOfDay(timeZone) + (f === 'today' ? 1 : 7) * 86_400_000;
      const tasks = (f === 'today' || f === 'week' ? all.filter((t) => t.due_at && new Date(t.due_at).getTime() < limit) : all).slice(0, SHARE_MAX_ROWS);
      return {
        title,
        kind: 'list',
        items: tasks.map((t) => ({
          title: clean(t.title),
          when: t.due_at ? `${fmtDate(t.due_at, timeZone, false)}까지` : '',
        })),
        empty: '할 일이 없습니다',
        updated_at,
      };
    }
    case 'events': {
      // 블록의 '보여 줄 기간'(오늘부터 며칠)만(코덱스 검토)
      const from = new Date(startOfDay(timeZone)).toISOString();
      const to = new Date(startOfDay(timeZone) + eventDaysOf(block.config) * 86_400_000).toISOString();
      const events = (await deps.items.listEvents(userId, timeZone, from, to)).slice(0, SHARE_MAX_ROWS);
      return {
        title,
        kind: 'list',
        items: events.map((e) => ({
          title: clean(e.title),
          when: fmtDate(e.start_at, timeZone, true),
        })),
        empty: '다가오는 일정이 없습니다',
        updated_at,
      };
    }
    case 'table': {
      if (!block.source_table_id) bad('표 블록에 원본 표가 없습니다.');
      const table = await deps.tables.require(userId, block.source_table_id!);
      const cols = pickColumns(table.schema.columns, (c) => c.id, options);
      if (cols.length === 0) bad('보여 줄 칸이 없습니다. 숨긴 칸을 줄여 주세요.');
      const page = await deps.tables.rows(userId, table.id, {
        page: 1,
        size: SHARE_MAX_ROWS,
      });
      return {
        title,
        kind: 'table',
        columns: cols.map((c) => clean(c.name)),
        rows: page.rows.map((r) => cols.map((c) => cell(r.values[c.id], c, timeZone))),
        total: page.total,
        empty: '줄이 없습니다',
        updated_at,
        shown: cols.map((c) => c.id),
      };
    }
    case 'ai_result': {
      const text = clean(block.config.text).slice(0, MAX_TEXT);
      // 질의가 붙은 AI 결과는 그 결과표도 함께(숨길 칸은 표 블록과 같은 방식은 아니고 결과 열 이름으로 고른다)
      if (block.config.query && block.source_table_id) {
        const r = await deps.tables.query(userId, block.source_table_id, block.config.query, timeZone);
        const keep = pickColumns(
          r.columns.map((c, i) => ({ c, i })),
          ({ c }) => c.key,
          options,
        );
        return {
          title,
          kind: 'table',
          text,
          columns: keep.map(({ c }) => clean(c.label)),
          rows: r.rows.slice(0, SHARE_MAX_ROWS).map((row) => keep.map(({ c, i }) => cell(row[i], { type: c.type as Column['type'] }, timeZone))),
          total: r.rows.length,
          empty: '결과가 없습니다',
          updated_at,
          shown: keep.map(({ c }) => c.key),
        };
      }
      return {
        title,
        kind: 'text',
        text,
        empty: '내용이 없습니다',
        updated_at,
      };
    }
    default:
      return {
        title,
        kind: 'text',
        text: clean(block.config.text).slice(0, MAX_TEXT),
        empty: '내용이 없습니다',
        updated_at,
      };
  }
}

const STYLE = `
*{box-sizing:border-box}html{font-size:17px}
body{margin:0;background:#f0f0e0;color:#3e481d;font-family:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;line-height:1.65;word-break:keep-all;overflow-wrap:anywhere}
main{max-width:880px;margin:0 auto;padding:40px 18px 48px}
.card{background:#fff;border:1px solid #dce3ce;border-radius:24px;padding:28px 24px}
h1{font-size:1.7rem;line-height:1.25;margin:0 0 6px}
.meta{color:#5a6b2a;font-size:.9rem;margin:0 0 20px}
ul{list-style:none;margin:0;padding:0}
li{display:flex;gap:12px;justify-content:space-between;padding:12px 2px;border-top:1px solid #e9eddd;font-size:1.05rem}
li:first-child{border-top:0}li .when{color:#5a6b2a;white-space:nowrap;font-size:.95rem}
.scroll{overflow-x:auto;margin:0 -4px}
table{border-collapse:collapse;width:100%;font-size:.98rem}
th{background:#f0f0e0;text-align:left;font-weight:600;color:#5a6b2a}
th,td{border-bottom:1px solid #e9eddd;padding:10px 12px;vertical-align:top}
.text{white-space:pre-wrap;font-size:1.05rem;margin:0 0 16px}
.empty{color:#5a6b2a;text-align:center;padding:32px 0}
footer{text-align:center;color:#5a6b2a;font-size:.85rem;margin-top:20px}
`;

/** 스크립트 없는 HTML 한 장. timeZone 은 '마지막 갱신' 표시용. */
export function renderSharePage(view: ShareView, timeZone: string, note = ''): string {
  let body = '';
  if (view.text) body += `<p class="text">${esc(view.text)}</p>`;
  if (view.kind === 'list') {
    body +=
      view.items && view.items.length > 0
        ? `<ul>${view.items.map((i) => `<li><span>${esc(i.title)}</span>${i.when ? `<span class="when">${esc(i.when)}</span>` : ''}</li>`).join('')}</ul>`
        : `<p class="empty">${esc(view.empty)}</p>`;
  } else if (view.kind === 'table') {
    body +=
      view.rows && view.rows.length > 0
        ? `<div class="scroll"><table><thead><tr>${(view.columns ?? []).map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${view.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` +
          (view.total && view.total > view.rows.length ? `<p class="meta">앞의 ${view.rows.length}줄만 보여 줍니다(전체 ${view.total}줄).</p>` : '')
        : `<p class="empty">${esc(view.empty)}</p>`;
  } else if (!view.text) {
    body += `<p class="empty">${esc(view.empty)}</p>`;
  }
  const when = new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(view.updated_at));
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(view.title)}</title><style>${STYLE}</style></head>
<body><main><div class="card"><h1>${esc(view.title)}</h1><p class="meta">${esc(when)} 기준${note ? ` · ${esc(note)}` : ''}</p>${body}</div><footer>쌤보드에서 공유한 읽기 전용 페이지입니다.</footer></main></body></html>`;
}

/** 링크가 꺼졌거나 없을 때 */
export function renderGonePage(): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>볼 수 없는 링크</title><style>${STYLE}</style></head><body><main><div class="card"><h1>볼 수 없는 링크입니다</h1><p class="meta">공유한 분이 링크를 껐거나 기간이 지났습니다.</p></div></main></body></html>`;
}
