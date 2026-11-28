import { boardKind } from '../common/board-context';
import { config } from '../config';
import { QuizzesService, quizAvailable } from '../quizzes/quizzes.service';
import { Injectable } from '@nestjs/common';
import {
  BLOCK_LABEL,
  BLOCK_TYPES,
  checkFormSpec,
  checkQuizSpec,
  isHexColor,
  checkLinkItems,
  LINK_KIND_LABEL,
  LINKS_MAX,
  answerLabel,
  QUIZ_DEFAULT_MINUTES,
  type QuizSpec,
  type BoardKind,
  boardKindOf,
  checkViewData,
  findColumn,
  MAX_EXTRACT_ROWS,
  MEMO_COLOR_LABEL,
  MEMO_COLORS,
  normalizeValue,
  PLACE_HINTS,
  placeBlock,
  validateQuery,
  VIEW_DATA_LABEL,
  VIEW_CODE_MAX,
  VIEW_CSS_MAX,
  type BlockType,
  type ColumnType,
  type CommandDto,
  type FormSpec,
  type GridPos,
  type MemoColor,
  type PlaceHint,
  type TablePreview,
  type ViewData,
  TITLE_COLORS,
  TITLE_COLOR_LABEL,
  type TitleColor,
  maskPii,
  MEMORY_MAX,
  MEMORY_TEXT_MAX,
  taskFilterOf,
  eventDaysOf,
  EVENT_DAYS,
  EVENT_DAYS_LABEL,
  MENU_ICONS,
  MENU_LABEL_MAX,
  NOTI_SHOW_LABEL,
  NOTI_SHOWS,
  SHARE_DAYS,
  SHAREABLE_BLOCKS,
  TASK_FILTER_LABEL,
  TASK_FILTERS,
  type MenuAction,
  type MenuItemDto,
  type NotiShow,
  type TaskFilter,
} from '@jarvis/shared';
import type { UserRow } from '../auth/auth.types';
import { BoardsService } from '../boards/boards.service';
import { bad, isUuid, notFound } from '../common/http';
import { ConnectorsService } from '../connectors/connectors.service';
import { Db, json, type Queryable } from '../db/db.service';
import { ItemsService } from '../items/items.service';
import { NotificationsService } from '../notifications/notifications.service';
import { checkColumnDefs, TablesService } from '../tables/tables.service';
import { checkDraft, describeAction, MenusService } from '../menus/menus.service';
import { SharesService } from '../shares/shares.service';
import { MemoryService } from '../memory/memory.service';
import { FilesService } from '../files/files.service';
import { applyXlsxEdits } from '../files/xlsx-edit';
import { applyHwpxEdits } from '../files/hwpx-edit';

/** 계획에 저장하는 한 단계. title·detail·preview는 화면에 보여 주는 요약이다. */
export interface StoredStep {
  tool: string;
  input: Record<string, any>;
  title: string;
  detail: string;
  preview?: TablePreview;
}

type Entity = 'tasks' | 'events' | 'blocks' | 'data_tables' | 'notifications' | 'menu_items' | 'shares' | 'memories' | 'quizzes';
/** 되돌리기 SQL 에 표 이름으로 들어가는 값 — 기록은 가져오기 파일에서 올 수도 있어 이 목록만 받는다(2026-11-27 코덱스 검토). */
const ENTITIES: readonly string[] = ['tasks', 'events', 'blocks', 'data_tables', 'notifications', 'menu_items', 'shares', 'memories', 'quizzes'];
type Change =
  | { kind: 'created'; entity: Entity; id: string; label: string }
  | {
      kind: 'updated';
      entity: Entity;
      id: string;
      label: string;
      before: Record<string, any>;
    }
  | {
      kind: 'deleted';
      entity: Entity;
      id: string;
      label: string;
      before?: Record<string, any>;
    }
  | { kind: 'rows_added'; table_id: string; count: number; label: string }
  | { kind: 'file_made'; upload_id: string; name: string; label: string };

export type Prepared = { ok: true; step: StoredStep } | { ok: false; error: string };

const fail = (error: string): Prepared => ({ ok: false, error });
const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const text = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hint = (v: unknown): PlaceHint | null => (PLACE_HINTS.includes(v as PlaceHint) ? (v as PlaceHint) : null);
const isMemoColor = (v: unknown): v is MemoColor => (MEMO_COLORS as readonly unknown[]).includes(v);
/**
 * 화면 블록의 그리기 코드(code)와 꾸밈(css). 준 것만 확인해 돌려준다.
 * 코드가 실제로 무엇을 하는지는 여기서 따지지 않는다. 틀이 가둔다(boards/view-frame.ts).
 */
function viewSource(input: Record<string, any>, needCode: boolean): { ok: true; code?: string; css?: string } | { ok: false; error: string } {
  const out: { ok: true; code?: string; css?: string } = { ok: true };
  if (input.html !== undefined)
    return {
      ok: false,
      error: 'html은 쓰지 않습니다. code(render(data, size)가 HTML·SVG 글자를 돌려주는 코드)와 css로 나눠 주세요.',
    };
  if (input.code !== undefined || needCode) {
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    if (!code) return { ok: false, error: 'view에는 code(그리기 코드)가 필요합니다.' };
    if (code.length > VIEW_CODE_MAX)
      return {
        ok: false,
        error: `code가 너무 깁니다(최대 ${VIEW_CODE_MAX.toLocaleString()}자). 자료를 코드에 적지 말고 data로 받으세요.`,
      };
    if (!/\brender\b/.test(code))
      return {
        ok: false,
        error: 'code에는 function render(data, size)가 있어야 합니다.',
      };
    out.code = code;
  }
  if (input.css !== undefined) {
    if (typeof input.css !== 'string') return { ok: false, error: 'css는 글자여야 합니다.' };
    if (input.css.length > VIEW_CSS_MAX)
      return {
        ok: false,
        error: `css가 너무 깁니다(최대 ${VIEW_CSS_MAX.toLocaleString()}자).`,
      };
    out.css = input.css;
  }
  return out;
}
const HINT_LABEL: Record<PlaceHint, string> = {
  'top-left': '왼쪽 위',
  'top-right': '오른쪽 위',
  'bottom-left': '왼쪽 아래',
  'bottom-right': '오른쪽 아래',
};

export function formatWhen(isoTime: string, timezone: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: timezone,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(isoTime));
}

/**
 * AI의 변경 계획을 다룬다: 계획 만들기 → 승인(적용) → 되돌리기(ONE-5·6·13).
 * 명령이 만든 것에는 command_id를 남기고, 삭제는 휴지통으로 보내고, 고친 값은 수정 전 값을 changes에 남긴다.
 */
@Injectable()
export class CommandsService {
  constructor(
    private readonly db: Db,
    private readonly boards: BoardsService,
    private readonly items: ItemsService,
    private readonly tables: TablesService,
    private readonly notifications: NotificationsService,
    private readonly connectors: ConnectorsService,
    private readonly menus: MenusService,
    private readonly shares: SharesService,
    private readonly memory: MemoryService,
    private readonly files: FilesService,
    private readonly quizzes: QuizzesService,
  ) {}

  /** 화면 블록이 받을 자료 정의를 확인한다. 표 자료면 그 표가 이 사용자의 것인지와 query까지 본다. */
  private async prepareViewData(uid: string, input: unknown): Promise<{ ok: true; data: ViewData; label: string } | { ok: false; error: string }> {
    const wanted = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const table = wanted.kind === 'table' && isUuid(wanted.table_id) ? await this.tables.get(uid, wanted.table_id as string) : null;
    const checked = checkViewData(input, (id) => (table && table.id === id ? table.schema : null));
    if (!checked.ok) return checked;
    return {
      ok: true,
      data: checked.data,
      label: checked.data.kind === 'table' ? `표 "${table!.name}"` : VIEW_DATA_LABEL[checked.data.kind],
    };
  }

  /** 쓰기 도구 호출을 검증하고 화면용 요약을 붙인다. 잘못된 호출은 이유를 돌려줘 모델이 고치게 한다. */
  async prepare(user: UserRow, tool: string, input: Record<string, any>): Promise<Prepared> {
    const tz = user.timezone;
    const uid = user.id;
    switch (tool) {
      case 'add_task': {
        const title = text(input.title);
        if (!title) return fail('title이 필요합니다.');
        if (input.due_at != null && !isIso(input.due_at)) return fail('due_at은 ISO 8601 시각이어야 합니다.');
        const due = input.due_at ? new Date(input.due_at).toISOString() : null;
        return {
          ok: true,
          step: {
            tool,
            input: { title, due_at: due },
            title: '할 일 추가',
            detail: due ? `${title} · ${formatWhen(due, tz)}까지` : title,
          },
        };
      }
      case 'update_task': {
        if (!isUuid(input.id)) return fail('id가 잘못됐습니다. list_tasks로 확인하세요.');
        const task = await this.db.one('select title from tasks where id = $1 and user_id = $2 and deleted_at is null', [input.id, uid]);
        if (!task) return fail('그런 할 일이 없습니다. list_tasks로 다시 확인하세요.');
        const patch: Record<string, any> = { id: input.id };
        const notes: string[] = [];
        if (text(input.title)) notes.push(`제목 → ${(patch.title = text(input.title))}`);
        if (input.due_at === null) {
          patch.due_at = null;
          notes.push('마감 지움');
        } else if (input.due_at !== undefined) {
          if (!isIso(input.due_at)) return fail('due_at은 ISO 8601 시각이어야 합니다.');
          patch.due_at = new Date(input.due_at).toISOString();
          notes.push(`마감 → ${formatWhen(patch.due_at, tz)}`);
        }
        if (input.status === 'done' || input.status === 'open') notes.push((patch.status = input.status) === 'done' ? '완료 처리' : '다시 열기');
        if (notes.length === 0) return fail('바꿀 내용이 없습니다.');
        return {
          ok: true,
          step: {
            tool,
            input: patch,
            title: '할 일 변경',
            detail: `${task.title} · ${notes.join(', ')}`,
          },
        };
      }
      case 'add_event': {
        const title = text(input.title);
        if (!title) return fail('title이 필요합니다.');
        if (!isIso(input.start_at)) return fail('start_at은 ISO 8601 시각이어야 합니다.');
        if (input.end_at != null && !isIso(input.end_at)) return fail('end_at은 ISO 8601 시각이어야 합니다.');
        const start = new Date(input.start_at).toISOString();
        const end = input.end_at ? new Date(input.end_at).toISOString() : null;
        return {
          ok: true,
          step: {
            tool,
            input: { title, start_at: start, end_at: end },
            title: '일정 추가',
            detail: `${formatWhen(start, tz)} ${title}`,
          },
        };
      }
      case 'update_event': {
        if (!isUuid(input.id)) return fail('id가 잘못됐습니다. list_events로 확인하세요.');
        const event = await this.db.one('select title from events where id = $1 and user_id = $2 and deleted_at is null', [input.id, uid]);
        if (!event) return fail('그런 일정이 없습니다. list_events로 다시 확인하세요.');
        const patch: Record<string, any> = { id: input.id };
        const notes: string[] = [];
        if (text(input.title)) notes.push(`제목 → ${(patch.title = text(input.title))}`);
        if (input.start_at !== undefined) {
          if (!isIso(input.start_at)) return fail('start_at은 ISO 8601 시각이어야 합니다.');
          patch.start_at = new Date(input.start_at).toISOString();
          notes.push(`시작 → ${formatWhen(patch.start_at, tz)}`);
        }
        if (input.end_at === null) patch.end_at = null;
        else if (input.end_at !== undefined) {
          if (!isIso(input.end_at)) return fail('end_at은 ISO 8601 시각이어야 합니다.');
          patch.end_at = new Date(input.end_at).toISOString();
          notes.push(`끝 → ${formatWhen(patch.end_at, tz)}`);
        }
        if (notes.length === 0 && patch.end_at === undefined) return fail('바꿀 내용이 없습니다.');
        return {
          ok: true,
          step: {
            tool,
            input: patch,
            title: '일정 변경',
            detail: `${event.title} · ${notes.join(', ') || '끝 시각 지움'}`,
          },
        };
      }
      case 'create_block': {
        if (!BLOCK_TYPES.includes(input.type)) return fail(`type은 ${BLOCK_TYPES.join(', ')} 중 하나입니다.`);
        if (input.type === 'quiz') return fail('퀴즈 블록은 create_quiz 로 만듭니다.');
        const type = input.type as BlockType;
        if (type === 'view') {
          if (input.text !== undefined || input.table_id !== undefined || input.query !== undefined || input.color !== undefined)
            return fail('view에는 code·css·data만 씁니다. 표는 data에 {"kind":"table","table_id":…,"query":…}로 넣으세요.');
          const source = viewSource(input, true);
          if (!source.ok) return fail(source.error);
          const data = await this.prepareViewData(uid, input.data);
          if (!data.ok) return fail(data.error);
          const name = text(input.title, 60) || BLOCK_LABEL.view;
          const at = hint(input.position);
          return {
            ok: true,
            step: {
              tool,
              input: {
                type,
                title: name,
                code: source.code,
                css: source.css ?? '',
                data: data.data,
                position: at,
              },
              title: '새 블록',
              detail: `${name} · ${BLOCK_LABEL.view} · 자료: ${data.label}${at ? ` · ${HINT_LABEL[at]}` : ''}`,
            },
          };
        }
        if (input.code !== undefined || input.css !== undefined || input.html !== undefined || input.data !== undefined) return fail('code·css·data는 type이 view일 때만 쓸 수 있습니다.');
        const out: Record<string, any> = {
          type,
          position: hint(input.position),
        };
        let title = text(input.title, 60);
        if (input.table_id !== undefined) {
          if (!isUuid(input.table_id)) return fail('table_id가 잘못됐습니다. list_tables로 확인하세요.');
          const table = await this.tables.get(uid, input.table_id);
          if (!table) return fail('그런 표가 없습니다. list_tables로 다시 확인하세요.');
          out.table_id = table.id;
          title ||= table.name;
          if (input.query !== undefined) {
            const checked = validateQuery(input.query, table.schema);
            if (!checked.ok) return fail(`query가 맞지 않습니다: ${checked.error}`);
            out.query = checked.spec;
          }
        }
        if (type === 'table' && !out.table_id) return fail('표 블록에는 table_id가 필요합니다.');
        if (input.query !== undefined && type !== 'ai_result') return fail('query는 type이 ai_result일 때만 쓸 수 있습니다.');
        if (typeof input.text === 'string') out.text = input.text.slice(0, 5000);
        if (input.color !== undefined) {
          if (type !== 'memo') return fail('color는 type이 memo일 때만 쓸 수 있습니다.');
          if (!isMemoColor(input.color) && !isHexColor(input.color)) return fail(`color는 ${MEMO_COLORS.join(', ')} 중 하나이거나 #rrggbb 색입니다.`);
          out.color = input.color;
        }
        out.title = title || BLOCK_LABEL[type];
        const where = out.position ? ` · ${HINT_LABEL[out.position as PlaceHint]}` : '';
        const paper = out.color ? ` · ${isHexColor(out.color) ? out.color : MEMO_COLOR_LABEL[out.color as MemoColor]}` : '';
        return {
          ok: true,
          step: {
            tool,
            input: out,
            title: '새 블록',
            detail: `${out.title} · ${out.query ? '서버 집계' : BLOCK_LABEL[type]}${paper}${where}`,
          },
        };
      }
      case 'update_block':
      case 'delete_block': {
        if (!isUuid(input.id)) return fail('id가 잘못됐습니다. get_board로 확인하세요.');
        const block = await this.db.one<{ title: string; type: BlockType }>('select title, type from blocks where id = $1 and user_id = $2 and deleted_at is null', [input.id, uid]);
        if (!block) return fail('그런 블록이 없습니다. get_board로 다시 확인하세요.');
        if (tool === 'delete_block' && block.type === 'menu') return fail('내 메뉴 블록은 지울 수 없습니다(보드마다 하나). 접어 두려면 사용자에게 ⋯ → 스티커로 접기를 안내하세요.');
        if (tool === 'delete_block')
          return {
            ok: true,
            step: {
              tool,
              input: { id: input.id },
              title: '블록 삭제',
              detail: `${block.title} · 휴지통으로`,
            },
          };
        const patch: Record<string, any> = { id: input.id };
        const notes: string[] = [];
        if (text(input.title, 60)) notes.push(`제목 → ${(patch.title = text(input.title, 60))}`);
        if (typeof input.pinned === 'boolean') notes.push((patch.pinned = input.pinned) ? '고정' : '고정 해제');
        if (hint(input.position)) notes.push(`${HINT_LABEL[(patch.position = hint(input.position)!)]}로 이동`);
        if (input.color !== undefined) {
          // 메모는 종이 색(config.color), 다른 블록은 바탕(config.bg) — 반영할 때 나눈다(2026-11-27 꾸미기).
          if (!isMemoColor(input.color) && !isHexColor(input.color)) return fail(`color는 ${MEMO_COLORS.join(', ')} 중 하나이거나 #rrggbb 색입니다.`);
          patch.color = input.color;
          notes.push(`바탕 → ${isHexColor(input.color) ? input.color : MEMO_COLOR_LABEL[input.color as MemoColor]}`);
        }
        if (input.title_color !== undefined) {
          if (!(TITLE_COLORS as readonly unknown[]).includes(input.title_color) && !isHexColor(input.title_color))
            return fail(`title_color는 ${TITLE_COLORS.join(', ')} 중 하나이거나 #rrggbb 색입니다.`);
          patch.title_color = input.title_color;
          notes.push(`제목 색 → ${isHexColor(input.title_color) ? input.title_color : TITLE_COLOR_LABEL[input.title_color as TitleColor]}`);
        }
        // 할 일·일정·알림 블록의 보여 줄 내용(2026-11-28)
        if (input.task_filter !== undefined) {
          if (block.type !== 'tasks') return fail('task_filter 는 할 일 블록에만 씁니다.');
          if (!(TASK_FILTERS as readonly unknown[]).includes(input.task_filter)) return fail(`task_filter 는 ${TASK_FILTERS.join(', ')} 중 하나입니다.`);
          notes.push(`보여 줄 할 일 → ${TASK_FILTER_LABEL[(patch.task_filter = input.task_filter as TaskFilter)]}`);
        }
        if (input.event_days !== undefined) {
          if (block.type !== 'events') return fail('event_days 는 일정 블록에만 씁니다.');
          if (!(EVENT_DAYS as readonly unknown[]).includes(input.event_days)) return fail(`event_days 는 ${EVENT_DAYS.join(', ')} 중 하나입니다.`);
          notes.push(`보여 줄 기간 → ${EVENT_DAYS_LABEL[(patch.event_days = input.event_days as number)]}`);
        }
        if (input.noti_show !== undefined) {
          if (block.type !== 'notifications') return fail('noti_show 는 알림 블록에만 씁니다.');
          if (!(NOTI_SHOWS as readonly unknown[]).includes(input.noti_show)) return fail(`noti_show 는 ${NOTI_SHOWS.join(', ')} 중 하나입니다.`);
          notes.push(`보여 줄 알림 → ${NOTI_SHOW_LABEL[(patch.noti_show = input.noti_show as NotiShow)]}`);
        }
        if (input.code !== undefined || input.css !== undefined || input.html !== undefined || input.data !== undefined) {
          if (block.type !== 'view') return fail('code·css·data는 화면 블록(view)에만 쓸 수 있습니다.');
          const source = viewSource(input, false);
          if (!source.ok) return fail(source.error);
          if (source.code !== undefined) patch.code = source.code;
          if (source.css !== undefined) patch.css = source.css;
          if (source.code !== undefined || source.css !== undefined) notes.push('화면 고침');
          if (input.data !== undefined) {
            const data = await this.prepareViewData(uid, input.data);
            if (!data.ok) return fail(data.error);
            patch.data = data.data;
            notes.push(`자료 → ${data.label}`);
          }
        }
        if (notes.length === 0) return fail('바꿀 내용이 없습니다.');
        return {
          ok: true,
          step: {
            tool,
            input: patch,
            title: '블록 변경',
            detail: `${block.title} · ${notes.join(', ')}`,
          },
        };
      }
      case 'create_table': {
        const name = text(input.name, 80);
        if (!name) return fail('name이 필요합니다.');
        let columns: { name: string; type: ColumnType }[];
        try {
          columns = checkColumnDefs(input.columns);
        } catch (e: any) {
          return fail(e?.message ?? 'columns가 잘못됐습니다.');
        }
        if (!Array.isArray(input.rows) || input.rows.length === 0) return fail('rows가 비어 있습니다.');
        if (input.rows.length > MAX_EXTRACT_ROWS) return fail(`한 번에 최대 ${MAX_EXTRACT_ROWS}행입니다. 나눠서 요청하도록 사용자에게 알리세요.`);
        const rows: (string | null)[][] = [];
        for (const r of input.rows) {
          if (!Array.isArray(r)) return fail('rows의 각 행은 배열이어야 합니다.');
          rows.push(columns.map((_, i) => (r[i] === null || r[i] === undefined ? null : String(r[i]).slice(0, 2000))));
        }
        const out = {
          name,
          columns,
          rows,
          place_block: input.place_block !== false,
          position: hint(input.position),
        };
        return {
          ok: true,
          step: {
            tool,
            input: out,
            title: '새 표',
            detail: `${name} · 컬럼 ${columns.length}개 · ${rows.length}행${out.place_block ? ' · 보드에 배치' : ''}`,
            preview: {
              name,
              columns,
              rows: rows.slice(0, 20),
              total: rows.length,
            },
          },
        };
      }
      case 'create_form': {
        const checked = checkFormSpec(input);
        if (!checked.ok) return fail(checked.error);
        if (!(await this.connectors.googleConnector(uid))) return fail('Google 이 연결돼 있지 않습니다. 설문을 만들려면 설정 → 연결에서 Google 을 먼저 연결해야 한다고 사용자에게 안내하세요.');
        const spec = checked.spec;
        const names = spec.questions.map((question) => question.title);
        const at = hint(input.position);
        return {
          ok: true,
          step: {
            tool,
            input: {
              spec,
              place_block: input.place_block !== false,
              position: at,
            },
            title: '설문 만들기',
            detail: `${spec.title} · 질문 ${names.length}개(${names.slice(0, 3).join(', ')}${names.length > 3 ? ' …' : ''}) · Google 설문지와 응답 표${at ? ` · ${HINT_LABEL[at]}` : ''}`,
          },
        };
      }
      case 'add_links': {
        const checked = checkLinkItems(input.items);
        if (!checked.ok) return fail(checked.error);
        if (checked.items.length === 0) return fail('items 가 비어 있습니다.');
        // 같은 요청 안에서 겹친 주소도 하나만
        checked.items = checked.items.filter((it, n, all) => all.findIndex((x) => x.url === it.url) === n);
        let blockTitle = '';
        let target: string | null = null;
        if (input.block_id !== undefined && input.block_id !== null && input.block_id !== '') {
          if (!isUuid(input.block_id)) return fail('block_id가 잘못됐습니다. get_board로 확인하세요.');
          const b = await this.boards.getBlock(uid, input.block_id);
          if (!b || b.type !== 'links') return fail('그런 수업 자료 블록이 없습니다. get_board 에서 type 이 links 인 블록을 확인하거나 block_id 없이 새 블록으로 담으세요.');
          const old: any[] = Array.isArray(b.config.items) ? b.config.items : [];
          blockTitle = b.title || '수업 자료';
          target = b.id;
          // 이미 담긴 주소는 빼고 담는다
          const urls = new Set(old.map((x) => String(x?.url)));
          checked.items = checked.items.filter((it) => !urls.has(it.url));
          if (checked.items.length === 0) return fail('모두 이미 담긴 주소입니다.');
          if (old.length + checked.items.length > LINKS_MAX) return fail(`한 블록에 ${LINKS_MAX}개까지입니다(지금 ${old.length}개).`);
        }
        const title = text(input.title, 60) || '수업 자료';
        return {
          ok: true,
          step: {
            tool,
            input: { block_id: target, title, items: checked.items },
            title: '수업 자료 담기',
            detail: `${target ? `"${blockTitle}"에 더함` : `새 블록 "${title}"`} · ${checked.items.length}개\n${checked.items.map((it) => `${it.title} (${LINK_KIND_LABEL[it.kind]}${it.student ? ', 학생에게 보임' : ''}) ${it.url}`).join('\n')}`,
          },
        };
      }
      case 'create_quiz': {
        // 방식: 서버 판은 쌤보드 학생 페이지가 기본, 드라이브 판은 구글 설문 퀴즈만(학생이 들어올 서버가 없다)
        const mode = input.mode === 'google' || !quizAvailable() ? 'google' : 'board';
        if (input.mode === 'board' && !quizAvailable()) return fail('이 판(구글 드라이브)에서는 쌤보드 퀴즈를 낼 수 없어 구글 설문 퀴즈(mode: google)로만 됩니다.');
        if (mode === 'google' && !(await this.connectors.googleConnector(uid)))
          return fail('구글 설문 퀴즈를 만들려면 구글이 연결돼 있어야 합니다. 설정 → 연결에서 Google 을 먼저 연결하라고 안내하세요.');
        const checked = checkQuizSpec(input);
        if (!checked.ok) return fail(checked.error);
        const minutes = Number.isInteger(input.minutes) ? Math.min(720, Math.max(5, input.minutes)) : QUIZ_DEFAULT_MINUTES;
        const spec = checked.spec;
        return {
          ok: true,
          step: {
            tool,
            input: { spec, minutes, mode },
            title: mode === 'google' ? '구글 설문 퀴즈 만들기' : '퀴즈 만들기',
            detail: `${spec.title} · ${spec.questions.length}문항 · ${mode === 'google' ? '구글 설문 퀴즈(첫 문항 번호나 별명, 이메일 안 받음, [마감]까지 받음)' : `${minutes}분 뒤 자동 마감`}\n${spec.questions.map((q, i) => `${i + 1}. ${q.text}${q.options ? ` [${q.options.map((o, j) => `${j + 1}) ${o}`).join(' ')}]` : ''} → 정답 ${answerLabel(q)}`).join('\n')}`,
          },
        };
      }
      case 'add_rows': {
        if (!isUuid(input.table_id)) return fail('table_id가 잘못됐습니다. list_tables로 확인하세요.');
        const table = await this.tables.get(uid, input.table_id);
        if (!table) return fail('그런 표가 없습니다.');
        if (table.linked) return fail('연결된 시트 표는 읽기 전용입니다.');
        if (!Array.isArray(input.rows) || input.rows.length === 0) return fail('rows가 비어 있습니다.');
        if (input.rows.length > MAX_EXTRACT_ROWS) return fail(`한 번에 최대 ${MAX_EXTRACT_ROWS}행입니다.`);
        for (const row of input.rows) {
          if (typeof row !== 'object' || row === null || Array.isArray(row)) return fail('각 행은 col_id를 키로 하는 객체여야 합니다.');
          for (const [key, value] of Object.entries(row)) {
            const col = findColumn(table.schema, key);
            if (!col) return fail(`없는 컬럼입니다: ${key}. list_tables의 col_id를 쓰세요.`);
            if (!normalizeValue(value, col.type).ok) return fail(`${col.name} 값이 ${col.type} 타입에 맞지 않습니다: ${String(value).slice(0, 40)}`);
          }
        }
        return {
          ok: true,
          step: {
            tool,
            input: { table_id: table.id, rows: input.rows },
            title: '행 추가',
            detail: `${table.name}에 ${input.rows.length}행`,
          },
        };
      }
      case 'mark_notifications': {
        const ids = Array.isArray(input.ids) ? input.ids.filter(isUuid) : [];
        if (ids.length === 0) return fail('ids가 비어 있습니다. list_notifications로 확인하세요.');
        if (input.status !== 'read' && input.status !== 'archived') return fail('status는 read 또는 archived입니다.');
        return {
          ok: true,
          step: {
            tool,
            input: { ids, status: input.status },
            title: '알림 정리',
            detail: `${ids.length}건 ${input.status === 'read' ? '읽음 처리' : '보관'}`,
          },
        };
      }
      case 'create_menu': {
        const own = new Set((await this.db.query<{ id: string }>('select id from data_tables where user_id = $1 and deleted_at is null', [uid])).map((r) => r.id));
        let checked;
        try {
          checked = checkDraft(
            {
              ...input,
              prompt: input.prompt ?? null,
              url: input.url ?? null,
              panel: input.panel ?? null,
              table_id: input.table_id ?? null,
              new_table: input.new_table ?? null,
              description: input.description ?? '',
              reason: '',
            },
            own,
          );
        } catch (e: any) {
          return fail(String(e?.message ?? e));
        }
        const count = (await this.db.one<{ n: number }>('select count(*)::int as n from menu_items where user_id = $1 and board_kind = $2', [uid, boardKind()]))!.n;
        if (count >= 12) return fail('메뉴는 12개까지입니다. 안 쓰는 메뉴를 먼저 지우자고 사용자에게 제안하세요.');
        const tableName = checked.new_table ? `새 표 "${checked.new_table.name}"(${checked.new_table.columns.map((c) => c.name).join(', ')})` : '';
        const actionText =
          'table_id' in checked.action && checked.action.table_id === null
            ? `${checked.action.type === 'add_row' ? '표에 한 줄 넣기' : '표 열기'} — ${tableName}`
            : describeAction(checked.action as MenuAction);
        return {
          ok: true,
          step: {
            tool,
            input: {
              label: checked.label,
              icon: checked.icon,
              description: checked.description,
              action_type: checked.action.type,
              prompt: input.prompt ?? null,
              url: input.url ?? null,
              panel: input.panel ?? null,
              table_id: checked.action.type === 'open_table' || checked.action.type === 'add_row' ? (checked.action.table_id ?? null) : null,
              new_table: checked.new_table,
              reason: '',
            },
            title: '메뉴 만들기',
            detail: `${checked.label} · ${actionText}`,
          },
        };
      }
      case 'update_menu':
      case 'delete_menu': {
        if (!isUuid(input.id)) return fail('id가 잘못됐습니다. list_menus로 확인하세요.');
        const menu = await this.db.one<{ label: string }>('select label from menu_items where id = $1 and user_id = $2', [input.id, uid]);
        if (!menu) return fail('그런 메뉴가 없습니다. list_menus로 다시 확인하세요.');
        if (tool === 'delete_menu')
          return {
            ok: true,
            step: {
              tool,
              input: { id: input.id },
              title: '메뉴 삭제',
              detail: `${menu.label} · 메뉴만 지움(표는 그대로)`,
            },
          };
        const patch: Record<string, any> = { id: input.id };
        const notes: string[] = [];
        if (text(input.label, MENU_LABEL_MAX)) notes.push(`이름 → ${(patch.label = text(input.label, MENU_LABEL_MAX))}`);
        if (input.icon !== undefined) {
          if (!(MENU_ICONS as readonly unknown[]).includes(input.icon)) return fail(`icon 은 ${MENU_ICONS.join(', ')} 중 하나입니다.`);
          notes.push(`아이콘 → ${(patch.icon = input.icon)}`);
        }
        if (typeof input.description === 'string') notes.push(`설명 → ${(patch.description = text(input.description, 120))}`);
        if (Number.isInteger(input.index)) notes.push(`${(patch.index = Math.max(0, input.index as number)) + 1}번째로`);
        if (typeof input.pinned === 'boolean') notes.push((patch.pinned = input.pinned) ? '맨 위에 고정' : '고정 풀기');
        if (notes.length === 0) return fail('바꿀 내용이 없습니다.');
        return {
          ok: true,
          step: {
            tool,
            input: patch,
            title: '메뉴 변경',
            detail: `${menu.label} · ${notes.join(', ')}`,
          },
        };
      }
      case 'create_share': {
        if (!isUuid(input.block_id)) return fail('block_id가 잘못됐습니다. get_board로 확인하세요.');
        const block = await this.db.one<{
          title: string;
          type: BlockType;
          source_table_id: string | null;
        }>('select title, type, source_table_id from blocks where id = $1 and user_id = $2 and deleted_at is null', [input.block_id, uid]);
        if (!block) return fail('그런 블록이 없습니다. get_board로 다시 확인하세요.');
        if (!SHAREABLE_BLOCKS.includes(block.type)) return fail('이 블록은 공유할 수 없습니다(할 일·일정·표·메모·AI 결과·수업 자료만).');
        const days = input.days === undefined ? 30 : Number(input.days);
        if (!(SHARE_DAYS as readonly number[]).includes(days)) return fail(`days 는 ${SHARE_DAYS.join(', ')} 중 하나입니다.`);
        // 숨길 칸은 이름으로 받아 열 id 로 바꾼다(표 블록만)
        const hide: string[] = [];
        const names: string[] = [];
        if (Array.isArray(input.hide_columns) && input.hide_columns.length > 0) {
          if (block.type !== 'table' || !block.source_table_id) return fail('hide_columns 는 표 블록에만 씁니다.');
          const table = await this.tables.get(uid, block.source_table_id);
          for (const n of input.hide_columns) {
            const col = table ? (findColumn(table.schema, String(n)) ?? table.schema.columns.find((c) => c.name === String(n).trim())) : undefined;
            if (!col) return fail(`없는 칸입니다: ${String(n)}. list_tables 로 칸 이름을 확인하세요.`);
            hide.push(col.id);
            names.push(col.name);
          }
        }
        const title = text(input.title, 120) || block.title;
        // 승인 화면에는 AI 가 붙인 제목이 아니라 '실제로 공개되는 것'을 적는다: 원래 블록, 보이는 칸, 실제 기간(구글 문서는 기간 없음) — 코덱스 검토
        const drive = this.shares.mode() === 'drive';
        const realDays = drive ? 0 : days;
        let shown = '';
        let showIds: string[] | undefined;
        if (block.type === 'table' && block.source_table_id) {
          const table = await this.tables.get(uid, block.source_table_id);
          const visible = (table?.schema.columns ?? []).filter((c) => !hide.includes(c.id));
          showIds = visible.map((c) => c.id);
          shown = ` · 보이는 칸: ${visible.map((c) => c.name).join(', ') || '(없음)'}`;
        }
        // 할 일·일정 블록은 블록에 보이는 범위만 나간다 — 그 범위를 적는다
        const cfg = (await this.db.one<{ config: Record<string, unknown> }>('select config from blocks where id = $1', [input.block_id]))?.config ?? {};
        if (block.type === 'tasks') shown = ` · 보이는 할 일: ${TASK_FILTER_LABEL[taskFilterOf(cfg)]}`;
        if (block.type === 'events') shown = ` · 보이는 일정: 오늘부터 ${EVENT_DAYS_LABEL[eventDaysOf(cfg)]}`;
        return {
          ok: true,
          step: {
            tool,
            input: {
              block_id: input.block_id,
              title,
              days: realDays,
              hide_columns: hide,
              show_columns: showIds,
            },
            title: '공유 링크 만들기',
            detail: `블록 "${block.title}"(${BLOCK_LABEL[block.type]})을 로그인 없이 읽기 전용으로 공개 · 받는 사람에게 보일 제목 "${title}"${shown}${names.length ? ` · 숨김: ${names.join(', ')}` : ''} · ${drive ? '구글 문서(기간 없음, 끄기 전까지)' : realDays ? `${realDays}일` : '기간 없음'}`,
          },
        };
      }
      case 'edit_file': {
        if (!isUuid(input.file_id)) return fail('file_id 가 잘못됐습니다. <attached_file> 의 file_id 를 쓰세요.');
        let src;
        try {
          src = await this.files.source(uid, input.file_id);
        } catch (e: any) {
          return fail(String(e?.message ?? e));
        }
        // 미리 한 번 적용해 본다(파일은 만들지 않음) — 틀린 칸·문단·수식이면 까닭을 돌려줘 AI 가 고치게
        let report;
        try {
          report = (src.ext === '.xlsx' ? await applyXlsxEdits(src.buffer, input.edits, true) : await applyHwpxEdits(src.buffer, input.edits, true)).report;
        } catch (e: any) {
          return fail(String(e?.message ?? e));
        }
        const base = src.name.replace(/\.[^.]+$/, '');
        const name = `${base} (고침)${src.ext}`;
        const summary = text(input.summary, 120);
        // 바뀌는 곳은 빠짐없이(앞 몇 개만 보여 주면 뒤에 숨긴 고치기를 승인할 수 있다 — 코덱스 검토). AI 설명은 맨 뒤에 따로.
        return {
          ok: true,
          step: {
            tool,
            input: { file_id: input.file_id, edits: input.edits, name },
            title: '파일 고치기',
            detail: [`${src.name} → ${name} · 바뀌는 곳 ${report.count}곳`, ...report.lines.map((l) => `· ${l}`), ...(summary ? [`(AI 설명: ${summary})`] : [])].join('\n'),
          },
        };
      }
      case 'remember': {
        const t = maskPii(text(input.text, MEMORY_TEXT_MAX).replace(/\s+/g, ' '));
        if (!t) return fail('text 가 비었습니다.');
        const n = (await this.db.one<{ n: number }>('select count(*)::int as n from memories where user_id = $1', [uid]))!.n;
        if (n >= MEMORY_MAX) return fail(`기억은 ${MEMORY_MAX}개까지입니다. 안 쓰는 기억을 forget 으로 지우자고 사용자에게 제안하세요.`);
        return {
          ok: true,
          step: { tool, input: { text: t }, title: '기억하기', detail: t },
        };
      }
      case 'forget': {
        if (!isUuid(input.id)) return fail('id가 잘못됐습니다. 안내문의 기억 목록 [id]를 쓰세요.');
        const m = await this.db.one<{ text: string }>('select text from memories where id = $1 and user_id = $2', [input.id, uid]);
        if (!m) return fail('그런 기억이 없습니다.');
        return {
          ok: true,
          step: {
            tool,
            input: { id: input.id },
            title: '기억 지우기',
            detail: m.text,
          },
        };
      }
      default:
        return fail(`알 수 없는 도구입니다: ${tool}`);
    }
  }

  async propose(userId: string, messageId: string | null, steps: StoredStep[], kind: BoardKind = boardKind()): Promise<CommandDto> {
    const row = (await this.db.one<{ id: string }>('insert into ai_commands(user_id, message_id, plan, board_kind) values ($1, $2, $3::jsonb, $4) returning id', [
      userId,
      messageId,
      json(steps),
      kind,
    ]))!;
    return this.view({
      id: row.id,
      status: 'proposed',
      plan: steps,
      skipped: [],
    });
  }

  private view(row: { id: string; status: string; plan: StoredStep[]; skipped: string[]; changes?: Change[] }): CommandDto {
    const files = (row.changes ?? []).filter((c): c is Extract<Change, { kind: 'file_made' }> => c?.kind === 'file_made').map((c) => ({ id: c.upload_id, name: c.name }));
    return {
      id: row.id,
      status: row.status as CommandDto['status'],
      steps: row.plan.map((s, index) => ({
        index,
        tool: s.tool,
        title: s.title,
        detail: s.detail,
        preview: s.preview,
      })),
      skipped: row.skipped ?? [],
      ...(files.length > 0 && row.status === 'applied' ? { files } : {}),
    };
  }

  /** 처리 결과에 덧붙일 것 — 바뀐 곳·공유 링크·파일 만료·되돌릴 수 있는지(처리 결과함, 2026-11-28 UX 토론 A·J) */
  private async extras(userId: string, rows: { id: string; status: string; changes?: Change[]; created_at?: string; applied_at?: string | null }[]): Promise<Map<string, Partial<CommandDto>>> {
    const out = new Map<string, Partial<CommandDto>>();
    const changes = rows.flatMap((r) => (Array.isArray(r.changes) ? r.changes : []));
    const shareIds = changes.filter((c) => c?.kind === 'created' && c.entity === 'shares').map((c) => (c as { id: string }).id);
    const fileIds = changes.filter((c) => c?.kind === 'file_made').map((c) => (c as { upload_id: string }).upload_id);
    const shares = shareIds.length
      ? await this.db.query<{ id: string; title: string; token: string; external_url: string | null; revoked_at: string | null }>(
          'select id, title, token, external_url, revoked_at from shares where user_id = $1 and id = any($2::uuid[])',
          [userId, shareIds],
        )
      : [];
    const files = fileIds.length
      ? await this.db.query<{ id: string; expires_at: string; downloaded: boolean }>(
          "select id, (created_at + interval '1 day') as expires_at, downloaded_at is not null as downloaded from uploads where user_id = $1 and id = any($2::uuid[])",
          [userId, fileIds],
        )
      : [];
    const latest = await this.db.one<{ id: string }>("select id from ai_commands where user_id = $1 and status in ('applied', 'applying') order by applied_at desc, id desc limit 1", [userId]);
    for (const r of rows) {
      const list = Array.isArray(r.changes) ? r.changes : [];
      const touched = list.flatMap((c): { entity: string; id: string }[] =>
        c?.kind === 'created' || c?.kind === 'updated' ? [{ entity: c.entity, id: c.id }] : c?.kind === 'rows_added' ? [{ entity: 'data_tables', id: c.table_id }] : [],
      );
      const mine = new Set(list.filter((c) => c?.kind === 'created' && c.entity === 'shares').map((c) => (c as { id: string }).id));
      out.set(r.id, {
        created_at: r.created_at,
        applied_at: r.applied_at ?? null,
        touched,
        shares: shares
          .filter((s) => mine.has(s.id))
          .map((s) => ({ id: s.id, title: s.title, url: s.external_url ?? `${config.publicUrl}/s/${s.token}`, revoked: s.revoked_at !== null, snapshot: s.external_url !== null })),
        undoable: r.status === 'applied' && latest?.id === r.id,
        fileExpiry: Object.fromEntries(files.map((f) => [f.id, new Date(f.expires_at).toISOString()])),
        fileDownloaded: files.filter((f) => f.downloaded).map((f) => f.id),
      } as Partial<CommandDto> & { fileExpiry: Record<string, string>; fileDownloaded: string[] });
    }
    return out;
  }

  /** 처리 결과함 — 최근 14일의 승인 대기·처리한 것·되돌린 것 */
  async list(userId: string): Promise<CommandDto[]> {
    await this.db.query(
      `update ai_commands set status = 'applied', skipped = coalesce(skipped, '[]'::jsonb) || '["공유 링크 만들기가 끝나지 않았습니다. 블록의 공유 링크 창에서 확인하세요."]'::jsonb
        where user_id = $1 and status = 'applying' and applied_at < now() - interval '5 minutes'`,
      [userId],
    );
    const rows = await this.db.query<any>(
      `select id, status, plan, skipped, changes, created_at, applied_at from ai_commands
        where user_id = $1 and status in ('proposed', 'applying', 'applied', 'undone') and created_at > now() - interval '14 days'
        order by coalesce(applied_at, created_at) desc, id desc limit 40`,
      [userId],
    );
    const more = await this.extras(userId, rows);
    return rows.map((r) => this.withExtras(this.view(r), more.get(r.id)));
  }

  private withExtras(dto: CommandDto, more?: Partial<CommandDto> & { fileExpiry?: Record<string, string>; fileDownloaded?: string[] }): CommandDto {
    if (!more) return dto;
    const { fileExpiry = {}, fileDownloaded = [], ...rest } = more;
    return {
      ...dto,
      ...rest,
      ...(dto.files ? { files: dto.files.map((f) => ({ ...f, expires_at: fileExpiry[f.id] ?? null, gone: !(f.id in fileExpiry), downloaded: fileDownloaded.includes(f.id) })) } : {}),
    };
  }

  async get(userId: string, id: string): Promise<CommandDto> {
    // 마무리(공유 링크 만들기) 중 서버가 꺼져 'applying' 에 남은 명령은 5분 뒤 applied 로 풀고 알린다(코덱스·제미나이 검토)
    await this.db.query(
      `update ai_commands set status = 'applied', skipped = coalesce(skipped, '[]'::jsonb) || '["공유 링크 만들기가 끝나지 않았습니다. 블록의 공유 링크 창에서 확인하세요."]'::jsonb
        where id = $1 and user_id = $2 and status = 'applying' and applied_at < now() - interval '5 minutes'`,
      [id, userId],
    );
    const row = await this.db.one<any>('select id, status, plan, skipped, changes, created_at, applied_at from ai_commands where id = $1 and user_id = $2', [id, userId]);
    if (!row) return notFound('명령');
    return this.withExtras(this.view(row), (await this.extras(userId, [row])).get(row.id));
  }

  async cancel(userId: string, id: string): Promise<CommandDto> {
    await this.db.query(`update ai_commands set status = 'cancelled' where id = $1 and user_id = $2 and status = 'proposed'`, [id, userId]);
    return this.get(userId, id);
  }

  /**
   * 계획을 승인해 반영한다. 한 트랜잭션에서 모든 단계를 실행하고, 하나라도 실패하면 전부 되돌린다.
   * edits로 표 미리보기에서 고친 이름·컬럼을 넘길 수 있다(LLM-4).
   */
  async apply(user: UserRow, id: string, edits: Record<string, { name?: string; columns?: { name: string; type: ColumnType }[] }> = {}): Promise<CommandDto> {
    // 계획을 만든 때의 보드에 놓는다 — 그 사이 다른 보드로 바꿔도(2026-11-28 두 보드)
    // 보드 id 를 직접 넘긴다(드라이브 판에는 요청별 문맥이 없어 전역 값에 기대면 겹친 요청에 섞인다 — 코덱스·제미나이 검토)
    const kind = boardKindOf((await this.db.one<{ board_kind: string }>('select board_kind from ai_commands where id = $1 and user_id = $2', [id, user.id]))?.board_kind);
    // 공유 링크는 바깥 일(구글 문서)도 하고 자료를 다시 읽으므로 트랜잭션이 끝난 뒤 따로 만든다(브라우저 안 DB 는 연결이 하나라 안에서 읽으면 서로 기다린다).
    const later: StoredStep[] = [];
    await this.db.tx(async (q) => {
      const cmd = await q.one<{ plan: StoredStep[] }>(`select plan from ai_commands where id = $1 and user_id = $2 and status = 'proposed' for update`, [id, user.id]);
      if (!cmd) bad('이미 처리했거나 없는 계획입니다.');
      const boardId = (await this.boards.currentBoard(user.id, q, kind)).id;
      const changes: Change[] = [];
      for (const [index, step] of cmd!.plan.entries()) {
        const edit = edits?.[String(index)];
        if (step.tool === 'create_table' && edit) {
          if (edit.name) step.input.name = text(edit.name, 80) || step.input.name;
          if (edit.columns) {
            const columns = checkColumnDefs(edit.columns);
            if (columns.length !== step.input.columns.length) bad('컬럼 수는 미리보기와 같아야 합니다.');
            step.input.columns = columns;
          }
        }
        if (step.tool === 'create_share') {
          later.push(step);
          continue;
        }
        changes.push(...(await this.execute(q, user, id, step, boardId)));
      }
      // applied_at을 마지막에 적는다. 이 뒤에 updated_at이 더 늦어진 항목은 "적용 뒤에 고친 것"이다.
      // 트랜잭션 뒤에 만들 공유 링크가 있으면 그동안 'applying' — 되돌리기는 'applied' 만 받으므로 만드는 사이 되돌려 링크가 새는 일이 없다(코덱스 검토)
      await q.query(`update ai_commands set status = $5, applied_at = now(), changes = $3::jsonb, plan = $4::jsonb where id = $1 and user_id = $2`, [
        id,
        user.id,
        json(changes),
        json(cmd!.plan),
        later.length > 0 ? 'applying' : 'applied',
      ]);
    });
    if (later.length > 0) {
      const changes: Change[] = [];
      const skipped: string[] = [];
      // 무슨 일이 있어도 끝에는 applied 로(그래야 되돌릴 수 있다 — 제미나이 검토)
      try {
        for (const step of later) {
          const i = step.input;
          let share;
          try {
            share = await this.shares.create(
              user,
              {
                block_id: i.block_id,
                title: i.title,
                days: i.days,
                options: i.hide_columns?.length ? { hide_columns: i.hide_columns } : {},
              },
              undefined,
              Array.isArray(i.show_columns) ? i.show_columns : undefined,
            );
          } catch (e: any) {
            skipped.push(`공유 링크 "${i.title}"을 만들지 못했습니다: ${String(e?.message ?? e).slice(0, 200)}`);
            continue;
          }
          // 만든 것은 먼저 기록하고, 알림은 따로(알림이 실패해도 '못 만듦'이 되지 않게)
          changes.push({
            kind: 'created',
            entity: 'shares',
            id: share.id,
            label: `공유 링크 "${share.title}" (${share.url})`,
          });
          await this.notifications
            .notify(user.id, {
              source: 'system',
              title: `공유 링크를 만들었습니다: ${share.title}`,
              body: share.url,
              priority: 'info',
            })
            .catch(() => undefined);
        }
      } finally {
        // 아직 마무리 중일 때만 applied 로 — 그사이(5분 넘게 걸려 풀린 뒤) 되돌렸으면 상태를 덮지 않는다(코덱스 재검토)
        const row = await this.db.one<{ status: string }>(
          `update ai_commands set status = case when status = 'applying' then 'applied' else status end, changes = changes || $3::jsonb, skipped = coalesce(skipped, '[]'::jsonb) || $4::jsonb where id = $1 and user_id = $2 returning status`,
          [id, user.id, json(changes), json(skipped)],
        );
        // 되돌린 뒤에 늦게 생긴 링크는 바로 끈다
        if (row?.status === 'undone') for (const c of changes) if (c.kind === 'created' && c.entity === 'shares') await this.shares.revoke(user, c.id).catch(() => undefined);
      }
    }
    return this.get(user.id, id);
  }

  private async execute(q: Queryable, user: UserRow, commandId: string, step: StoredStep, boardId: string): Promise<Change[]> {
    const uid = user.id;
    const i = step.input;
    switch (step.tool) {
      case 'add_task': {
        const t = await this.items.createTask(uid, { title: i.title, due_at: i.due_at }, q, commandId);
        return [
          {
            kind: 'created',
            entity: 'tasks',
            id: t.id,
            label: `할 일 "${t.title}"`,
          },
        ];
      }
      case 'update_task': {
        const before = await q.one('select title, due_at, status, updated_at from tasks where id = $1 and user_id = $2 and deleted_at is null', [i.id, uid]);
        if (!before) bad('고치려는 할 일이 없어졌습니다.');
        await this.items.updateTask(uid, i.id, { title: i.title, due_at: i.due_at, status: i.status }, q);
        return [
          {
            kind: 'updated',
            entity: 'tasks',
            id: i.id,
            label: `할 일 "${before.title}"`,
            before,
          },
        ];
      }
      case 'add_event': {
        const e = await this.items.createEvent(uid, { title: i.title, start_at: i.start_at, end_at: i.end_at }, q, commandId);
        return [
          {
            kind: 'created',
            entity: 'events',
            id: e.id,
            label: `일정 "${e.title}"`,
          },
        ];
      }
      case 'update_event': {
        const before = await q.one('select title, start_at, end_at, updated_at from events where id = $1 and user_id = $2 and deleted_at is null', [i.id, uid]);
        if (!before) bad('고치려는 일정이 없어졌습니다.');
        await this.items.updateEvent(uid, i.id, { title: i.title, start_at: i.start_at, end_at: i.end_at }, q);
        return [
          {
            kind: 'updated',
            entity: 'events',
            id: i.id,
            label: `일정 "${before.title}"`,
            before,
          },
        ];
      }
      case 'create_block': {
        const config: Record<string, any> = {};
        if (i.text !== undefined) config.text = i.text;
        if (i.query) config.query = i.query;
        if (i.color) config.color = i.color;
        if (i.code !== undefined) config.code = i.code;
        if (i.css !== undefined) config.css = i.css;
        if (i.data) config.data = i.data;
        const b = await this.boards.createBlock(
          uid,
          {
            type: i.type,
            title: i.title,
            config,
            source_table_id: i.table_id ?? null,
            hint: i.position,
          },
          q,
          commandId,
          boardId,
        );
        return [
          {
            kind: 'created',
            entity: 'blocks',
            id: b.id,
            label: `블록 "${b.title}"`,
          },
        ];
      }
      case 'update_block': {
        const before = await q.one<{
          title: string;
          pinned: boolean;
          layout_lg: GridPos;
          config: Record<string, any>;
          updated_at: Date;
          type: string;
        }>('select title, pinned, layout_lg, config, updated_at, type from blocks where id = $1 and user_id = $2 and deleted_at is null', [i.id, uid]);
        if (!before) bad('고치려는 블록이 없어졌습니다.');
        let layout: GridPos | undefined;
        if (i.position) {
          const others = await q.query<{ layout_lg: GridPos }>('select layout_lg from blocks where user_id = $1 and deleted_at is null and id <> $2', [uid, i.id]);
          layout = placeBlock(
            others.map((o) => o.layout_lg),
            before!.layout_lg,
            i.position,
          );
        }
        // config 는 보낸 키만 바뀐다(얕은 병합). 되돌릴 때는 before.config 전체로 돌아간다.
        const config: Record<string, any> = {};
        if (i.color) config[before!.type === 'memo' ? 'color' : 'bg'] = i.color;
        if (i.title_color) config.title_color = i.title_color;
        if (i.code !== undefined) config.code = i.code;
        if (i.css !== undefined) config.css = i.css;
        if (i.data) config.data = i.data;
        if (i.task_filter) config.task_filter = i.task_filter;
        if (i.event_days) config.event_days = i.event_days;
        if (i.noti_show) config.noti_show = i.noti_show;
        await this.boards.updateBlock(
          uid,
          i.id,
          {
            title: i.title,
            pinned: i.pinned,
            layout_lg: layout,
            config: Object.keys(config).length > 0 ? config : undefined,
          },
          q,
        );
        return [
          {
            kind: 'updated',
            entity: 'blocks',
            id: i.id,
            label: `블록 "${before!.title}"`,
            before: before!,
          },
        ];
      }
      case 'delete_block': {
        const block = await q.one('select title, updated_at from blocks where id = $1 and user_id = $2 and deleted_at is null', [i.id, uid]);
        if (!block || !(await this.boards.deleteBlock(uid, i.id, q))) bad('지우려는 블록이 없어졌습니다.');
        return [
          {
            kind: 'deleted',
            entity: 'blocks',
            id: i.id,
            label: `블록 "${block.title}"`,
            before: { updated_at: block.updated_at },
          },
        ];
      }
      case 'create_table': {
        const { table } = await this.tables.create(uid, { name: i.name, columns: i.columns, rawRows: i.rows, origin: 'llm' }, q, commandId);
        const out: Change[] = [
          {
            kind: 'created',
            entity: 'data_tables',
            id: table.id,
            label: `표 "${table.name}"`,
          },
        ];
        if (i.place_block) {
          const b = await this.boards.createBlock(
            uid,
            {
              type: 'table',
              title: table.name,
              source_table_id: table.id,
              hint: i.position,
            },
            q,
            commandId,
            boardId,
          );
          out.push({
            kind: 'created',
            entity: 'blocks',
            id: b.id,
            label: `블록 "${b.title}"`,
          });
        }
        return out;
      }
      case 'create_form': {
        // Google 에 설문지를 만든다. 이 한 걸음은 되돌릴 수 없다(되돌리기는 표와 블록만 휴지통으로 보낸다).
        const { table, form } = await this.connectors.createForm(uid, i.spec as FormSpec, q, commandId);
        const out: Change[] = [
          {
            kind: 'created',
            entity: 'data_tables',
            id: table.id,
            label: `설문 "${form.title}"의 응답 표`,
          },
        ];
        if (i.place_block) {
          const b = await this.boards.createBlock(
            uid,
            {
              type: 'table',
              title: table.name,
              source_table_id: table.id,
              hint: i.position,
            },
            q,
            commandId,
            boardId,
          );
          out.push({
            kind: 'created',
            entity: 'blocks',
            id: b.id,
            label: `블록 "${b.title}"`,
          });
        }
        await this.notifications.notify(
          uid,
          {
            source: 'google_forms',
            title: `설문을 만들었습니다: ${form.title}`,
            body: `응답 링크: ${form.responder_uri}${form.public_link ? '' : '\n링크만으로 응답할 수 있게 여는 데는 실패했습니다. 설문지의 게시 설정에서 응답자를 확인하세요.'}`,
            priority: 'info',
            ref: { table_id: table.id },
          },
          q,
        );
        return out;
      }
      case 'add_links': {
        if (i.block_id) {
          const before = await q.one<{ title: string; pinned: boolean; layout_lg: GridPos; config: Record<string, any>; updated_at: Date; type: string }>(
            "select title, pinned, layout_lg, config, updated_at, type from blocks where id = $1 and user_id = $2 and deleted_at is null and type = 'links' for update",
            [i.block_id, uid],
          );
          if (!before) bad('담으려는 수업 자료 블록이 없어졌습니다.');
          const old: any[] = Array.isArray(before!.config.items) ? before!.config.items : [];
          const urls = new Set(old.map((x) => String(x?.url)));
          const merged = checkLinkItems([...old, ...i.items.filter((x: any) => !urls.has(String(x?.url)))]);
          if (!merged.ok) bad(merged.error);
          await this.boards.updateBlock(uid, i.block_id, { config: { items: merged.items } }, q);
          return [{ kind: 'updated', entity: 'blocks', id: i.block_id, label: `블록 "${before!.title}"`, before: before! }];
        }
        const b = await this.boards.createBlock(uid, { type: 'links', title: i.title, config: { items: i.items } }, q, commandId, boardId);
        return [{ kind: 'created', entity: 'blocks', id: b.id, label: `블록 "${b.title}"` }];
      }
      case 'create_quiz': {
        const quiz = await this.quizzes.create(uid, i.spec as QuizSpec, q, commandId, i.minutes, i.mode === 'google' ? 'google' : 'board');
        const b = await this.boards.createBlock(uid, { type: 'quiz', title: quiz.title, config: { quiz_id: quiz.id } }, q, commandId, boardId);
        return [
          { kind: 'created', entity: 'quizzes', id: quiz.id, label: `퀴즈 "${quiz.title}"` },
          { kind: 'created', entity: 'blocks', id: b.id, label: `블록 "${b.title}"` },
        ];
      }
      case 'add_rows': {
        const table = await this.tables.require(uid, i.table_id, q);
        const count = await this.tables.addRows(uid, i.table_id, i.rows, q, commandId);
        return [
          {
            kind: 'rows_added',
            table_id: i.table_id,
            count,
            label: `표 "${table.name}"의 행 ${count}개`,
          },
        ];
      }
      case 'mark_notifications': {
        const before = await q.query<{
          id: string;
          status: string;
          title: string;
        }>('select id, status, title from notifications where user_id = $1 and id = any($2::uuid[])', [uid, i.ids]);
        await this.notifications.setStatus(uid, i.ids, i.status, q);
        return before.map((n) => ({
          kind: 'updated' as const,
          entity: 'notifications' as const,
          id: n.id,
          label: `알림 "${n.title}"`,
          before: { status: n.status },
        }));
      }
      case 'create_menu': {
        // 계획을 만든 보드의 메뉴로(보드마다 따로)
        const menuKind = boardKindOf((await q.one<{ kind: string }>('select kind from boards where id = $1', [boardId]))?.kind);
        const { made, tables } = await this.menus.createIn(q, uid, [i], commandId, menuKind);
        const out: Change[] = tables.map((t) => ({
          kind: 'created' as const,
          entity: 'data_tables' as const,
          id: t.id,
          label: `표 "${t.name}"`,
        }));
        for (const m of made)
          out.push({
            kind: 'created',
            entity: 'menu_items',
            id: m.id,
            label: `메뉴 "${m.label}"`,
          });
        return out;
      }
      case 'update_menu': {
        const before = await q.one<MenuItemDto & { updated_at: Date }>('select id, position, label, icon, description, action, pinned, updated_at from menu_items where id = $1 and user_id = $2', [
          i.id,
          uid,
        ]);
        if (!before) bad('고치려는 메뉴가 없어졌습니다.');
        // 순서와 함께 각 메뉴의 고친 시각도 남긴다 — 되돌릴 때 원래대로 돌려야 더 앞선 명령도 이어서 되돌릴 수 있다
        const order = await q.query<{ id: string; updated_at: string }>('select id, updated_at from menu_items where user_id = $1 order by position, created_at', [uid]);
        await q.query(
          'update menu_items set label = coalesce($3, label), icon = coalesce($4, icon), description = coalesce($5, description), pinned = coalesce($6, pinned), updated_at = now() where id = $1 and user_id = $2',
          [i.id, uid, i.label ?? null, i.icon ?? null, i.description ?? null, typeof i.pinned === 'boolean' ? i.pinned : null],
        );
        // 고정하면 맨 위로(순서를 따로 주지 않았을 때)
        if (i.pinned === true && i.index === undefined) await this.menus.moveIn(q, uid, i.id, 0);
        if (i.index !== undefined) await this.menus.moveIn(q, uid, i.id, i.index);
        return [
          {
            kind: 'updated',
            entity: 'menu_items',
            id: i.id,
            label: `메뉴 "${before!.label}"`,
            before: { ...before!, order },
          },
        ];
      }
      case 'delete_menu': {
        const before = await q.one<MenuItemDto & { updated_at: Date }>('select id, position, label, icon, description, action, updated_at, board_kind from menu_items where id = $1 and user_id = $2', [
          i.id,
          uid,
        ]);
        if (!before) bad('지우려는 메뉴가 없어졌습니다.');
        await q.query('delete from menu_items where id = $1 and user_id = $2', [i.id, uid]);
        return [
          {
            kind: 'deleted',
            entity: 'menu_items',
            id: i.id,
            label: `메뉴 "${before!.label}"`,
            before: before!,
          },
        ];
      }
      case 'edit_file': {
        const src = await this.files.source(uid, i.file_id, q);
        const { file } = src.ext === '.xlsx' ? await applyXlsxEdits(src.buffer, i.edits) : await applyHwpxEdits(src.buffer, i.edits);
        const id = await this.files.saveResult(uid, i.name, file!, q);
        return [
          {
            kind: 'file_made',
            upload_id: id,
            name: i.name,
            label: `고친 파일 "${i.name}"`,
          },
        ];
      }
      case 'remember': {
        const m = await this.memory.add(uid, i.text, q);
        return [
          {
            kind: 'created',
            entity: 'memories',
            id: m.id,
            label: `기억 "${m.text.slice(0, 40)}"`,
          },
        ];
      }
      case 'forget': {
        const m = await this.memory.remove(uid, i.id, q);
        return [
          {
            kind: 'deleted',
            entity: 'memories',
            id: m.id,
            label: `기억 "${m.text.slice(0, 40)}"`,
            before: m,
          },
        ];
      }
      default:
        return bad(`알 수 없는 단계입니다: ${step.tool}`);
    }
  }

  /**
   * 되돌리기(ONE-13). 최근 명령부터 역순으로만 되돌린다.
   * 적용 뒤 사용자가 직접 고친 항목은 덮어쓰지 않고 건너뛴 뒤 목록으로 알려 준다.
   */
  async undo(user: UserRow, id: string): Promise<CommandDto> {
    const uid = user.id;
    // 공유 링크 끄기는 바깥 일도 해서 트랜잭션이 끝난 뒤에(apply 와 같은 까닭)
    const revokeLater: { id: string; label: string }[] = [];
    await this.db.tx(async (q) => {
      const cmd = await q.one<{ changes: Change[] }>(`select changes from ai_commands where id = $1 and user_id = $2 and status = 'applied' for update`, [id, uid]);
      if (!cmd) bad('되돌릴 수 있는 상태가 아닙니다.');
      // 마무리 중(applying)인 명령이 있으면 그보다 앞선 것을 먼저 되돌리지 않는다(제미나이 검토)
      const latest = await q.one<{ id: string }>(`select id from ai_commands where user_id = $1 and status in ('applied', 'applying') order by applied_at desc, id desc limit 1`, [uid]);
      if (latest?.id !== id) bad('최근에 적용한 명령부터 차례로 되돌릴 수 있습니다.');
      // 적용 시각과의 비교는 DB 안에서 한다(시각을 JS로 가져오면 마이크로초가 잘려 비교가 틀어진다).
      const appliedAt = '(select applied_at from ai_commands where id = $3)';
      const skipped: string[] = [];
      // 행을 잠그고(for update) 비교한다 — 비교와 되돌리기 사이에 다른 탭이 고쳐도 덮어쓰지 않게(코덱스 검토).
      // 표는 그 안의 줄을 적용 뒤에 더하거나 고쳤어도 '고친 것'으로 본다(줄을 고쳐도 표의 updated_at 은 그대로라서 — 코덱스·제미나이 검토).
      const touchedLater = async (entity: Entity, rowId: string) => {
        if (entity === 'notifications') return false;
        // 고치지 않은 줄도 잠근다 — 잠근 채 비교해야 되돌리기 전 다른 탭의 고침을 덮지 않는다(제미나이 재검토)
        if ((await q.one<{ hit: boolean }>(`select (updated_at > ${appliedAt}) as hit from ${entity} where id = $1 and user_id = $2 for update`, [rowId, uid, id]))?.hit) return true;
        if (entity === 'data_tables')
          return (await q.one(`select 1 as hit from data_rows where table_id = $1 and user_id = $2 and (updated_at > ${appliedAt} or created_at > ${appliedAt}) limit 1`, [rowId, uid, id])) !== null;
        return false;
      };

      for (const change of [...cmd!.changes].reverse()) {
        // 고친 파일은 원본을 건드리지 않았으니 만든 파일만 치운다
        if (change.kind === 'file_made') {
          // 기록을 지우면 하루 뒤 정리가 디스크 파일을 못 찾는다 — 내려받기만 막고 정리는 일꾼에게(코덱스 검토)
          if (isUuid(change.upload_id)) await q.query(`update uploads set kind = 'edit_removed' where id = $1 and user_id = $2 and kind = 'edit_result'`, [change.upload_id, uid]);
          continue;
        }
        if (change.kind !== 'rows_added' && !ENTITIES.includes(change.entity)) bad('되돌리기 기록이 잘못됐습니다.');
        if (change.kind === 'rows_added') {
          await q.query(`update data_rows set deleted_at = now() where table_id = $1 and user_id = $2 and command_id = $3 and deleted_at is null and updated_at <= ${appliedAt}`, [
            change.table_id,
            uid,
            id,
          ]);
          const left = await q.one<{ n: number }>('select count(*)::int as n from data_rows where command_id = $1 and table_id = $2 and deleted_at is null', [id, change.table_id]);
          if (left && left.n > 0) skipped.push(`${change.label} 중 적용 뒤에 고친 ${left.n}개`);
          continue;
        }
        // 내 메뉴·공유 링크는 휴지통이 없어 따로 되돌린다(2026-11-28)
        if (change.entity === 'shares') {
          if (change.kind === 'created') revokeLater.push({ id: change.id, label: change.label });
          continue;
        }
        // 퀴즈: 학생 응답이 들어왔으면 지우지 않는다(되돌리기로 학생 답이 사라지지 않게), 없으면 지운다
        if (change.entity === 'quizzes') {
          // 학생 제출과 차례를 세운다(제출도 이 줄을 잠근다) — 0개를 본 뒤 들어온 답이 지운 퀴즈에 남지 않게
          await q.query('select id from quizzes where id = $1 and user_id = $2 for update', [change.id, uid]);
          const n = (await q.one<{ n: number }>('select count(*)::int as n from quiz_responses where quiz_id = $1 and user_id = $2', [change.id, uid]))?.n ?? 0;
          const google = (await q.one<{ source: string }>('select source from quizzes where id = $1 and user_id = $2', [change.id, uid]))?.source === 'google';
          if (google && n === 0) skipped.push(`${change.label}의 구글 설문지(드라이브에 남음 — 필요 없으면 드라이브에서 지우세요)`);
          if (n > 0) {
            skipped.push(`${change.label}(학생 응답 ${n}개가 있어 퀴즈와 블록을 남겨 둠 — 블록에서 마감하세요)`);
            // 앞서(거꾸로 도는 차례) 휴지통으로 간 이 퀴즈의 블록을 되살린다
            await q.query("update blocks set deleted_at = null where user_id = $1 and type = 'quiz' and config->>'quiz_id' = $2 and command_id = $3", [uid, change.id, id]);
          } else await q.query('update quizzes set deleted_at = now(), updated_at = now() where id = $1 and user_id = $2', [change.id, uid]);
          continue;
        }
        if (change.entity === 'memories') {
          if (change.kind === 'created' && (await touchedLater('memories', change.id))) {
            skipped.push(`${change.label}(적용 뒤에 고침)`);
            continue;
          }
          if (change.kind === 'created') await q.query('delete from memories where id = $1 and user_id = $2', [change.id, uid]);
          else if (change.kind === 'deleted' && change.before)
            await q.query('insert into memories(id, user_id, text, created_at) values ($1, $2, $3, $4) on conflict (id) do nothing', [change.id, uid, change.before.text, change.before.created_at]);
          continue;
        }
        if (change.entity === 'menu_items') {
          if (change.kind === 'created' && (await touchedLater('menu_items', change.id))) {
            skipped.push(`${change.label}(적용 뒤에 고침)`);
            continue;
          }
          if (change.kind === 'created') await q.query('delete from menu_items where id = $1 and user_id = $2', [change.id, uid]);
          else if (change.kind === 'deleted') {
            const b = change.before!;
            await q.query(
              'insert into menu_items(id, user_id, position, label, icon, description, action, updated_at, board_kind) values ($1, $2, $3, $4, $5, $6, $7::jsonb, coalesce($8::timestamptz, now()), $9) on conflict (id) do nothing',
              [change.id, uid, b.position, b.label, b.icon, b.description, json(b.action), b.updated_at ?? null, boardKindOf(b.board_kind)],
            );
            // 자리가 겹치지 않게 순서를 다시 매긴다
            await q.query(
              `update menu_items m set position = o.n from (select id, row_number() over (partition by board_kind order by position, created_at) - 1 as n from menu_items where user_id = $1) o where m.id = o.id`,
              [uid],
            );
          } else {
            const b = change.before;
            if (await touchedLater('menu_items', change.id)) {
              skipped.push(change.label);
              continue;
            }
            await q.query('update menu_items set label = $3, icon = $4, description = $5, pinned = coalesce($7, pinned), updated_at = $6 where id = $1 and user_id = $2', [
              change.id,
              uid,
              b.label,
              b.icon,
              b.description,
              b.updated_at,
              typeof b.pinned === 'boolean' ? b.pinned : null,
            ]);
            // 순서는 적용 뒤에 사용자가 메뉴를 다시 늘어놓지 않았을 때만 되돌린다(늘어놓기도 updated_at 을 남긴다)
            if (Array.isArray(b.order)) {
              const later = await q.one(`select 1 as hit from menu_items where user_id = $1 and id <> $2 and updated_at > ${appliedAt}`, [uid, change.id, id]);
              if (later) skipped.push(`${change.label}의 순서(적용 뒤에 다시 늘어놓음)`);
              else
                for (const [n, o] of (b.order as ({ id: string; updated_at: string } | string)[]).entries()) {
                  const mid = typeof o === 'string' ? o : o.id;
                  const at = typeof o === 'string' ? null : o.updated_at;
                  await q.query('update menu_items set position = $3, updated_at = coalesce($4::timestamptz, updated_at) where id = $1 and user_id = $2', [mid, uid, n, at]);
                }
            }
          }
          continue;
        }
        if (await touchedLater(change.entity, change.id)) {
          skipped.push(change.label);
          continue;
        }
        // 되돌릴 때는 수정 시각도 원래대로 돌린다. 그래야 더 앞선 명령을 이어서 되돌릴 수 있다.
        const was = change.kind === 'created' ? null : (change.before?.updated_at ?? null);
        if (change.kind === 'created') {
          await q.query(`update ${change.entity} set deleted_at = now() where id = $1 and user_id = $2 and deleted_at is null`, [change.id, uid]);
        } else if (change.kind === 'deleted') {
          await q.query(`update ${change.entity} set deleted_at = null, updated_at = coalesce($3::timestamptz, updated_at) where id = $1 and user_id = $2`, [change.id, uid, was]);
        } else {
          const b = change.before;
          if (change.entity === 'tasks')
            await q.query('update tasks set title = $3, due_at = $4, status = $5, updated_at = coalesce($6::timestamptz, updated_at) where id = $1 and user_id = $2', [
              change.id,
              uid,
              b.title,
              b.due_at,
              b.status,
              was,
            ]);
          else if (change.entity === 'events')
            await q.query('update events set title = $3, start_at = $4, end_at = $5, updated_at = coalesce($6::timestamptz, updated_at) where id = $1 and user_id = $2', [
              change.id,
              uid,
              b.title,
              b.start_at,
              b.end_at,
              was,
            ]);
          else if (change.entity === 'blocks')
            await q.query(
              'update blocks set title = $3, pinned = $4, layout_lg = $5::jsonb, config = coalesce($7::jsonb, config), updated_at = coalesce($6::timestamptz, updated_at) where id = $1 and user_id = $2',
              [change.id, uid, b.title, b.pinned, json(b.layout_lg), was, b.config ? json(b.config) : null],
            );
          else if (change.entity === 'notifications') await q.query('update notifications set status = $3 where id = $1 and user_id = $2', [change.id, uid, b.status]);
        }
      }
      await q.query(`update ai_commands set status = 'undone', undone_at = now(), skipped = $3::jsonb where id = $1 and user_id = $2`, [id, uid, json(skipped)]);
    });
    const failed: string[] = [];
    for (const r of revokeLater) await this.shares.revoke(user, r.id).catch(() => failed.push(`${r.label}(끄지 못함 — 공유 링크 창에서 끄세요)`));
    if (failed.length > 0) await this.db.query(`update ai_commands set skipped = skipped || $3::jsonb where id = $1 and user_id = $2`, [id, uid, json(failed)]);
    return this.get(uid, id);
  }
}
