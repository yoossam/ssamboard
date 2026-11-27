import { Injectable } from '@nestjs/common';
import {
  BLOCK_LABEL,
  BLOCK_TYPES,
  checkFormSpec,
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
} from '@jarvis/shared';
import type { UserRow } from '../auth/auth.types';
import { BoardsService } from '../boards/boards.service';
import { bad, isUuid, notFound } from '../common/http';
import { ConnectorsService } from '../connectors/connectors.service';
import { Db, json, type Queryable } from '../db/db.service';
import { ItemsService } from '../items/items.service';
import { NotificationsService } from '../notifications/notifications.service';
import { checkColumnDefs, TablesService } from '../tables/tables.service';

/** 계획에 저장하는 한 단계. title·detail·preview는 화면에 보여 주는 요약이다. */
export interface StoredStep {
  tool: string;
  input: Record<string, any>;
  title: string;
  detail: string;
  preview?: TablePreview;
}

type Entity = 'tasks' | 'events' | 'blocks' | 'data_tables' | 'notifications';
type Change =
  | { kind: 'created'; entity: Entity; id: string; label: string }
  | { kind: 'updated'; entity: Entity; id: string; label: string; before: Record<string, any> }
  | { kind: 'deleted'; entity: Entity; id: string; label: string; before?: Record<string, any> }
  | { kind: 'rows_added'; table_id: string; count: number; label: string };

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
  if (input.html !== undefined) return { ok: false, error: 'html은 쓰지 않습니다. code(render(data, size)가 HTML·SVG 글자를 돌려주는 코드)와 css로 나눠 주세요.' };
  if (input.code !== undefined || needCode) {
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    if (!code) return { ok: false, error: 'view에는 code(그리기 코드)가 필요합니다.' };
    if (code.length > VIEW_CODE_MAX) return { ok: false, error: `code가 너무 깁니다(최대 ${VIEW_CODE_MAX.toLocaleString()}자). 자료를 코드에 적지 말고 data로 받으세요.` };
    if (!/\brender\b/.test(code)) return { ok: false, error: 'code에는 function render(data, size)가 있어야 합니다.' };
    out.code = code;
  }
  if (input.css !== undefined) {
    if (typeof input.css !== 'string') return { ok: false, error: 'css는 글자여야 합니다.' };
    if (input.css.length > VIEW_CSS_MAX) return { ok: false, error: `css가 너무 깁니다(최대 ${VIEW_CSS_MAX.toLocaleString()}자).` };
    out.css = input.css;
  }
  return out;
}
const HINT_LABEL: Record<PlaceHint, string> = { 'top-left': '왼쪽 위', 'top-right': '오른쪽 위', 'bottom-left': '왼쪽 아래', 'bottom-right': '오른쪽 아래' };

export function formatWhen(isoTime: string, timezone: string): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: timezone, month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(isoTime),
  );
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
  ) {}

  /** 화면 블록이 받을 자료 정의를 확인한다. 표 자료면 그 표가 이 사용자의 것인지와 query까지 본다. */
  private async prepareViewData(uid: string, input: unknown): Promise<{ ok: true; data: ViewData; label: string } | { ok: false; error: string }> {
    const wanted = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const table = wanted.kind === 'table' && isUuid(wanted.table_id) ? await this.tables.get(uid, wanted.table_id as string) : null;
    const checked = checkViewData(input, (id) => (table && table.id === id ? table.schema : null));
    if (!checked.ok) return checked;
    return { ok: true, data: checked.data, label: checked.data.kind === 'table' ? `표 "${table!.name}"` : VIEW_DATA_LABEL[checked.data.kind] };
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
        return { ok: true, step: { tool, input: { title, due_at: due }, title: '할 일 추가', detail: due ? `${title} · ${formatWhen(due, tz)}까지` : title } };
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
        return { ok: true, step: { tool, input: patch, title: '할 일 변경', detail: `${task.title} · ${notes.join(', ')}` } };
      }
      case 'add_event': {
        const title = text(input.title);
        if (!title) return fail('title이 필요합니다.');
        if (!isIso(input.start_at)) return fail('start_at은 ISO 8601 시각이어야 합니다.');
        if (input.end_at != null && !isIso(input.end_at)) return fail('end_at은 ISO 8601 시각이어야 합니다.');
        const start = new Date(input.start_at).toISOString();
        const end = input.end_at ? new Date(input.end_at).toISOString() : null;
        return { ok: true, step: { tool, input: { title, start_at: start, end_at: end }, title: '일정 추가', detail: `${formatWhen(start, tz)} ${title}` } };
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
        return { ok: true, step: { tool, input: patch, title: '일정 변경', detail: `${event.title} · ${notes.join(', ') || '끝 시각 지움'}` } };
      }
      case 'create_block': {
        if (!BLOCK_TYPES.includes(input.type)) return fail(`type은 ${BLOCK_TYPES.join(', ')} 중 하나입니다.`);
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
            step: { tool, input: { type, title: name, code: source.code, css: source.css ?? '', data: data.data, position: at }, title: '새 블록', detail: `${name} · ${BLOCK_LABEL.view} · 자료: ${data.label}${at ? ` · ${HINT_LABEL[at]}` : ''}` },
          };
        }
        if (input.code !== undefined || input.css !== undefined || input.html !== undefined || input.data !== undefined) return fail('code·css·data는 type이 view일 때만 쓸 수 있습니다.');
        const out: Record<string, any> = { type, position: hint(input.position) };
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
          if (!isMemoColor(input.color)) return fail(`color는 ${MEMO_COLORS.join(', ')} 중 하나입니다.`);
          out.color = input.color;
        }
        out.title = title || BLOCK_LABEL[type];
        const where = out.position ? ` · ${HINT_LABEL[out.position as PlaceHint]}` : '';
        const paper = out.color ? ` · ${MEMO_COLOR_LABEL[out.color as MemoColor]}` : '';
        return { ok: true, step: { tool, input: out, title: '새 블록', detail: `${out.title} · ${out.query ? '서버 집계' : BLOCK_LABEL[type]}${paper}${where}` } };
      }
      case 'update_block':
      case 'delete_block': {
        if (!isUuid(input.id)) return fail('id가 잘못됐습니다. get_board로 확인하세요.');
        const block = await this.db.one<{ title: string; type: BlockType }>('select title, type from blocks where id = $1 and user_id = $2 and deleted_at is null', [input.id, uid]);
        if (!block) return fail('그런 블록이 없습니다. get_board로 다시 확인하세요.');
        if (tool === 'delete_block') return { ok: true, step: { tool, input: { id: input.id }, title: '블록 삭제', detail: `${block.title} · 휴지통으로` } };
        const patch: Record<string, any> = { id: input.id };
        const notes: string[] = [];
        if (text(input.title, 60)) notes.push(`제목 → ${(patch.title = text(input.title, 60))}`);
        if (typeof input.pinned === 'boolean') notes.push((patch.pinned = input.pinned) ? '고정' : '고정 해제');
        if (hint(input.position)) notes.push(`${HINT_LABEL[(patch.position = hint(input.position)!)]}로 이동`);
        if (input.color !== undefined) {
          if (block.type !== 'memo') return fail('color는 메모 블록에만 쓸 수 있습니다.');
          if (!isMemoColor(input.color)) return fail(`color는 ${MEMO_COLORS.join(', ')} 중 하나입니다.`);
          notes.push(`색 → ${MEMO_COLOR_LABEL[(patch.color = input.color as MemoColor)]}`);
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
        return { ok: true, step: { tool, input: patch, title: '블록 변경', detail: `${block.title} · ${notes.join(', ')}` } };
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
        const out = { name, columns, rows, place_block: input.place_block !== false, position: hint(input.position) };
        return {
          ok: true,
          step: {
            tool,
            input: out,
            title: '새 표',
            detail: `${name} · 컬럼 ${columns.length}개 · ${rows.length}행${out.place_block ? ' · 보드에 배치' : ''}`,
            preview: { name, columns, rows: rows.slice(0, 20), total: rows.length },
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
            input: { spec, place_block: input.place_block !== false, position: at },
            title: '설문 만들기',
            detail: `${spec.title} · 질문 ${names.length}개(${names.slice(0, 3).join(', ')}${names.length > 3 ? ' …' : ''}) · Google 설문지와 응답 표${at ? ` · ${HINT_LABEL[at]}` : ''}`,
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
        return { ok: true, step: { tool, input: { table_id: table.id, rows: input.rows }, title: '행 추가', detail: `${table.name}에 ${input.rows.length}행` } };
      }
      case 'mark_notifications': {
        const ids = Array.isArray(input.ids) ? input.ids.filter(isUuid) : [];
        if (ids.length === 0) return fail('ids가 비어 있습니다. list_notifications로 확인하세요.');
        if (input.status !== 'read' && input.status !== 'archived') return fail('status는 read 또는 archived입니다.');
        return { ok: true, step: { tool, input: { ids, status: input.status }, title: '알림 정리', detail: `${ids.length}건 ${input.status === 'read' ? '읽음 처리' : '보관'}` } };
      }
      default:
        return fail(`알 수 없는 도구입니다: ${tool}`);
    }
  }

  async propose(userId: string, messageId: string | null, steps: StoredStep[]): Promise<CommandDto> {
    const row = (await this.db.one<{ id: string }>('insert into ai_commands(user_id, message_id, plan) values ($1, $2, $3::jsonb) returning id', [userId, messageId, json(steps)]))!;
    return this.view({ id: row.id, status: 'proposed', plan: steps, skipped: [] });
  }

  private view(row: { id: string; status: string; plan: StoredStep[]; skipped: string[] }): CommandDto {
    return {
      id: row.id,
      status: row.status as CommandDto['status'],
      steps: row.plan.map((s, index) => ({ index, tool: s.tool, title: s.title, detail: s.detail, preview: s.preview })),
      skipped: row.skipped ?? [],
    };
  }

  async get(userId: string, id: string): Promise<CommandDto> {
    const row = await this.db.one('select id, status, plan, skipped from ai_commands where id = $1 and user_id = $2', [id, userId]);
    return this.view(row ?? notFound('명령'));
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
    await this.db.tx(async (q) => {
      const cmd = await q.one<{ plan: StoredStep[] }>(`select plan from ai_commands where id = $1 and user_id = $2 and status = 'proposed' for update`, [id, user.id]);
      if (!cmd) bad('이미 처리했거나 없는 계획입니다.');
      const changes: Change[] = [];
      for (const [index, step] of cmd!.plan.entries()) {
        const edit = edits[String(index)];
        if (step.tool === 'create_table' && edit) {
          if (edit.name) step.input.name = text(edit.name, 80) || step.input.name;
          if (edit.columns) {
            const columns = checkColumnDefs(edit.columns);
            if (columns.length !== step.input.columns.length) bad('컬럼 수는 미리보기와 같아야 합니다.');
            step.input.columns = columns;
          }
        }
        changes.push(...(await this.execute(q, user, id, step)));
      }
      // applied_at을 마지막에 적는다. 이 뒤에 updated_at이 더 늦어진 항목은 "적용 뒤에 고친 것"이다.
      await q.query(`update ai_commands set status = 'applied', applied_at = now(), changes = $3::jsonb, plan = $4::jsonb where id = $1 and user_id = $2`, [
        id,
        user.id,
        json(changes),
        json(cmd!.plan),
      ]);
    });
    return this.get(user.id, id);
  }

  private async execute(q: Queryable, user: UserRow, commandId: string, step: StoredStep): Promise<Change[]> {
    const uid = user.id;
    const i = step.input;
    switch (step.tool) {
      case 'add_task': {
        const t = await this.items.createTask(uid, { title: i.title, due_at: i.due_at }, q, commandId);
        return [{ kind: 'created', entity: 'tasks', id: t.id, label: `할 일 "${t.title}"` }];
      }
      case 'update_task': {
        const before = await q.one('select title, due_at, status, updated_at from tasks where id = $1 and user_id = $2 and deleted_at is null', [i.id, uid]);
        if (!before) bad('고치려는 할 일이 없어졌습니다.');
        await this.items.updateTask(uid, i.id, { title: i.title, due_at: i.due_at, status: i.status }, q);
        return [{ kind: 'updated', entity: 'tasks', id: i.id, label: `할 일 "${before.title}"`, before }];
      }
      case 'add_event': {
        const e = await this.items.createEvent(uid, { title: i.title, start_at: i.start_at, end_at: i.end_at }, q, commandId);
        return [{ kind: 'created', entity: 'events', id: e.id, label: `일정 "${e.title}"` }];
      }
      case 'update_event': {
        const before = await q.one('select title, start_at, end_at, updated_at from events where id = $1 and user_id = $2 and deleted_at is null', [i.id, uid]);
        if (!before) bad('고치려는 일정이 없어졌습니다.');
        await this.items.updateEvent(uid, i.id, { title: i.title, start_at: i.start_at, end_at: i.end_at }, q);
        return [{ kind: 'updated', entity: 'events', id: i.id, label: `일정 "${before.title}"`, before }];
      }
      case 'create_block': {
        const config: Record<string, any> = {};
        if (i.text !== undefined) config.text = i.text;
        if (i.query) config.query = i.query;
        if (i.color) config.color = i.color;
        if (i.code !== undefined) config.code = i.code;
        if (i.css !== undefined) config.css = i.css;
        if (i.data) config.data = i.data;
        const b = await this.boards.createBlock(uid, { type: i.type, title: i.title, config, source_table_id: i.table_id ?? null, hint: i.position }, q, commandId);
        return [{ kind: 'created', entity: 'blocks', id: b.id, label: `블록 "${b.title}"` }];
      }
      case 'update_block': {
        const before = await q.one<{ title: string; pinned: boolean; layout_lg: GridPos; config: Record<string, any>; updated_at: Date }>(
          'select title, pinned, layout_lg, config, updated_at from blocks where id = $1 and user_id = $2 and deleted_at is null',
          [i.id, uid],
        );
        if (!before) bad('고치려는 블록이 없어졌습니다.');
        let layout: GridPos | undefined;
        if (i.position) {
          const others = await q.query<{ layout_lg: GridPos }>('select layout_lg from blocks where user_id = $1 and deleted_at is null and id <> $2', [uid, i.id]);
          layout = placeBlock(others.map((o) => o.layout_lg), before!.layout_lg, i.position);
        }
        // config 는 보낸 키만 바뀐다(얕은 병합). 되돌릴 때는 before.config 전체로 돌아간다.
        const config: Record<string, any> = {};
        if (i.color) config.color = i.color;
        if (i.code !== undefined) config.code = i.code;
        if (i.css !== undefined) config.css = i.css;
        if (i.data) config.data = i.data;
        await this.boards.updateBlock(uid, i.id, { title: i.title, pinned: i.pinned, layout_lg: layout, config: Object.keys(config).length > 0 ? config : undefined }, q);
        return [{ kind: 'updated', entity: 'blocks', id: i.id, label: `블록 "${before!.title}"`, before: before! }];
      }
      case 'delete_block': {
        const block = await q.one('select title, updated_at from blocks where id = $1 and user_id = $2 and deleted_at is null', [i.id, uid]);
        if (!block || !(await this.boards.deleteBlock(uid, i.id, q))) bad('지우려는 블록이 없어졌습니다.');
        return [{ kind: 'deleted', entity: 'blocks', id: i.id, label: `블록 "${block.title}"`, before: { updated_at: block.updated_at } }];
      }
      case 'create_table': {
        const { table } = await this.tables.create(uid, { name: i.name, columns: i.columns, rawRows: i.rows, origin: 'llm' }, q, commandId);
        const out: Change[] = [{ kind: 'created', entity: 'data_tables', id: table.id, label: `표 "${table.name}"` }];
        if (i.place_block) {
          const b = await this.boards.createBlock(uid, { type: 'table', title: table.name, source_table_id: table.id, hint: i.position }, q, commandId);
          out.push({ kind: 'created', entity: 'blocks', id: b.id, label: `블록 "${b.title}"` });
        }
        return out;
      }
      case 'create_form': {
        // Google 에 설문지를 만든다. 이 한 걸음은 되돌릴 수 없다(되돌리기는 표와 블록만 휴지통으로 보낸다).
        const { table, form } = await this.connectors.createForm(uid, i.spec as FormSpec, q, commandId);
        const out: Change[] = [{ kind: 'created', entity: 'data_tables', id: table.id, label: `설문 "${form.title}"의 응답 표` }];
        if (i.place_block) {
          const b = await this.boards.createBlock(uid, { type: 'table', title: table.name, source_table_id: table.id, hint: i.position }, q, commandId);
          out.push({ kind: 'created', entity: 'blocks', id: b.id, label: `블록 "${b.title}"` });
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
      case 'add_rows': {
        const table = await this.tables.require(uid, i.table_id, q);
        const count = await this.tables.addRows(uid, i.table_id, i.rows, q, commandId);
        return [{ kind: 'rows_added', table_id: i.table_id, count, label: `표 "${table.name}"의 행 ${count}개` }];
      }
      case 'mark_notifications': {
        const before = await q.query<{ id: string; status: string; title: string }>('select id, status, title from notifications where user_id = $1 and id = any($2::uuid[])', [uid, i.ids]);
        await this.notifications.setStatus(uid, i.ids, i.status, q);
        return before.map((n) => ({ kind: 'updated' as const, entity: 'notifications' as const, id: n.id, label: `알림 "${n.title}"`, before: { status: n.status } }));
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
    await this.db.tx(async (q) => {
      const cmd = await q.one<{ changes: Change[] }>(`select changes from ai_commands where id = $1 and user_id = $2 and status = 'applied' for update`, [id, uid]);
      if (!cmd) bad('되돌릴 수 있는 상태가 아닙니다.');
      const latest = await q.one<{ id: string }>(`select id from ai_commands where user_id = $1 and status = 'applied' order by applied_at desc limit 1`, [uid]);
      if (latest?.id !== id) bad('최근에 적용한 명령부터 차례로 되돌릴 수 있습니다.');
      // 적용 시각과의 비교는 DB 안에서 한다(시각을 JS로 가져오면 마이크로초가 잘려 비교가 틀어진다).
      const appliedAt = '(select applied_at from ai_commands where id = $3)';
      const skipped: string[] = [];
      const touchedLater = async (entity: Entity, rowId: string) =>
        entity !== 'notifications' && (await q.one(`select 1 as hit from ${entity} where id = $1 and user_id = $2 and updated_at > ${appliedAt}`, [rowId, uid, id])) !== null;

      for (const change of [...cmd!.changes].reverse()) {
        if (change.kind === 'rows_added') {
          await q.query(
            `update data_rows set deleted_at = now() where table_id = $1 and user_id = $2 and command_id = $3 and deleted_at is null and updated_at <= ${appliedAt}`,
            [change.table_id, uid, id],
          );
          const left = await q.one<{ n: number }>('select count(*)::int as n from data_rows where command_id = $1 and table_id = $2 and deleted_at is null', [id, change.table_id]);
          if (left && left.n > 0) skipped.push(`${change.label} 중 적용 뒤에 고친 ${left.n}개`);
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
            await q.query('update tasks set title = $3, due_at = $4, status = $5, updated_at = coalesce($6::timestamptz, updated_at) where id = $1 and user_id = $2', [change.id, uid, b.title, b.due_at, b.status, was]);
          else if (change.entity === 'events')
            await q.query('update events set title = $3, start_at = $4, end_at = $5, updated_at = coalesce($6::timestamptz, updated_at) where id = $1 and user_id = $2', [change.id, uid, b.title, b.start_at, b.end_at, was]);
          else if (change.entity === 'blocks')
            await q.query('update blocks set title = $3, pinned = $4, layout_lg = $5::jsonb, config = coalesce($7::jsonb, config), updated_at = coalesce($6::timestamptz, updated_at) where id = $1 and user_id = $2', [change.id, uid, b.title, b.pinned, json(b.layout_lg), was, b.config ? json(b.config) : null]);
          else if (change.entity === 'notifications') await q.query('update notifications set status = $3 where id = $1 and user_id = $2', [change.id, uid, b.status]);
        }
      }
      await q.query(`update ai_commands set status = 'undone', undone_at = now(), skipped = $3::jsonb where id = $1 and user_id = $2`, [id, uid, json(skipped)]);
    });
    return this.get(uid, id);
  }
}
