import { useEffect, useRef, useState, type ReactNode } from 'react';
import { memoColor, PRIORITY_LABEL, type BlockDto, type Column, type EventDto, type NotificationDto, type QueryResult, type TaskDto } from '@jarvis/shared';
import { Icon } from '../components/Icon';
import { SafeText } from '../components/SafeText';
import { CountBadge, Empty, IconButton, Tag, useSize } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { keys, queryClient, refresh, useEvents, useNotifications, useQueryResult, useRows, useTable, useTasks } from '../lib/data';
import { ago, cellText, dayKey, dueLabel, shortWhen, timeLabel } from '../lib/format';
import { useApp } from '../lib/store';
import { ViewBody } from './view';

// 블록 7종의 내용(BRD-5, AI 화면은 view.tsx). 블록 안에는 스크롤을 만들지 않는다:
// 상자 높이를 재서 들어가는 줄 수만 보여주고, 나머지는 쪽 넘김으로 본다.

const ROW = 44;
const FOOT = 40;

function FooterButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium whitespace-nowrap text-accent hover:bg-tint">
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
}

function PageControl({ from, to, total, onPrev, onNext }: { from: number; to: number; total: number; onPrev: () => void; onNext: () => void }) {
  return (
    <span className="flex shrink-0 items-center text-xs text-sub">
      <span className="px-1 tabular-nums whitespace-nowrap">
        {from}–{to} / {total}
      </span>
      <IconButton icon="prev" label="이전" size={36} disabled={from <= 1} onClick={onPrev} />
      <IconButton icon="next" label="다음" size={36} disabled={to >= total} onClick={onNext} />
    </span>
  );
}

/** 높이에 맞는 줄 수만 보여주는 목록. 넘치면 아래 줄에 쪽 넘김이 생긴다. */
function PagedList<T>({ items, render, empty, action, row = ROW }: { items: T[]; render: (item: T) => ReactNode; empty: string; action?: ReactNode; row?: number }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [page, setPage] = useState(0);
  const bare = Math.floor(size.height / row);
  const showFooter = !!action || items.length > bare;
  const per = Math.max(1, showFooter ? Math.floor((size.height - FOOT) / row) : bare);
  const pages = Math.max(1, Math.ceil(items.length / per));
  const current = Math.min(page, pages - 1);
  const slice = items.slice(current * per, current * per + per);
  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      <ul className="m-0 min-h-0 flex-1 list-none overflow-hidden p-0">{items.length === 0 ? <Empty>{empty}</Empty> : slice.map(render)}</ul>
      {showFooter && (
        <div className="flex h-10 shrink-0 items-center justify-between border-t border-rule pr-1 pl-2">
          <span className="flex min-w-0 items-center">{action}</span>
          {items.length > per && (
            <PageControl
              from={current * per + 1}
              to={Math.min(items.length, (current + 1) * per)}
              total={items.length}
              onPrev={() => setPage(Math.max(0, current - 1))}
              onNext={() => setPage(Math.min(pages - 1, current + 1))}
            />
          )}
        </div>
      )}
    </div>
  );
}

const rowBase = 'flex h-11 items-center gap-2 border-b border-rule';
const rowClass = `${rowBase} px-4`;

// ── 할 일 ─────────────────────────────────────────────────────

const isOverdue = (t: TaskDto) => t.status === 'open' && !!t.due_at && new Date(t.due_at).getTime() < Date.now();

export async function toggleTask(t: TaskDto): Promise<void> {
  const status = t.status === 'done' ? 'open' : 'done';
  queryClient.setQueryData<TaskDto[]>(keys.tasks, (old) => old?.map((x) => (x.id === t.id ? { ...x, status } : x)));
  try {
    await api.patch(`/tasks/${t.id}`, { status });
  } catch (e) {
    useApp.getState().toast(errorMessage(e), 'error');
  } finally {
    void refresh('tasks');
  }
}

function TasksBody() {
  const { data = [], isLoading } = useTasks();
  const open = useApp((s) => s.open);
  return (
    <PagedList
      items={data}
      empty={isLoading ? '불러오는 중입니다' : '할 일이 없습니다'}
      action={<FooterButton icon="plus" label="추가" onClick={() => open({ kind: 'task' })} />}
      render={(t) => {
        const done = t.status === 'done';
        return (
          <li key={t.id} className={`${rowBase} pr-4 pl-1.5`}>
            <button type="button" aria-label={done ? '다시 열기' : '완료'} onClick={() => toggleTask(t)} className="flex size-11 shrink-0 items-center justify-center">
              <span className={`flex size-5 items-center justify-center rounded-md border-2 ${done ? 'border-accent bg-accent text-white' : 'border-field'}`}>{done && <Icon name="check" size={13} />}</span>
            </button>
            <button type="button" onClick={() => open({ kind: 'task', taskId: t.id })} className={`min-w-0 flex-1 truncate text-left ${done ? 'text-sub line-through' : ''}`}>
              {t.title}
            </button>
            {t.due_at && (
              <Tag tone={isOverdue(t) ? 'danger' : 'neutral'} className="w-[84px] justify-center">
                {dueLabel(t.due_at)}
              </Tag>
            )}
          </li>
        );
      }}
    />
  );
}

// ── 일정 ─────────────────────────────────────────────────────

const isToday = (e: EventDto) => dayKey(e.start_at) === dayKey(new Date());
const eventWhen = (e: EventDto) => (isToday(e) ? timeLabel(e.start_at) : shortWhen(e.start_at));

function EventsBody() {
  const { data = [], isLoading } = useEvents();
  const open = useApp((s) => s.open);
  return (
    <PagedList
      items={data}
      empty={isLoading ? '불러오는 중입니다' : '앞으로 2주 동안 일정이 없습니다'}
      action={<FooterButton icon="plus" label="추가" onClick={() => open({ kind: 'event' })} />}
      render={(e) => (
        <li key={e.id} className={rowClass}>
          <Tag tone={isToday(e) ? 'accent' : 'neutral'} className="w-[84px] justify-center">
            {eventWhen(e)}
          </Tag>
          <button type="button" onClick={() => open({ kind: 'event', eventId: e.id })} className="min-w-0 flex-1 truncate text-left">
            {e.title}
          </button>
        </li>
      )}
    />
  );
}

// ── 알림 ─────────────────────────────────────────────────────

export function PriorityTag({ n }: { n: NotificationDto }) {
  return <Tag tone={n.priority === 'urgent' ? 'danger' : 'neutral'}>{PRIORITY_LABEL[n.priority]}</Tag>;
}

export async function readAll(): Promise<void> {
  try {
    await api.post('/notifications/read-all');
  } catch (e) {
    useApp.getState().toast(errorMessage(e), 'error');
  }
  void refresh('notifications');
}

function NotificationsBody() {
  const { data = [], isLoading } = useNotifications();
  const open = useApp((s) => s.open);
  const unread = data.filter((n) => n.status === 'unread').length;
  return (
    <PagedList
      items={data}
      empty={isLoading ? '불러오는 중입니다' : '새 알림이 없습니다'}
      action={unread > 0 ? <FooterButton icon="check" label="모두 읽음" onClick={readAll} /> : <FooterButton icon="bell" label="알림 센터" onClick={() => open({ kind: 'notifications' })} />}
      render={(n) => (
        <li key={n.id} className={rowClass}>
          <PriorityTag n={n} />
          <button type="button" onClick={() => open({ kind: 'notifications' })} className={`min-w-0 flex-1 truncate text-left ${n.status === 'unread' ? 'font-bold' : 'text-sub'}`}>
            {n.title}
          </button>
          {n.count > 1 && <span className="shrink-0 text-xs text-sub tabular-nums">×{n.count}</span>}
          <span className="shrink-0 text-xs whitespace-nowrap text-sub">{ago(n.last_seen_at)}</span>
        </li>
      )}
    />
  );
}

// ── 표 ───────────────────────────────────────────────────────

const HEAD = 36;
const CELL_ROW = 40;
const MIN_COL = 112;
const NAV_WIDTH = 64;
const alignOf = (type: string) => (type === 'number' ? 'text-right tabular-nums' : 'text-left');

/** 가로 스크롤 없이 들어가는 열만 보여주고, 나머지는 열 넘김으로 본다. */
function useColumnWindow<T>(columns: T[], width: number) {
  const [start, setStart] = useState(0);
  const fits = Math.max(1, Math.floor(width / MIN_COL));
  const max = columns.length > fits ? Math.max(1, Math.floor((width - NAV_WIDTH) / MIN_COL)) : fits;
  const first = Math.min(start, Math.max(0, columns.length - max));
  return {
    visible: columns.slice(first, first + max),
    // 열 넘김 단추가 있으면 머리글과 행이 똑같이 그 자리를 비워 두어 열이 어긋나지 않는다.
    template: { gridTemplateColumns: `repeat(${Math.min(max, columns.length) || 1}, minmax(0, 1fr))`, paddingRight: columns.length > max ? NAV_WIDTH : 0 },
    hasMore: columns.length > max,
    canPrev: first > 0,
    canNext: first + max < columns.length,
    prev: () => setStart(Math.max(0, first - 1)),
    next: () => setStart(first + 1),
  };
}

function ColumnNav({ win }: { win: ReturnType<typeof useColumnWindow> }) {
  if (!win.hasMore) return null;
  return (
    <span className="absolute inset-y-0 right-0 flex items-center bg-ground" style={{ width: NAV_WIDTH }}>
      <IconButton icon="prev" label="이전 열" size={32} disabled={!win.canPrev} onClick={win.prev} />
      <IconButton icon="next" label="다음 열" size={32} disabled={!win.canNext} onClick={win.next} />
    </span>
  );
}

function TableBody({ block }: { block: BlockDto }) {
  const { table, isLoading } = useTable(block.source_table_id);
  const open = useApp((s) => s.open);
  const [ref, size] = useSize<HTMLDivElement>();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  const per = Math.max(1, Math.floor((size.height - HEAD - FOOT) / CELL_ROW));
  const win = useColumnWindow<Column>(table?.schema.columns ?? [], size.width);
  const { data } = useRows(table?.id, page, size.height > 0 ? per : 0, sort?.col, sort?.dir);
  const total = data?.total ?? table?.row_count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / per));
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage]);

  const cycleSort = (col: string) => {
    setPage(1);
    setSort((s) => (s?.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null));
  };

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      {!table ? (
        <Empty>{isLoading ? '불러오는 중입니다' : '원본 표가 없습니다. 휴지통을 확인하세요.'}</Empty>
      ) : (
        <>
          <div className="relative flex h-9 shrink-0 border-b border-rule bg-ground text-xs font-medium text-sub">
            <div className="grid min-w-0 flex-1" style={win.template}>
              {win.visible.map((c) => (
                <button key={c.id} type="button" onClick={() => cycleSort(c.id)} title={`${c.name} 정렬`} className={`flex min-w-0 items-center gap-1 px-3 ${c.type === 'number' ? 'justify-end' : ''}`}>
                  <span className="truncate">{c.name}</span>
                  {sort?.col === c.id && <span className="shrink-0 text-accent">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </button>
              ))}
            </div>
            <ColumnNav win={win} />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {total === 0 ? (
              <Empty>행이 없습니다</Empty>
            ) : (
              (data?.rows ?? []).slice(0, per).map((r) => (
                <div key={r.id} className="grid h-10 items-center border-b border-rule text-sm" style={win.template}>
                  {win.visible.map((c) => {
                    const failed = r.raw?.[c.id];
                    return (
                      <span key={c.id} title={failed ? `변환하지 못한 값: ${failed}` : undefined} className={`truncate px-3 ${alignOf(c.type)} ${failed ? 'text-danger' : ''}`}>
                        {failed ? String(failed) : cellText(r.values[c.id], c.type)}
                      </span>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <div className="flex h-10 shrink-0 items-center justify-between border-t border-rule pr-1 pl-2">
            <span className="flex min-w-0 items-center gap-1">
              <FooterButton icon="table" label="상세" onClick={() => open({ kind: 'table', tableId: table.id })} />
              {table.linked && (
                <span className={`truncate text-xs ${table.last_error ? 'text-danger' : 'text-sub'}`}>{table.last_error ? '동기화 오류' : table.last_synced_at ? `시트 ${shortWhen(table.last_synced_at)}` : '시트 연결'}</span>
              )}
            </span>
            {total > per && <PageControl from={(page - 1) * per + 1} to={Math.min(total, page * per)} total={total} onPrev={() => setPage(Math.max(1, page - 1))} onNext={() => setPage(Math.min(lastPage, page + 1))} />}
          </div>
        </>
      )}
    </div>
  );
}

// ── 메모 ─────────────────────────────────────────────────────

function MemoBody({ block }: { block: BlockDto }) {
  const serverText = typeof block.config.text === 'string' ? block.config.text : '';
  const [text, setText] = useState(serverText);
  const saved = useRef(serverText);
  const latest = useRef(text);
  latest.current = text;

  const save = async (value: string) => {
    if (value === saved.current) return;
    saved.current = value;
    try {
      // 글만 보낸다. 서버는 보낸 키만 바꾸므로 그사이 바뀐 종이 색을 덮어쓰지 않는다.
      await api.patch(`/blocks/${block.id}`, { config: { text: value } });
      queryClient.setQueryData<{ blocks: BlockDto[] }>(keys.board, (b) => b && { ...b, blocks: b.blocks.map((x) => (x.id === block.id ? { ...x, config: { ...x.config, text: value } } : x)) });
    } catch (e) {
      useApp.getState().toast(errorMessage(e), 'error');
    }
  };

  // 다른 기기나 AI가 바꾼 내용은, 여기서 고치는 중이 아닐 때만 받아들인다.
  useEffect(() => {
    if (serverText !== saved.current && latest.current === saved.current) {
      saved.current = serverText;
      setText(serverText);
    }
  }, [serverText]);
  // 입력을 멈추고 0.8초 뒤에 저장한다.
  useEffect(() => {
    if (text === saved.current) return;
    const timer = setTimeout(() => void save(text), 800);
    return () => clearTimeout(timer);
  }, [text]);
  // 닫힐 때 아직 저장하지 않은 내용이 있으면 바로 저장한다.
  useEffect(() => () => void save(latest.current), []);

  return (
    <div data-memo={memoColor(block.config.color)} className="memo-paper flex min-h-0 flex-1 flex-col">
      <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => void save(text)} maxLength={5000} placeholder="메모를 적으세요" className="min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-ink/40" />
    </div>
  );
}

// ── AI 결과 ───────────────────────────────────────────────────

function ResultGrid({ result }: { result: QueryResult }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [page, setPage] = useState(0);
  const win = useColumnWindow(result.columns, size.width);
  const offset = result.columns.indexOf(win.visible[0]);
  const bare = Math.floor((size.height - HEAD) / CELL_ROW);
  const paged = result.rows.length > bare;
  const per = Math.max(1, paged ? Math.floor((size.height - HEAD - FOOT) / CELL_ROW) : bare);
  const pages = Math.max(1, Math.ceil(result.rows.length / per));
  const current = Math.min(page, pages - 1);
  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex h-9 shrink-0 border-b border-rule bg-ground text-xs font-medium text-sub">
        <div className="grid min-w-0 flex-1 items-center" style={win.template}>
          {win.visible.map((c) => (
            <span key={c.key} className={`truncate px-3 ${alignOf(c.type)}`}>
              {c.label}
            </span>
          ))}
        </div>
        <ColumnNav win={win} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {result.rows.length === 0 ? (
          <Empty>결과가 없습니다</Empty>
        ) : (
          result.rows.slice(current * per, current * per + per).map((row, i) => (
            <div key={i} className="grid h-10 items-center border-b border-rule text-sm" style={win.template}>
              {win.visible.map((c, j) => (
                <span key={c.key} className={`truncate px-3 ${alignOf(c.type)}`}>
                  {cellText(row[offset + j], c.type)}
                </span>
              ))}
            </div>
          ))
        )}
      </div>
      {paged && (
        <div className="flex h-10 shrink-0 items-center justify-end border-t border-rule pr-1">
          <PageControl from={current * per + 1} to={Math.min(result.rows.length, (current + 1) * per)} total={result.rows.length} onPrev={() => setPage(Math.max(0, current - 1))} onNext={() => setPage(Math.min(pages - 1, current + 1))} />
        </div>
      )}
    </div>
  );
}

function AiResultBody({ block, full }: { block: BlockDto; full?: boolean }) {
  const open = useApp((s) => s.open);
  const hasQuery = !!block.config.query && !!block.source_table_id;
  const { data, error, isLoading } = useQueryResult(hasQuery ? block.source_table_id : null, block.config.query);
  const box = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  const text = typeof block.config.text === 'string' ? block.config.text : '';
  useEffect(() => {
    const el = box.current;
    if (!el || full) return;
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, full]);

  if (hasQuery) {
    if (error) return <Empty>{errorMessage(error)}</Empty>;
    if (!data) return <Empty>{isLoading ? '계산하는 중입니다' : '원본 표가 없습니다'}</Empty>;
    return <ResultGrid result={data} />;
  }
  if (!text) return <Empty>내용이 없습니다</Empty>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={box} className={`min-h-0 flex-1 px-4 py-3 ${full ? 'overflow-y-auto' : 'overflow-hidden'}`}>
        <SafeText text={text} />
      </div>
      {clipped && !full && (
        <div className="flex h-10 shrink-0 items-center border-t border-rule pl-2">
          <FooterButton icon="next" label="전체 보기" onClick={() => open({ kind: 'block', blockId: block.id })} />
        </div>
      )}
    </div>
  );
}

// ── 공통 ─────────────────────────────────────────────────────

export function BlockBody({ block, full }: { block: BlockDto; full?: boolean }) {
  switch (block.type) {
    case 'tasks':
      return <TasksBody />;
    case 'events':
      return <EventsBody />;
    case 'notifications':
      return <NotificationsBody />;
    case 'table':
      return <TableBody block={block} />;
    case 'memo':
      return <MemoBody block={block} />;
    case 'ai_result':
      return <AiResultBody block={block} full={full} />;
    case 'view':
      return <ViewBody block={block} />;
    default:
      return <Empty>알 수 없는 블록입니다</Empty>;
  }
}

/** 블록 머리줄과 휴대폰 타일에 쓰는 요약: 건수와 앞의 몇 줄. */
export interface BlockSummary {
  count: number | null;
  /** 안 읽은 알림처럼 눈에 띄어야 하는 숫자 */
  alert: boolean;
  lines: string[];
}

function useTasksSummary(): BlockSummary {
  const { data = [] } = useTasks();
  const openTasks = data.filter((t) => t.status === 'open');
  return { count: openTasks.length, alert: false, lines: openTasks.map((t) => t.title) };
}
function useEventsSummary(): BlockSummary {
  const { data = [] } = useEvents();
  return { count: data.filter(isToday).length, alert: false, lines: data.map((e) => `${eventWhen(e)} ${e.title}`) };
}
function useNotificationsSummary(): BlockSummary {
  const { data = [] } = useNotifications();
  const unread = data.filter((n) => n.status === 'unread');
  return { count: unread.length, alert: true, lines: (unread.length > 0 ? unread : data).map((n) => n.title) };
}
function useTableSummary(block: BlockDto): BlockSummary {
  const { table } = useTable(block.source_table_id);
  const { data } = useRows(table?.id, 1, 3);
  const cols = table?.schema.columns.slice(0, 2) ?? [];
  return { count: table ? (data?.total ?? table.row_count) : null, alert: false, lines: (data?.rows ?? []).map((r) => cols.map((c) => cellText(r.values[c.id], c.type)).filter(Boolean).join(' · ')) };
}
function useTextSummary(block: BlockDto): BlockSummary {
  const hasQuery = !!block.config.query && !!block.source_table_id;
  const { data } = useQueryResult(hasQuery ? block.source_table_id : null, block.config.query);
  if (hasQuery) {
    return { count: data ? data.rows.length : null, alert: false, lines: (data?.rows ?? []).map((row) => row.map((v, i) => cellText(v, data!.columns[i]?.type ?? 'text')).join(' · ')) };
  }
  const text = typeof block.config.text === 'string' ? block.config.text : '';
  return { count: null, alert: false, lines: text.split('\n').map((l) => l.trim()).filter(Boolean) };
}

function SummaryOf({ block, children }: { block: BlockDto; children: (s: BlockSummary) => ReactNode }) {
  switch (block.type) {
    case 'tasks':
      return <TasksSummary>{children}</TasksSummary>;
    case 'events':
      return <EventsSummary>{children}</EventsSummary>;
    case 'notifications':
      return <NotificationsSummary>{children}</NotificationsSummary>;
    case 'table':
      return <TableSummary block={block}>{children}</TableSummary>;
    case 'view':
      // 그려서 보여 주는 블록이라 줄로 줄일 내용이 없다. 휴대폰 타일에는 여는 법만 적는다.
      return <>{children({ count: null, alert: false, lines: ['눌러서 화면을 봅니다'] })}</>;
    default:
      return <TextSummary block={block}>{children}</TextSummary>;
  }
}
type Render = { children: (s: BlockSummary) => ReactNode };
const TasksSummary = ({ children }: Render) => <>{children(useTasksSummary())}</>;
const EventsSummary = ({ children }: Render) => <>{children(useEventsSummary())}</>;
const NotificationsSummary = ({ children }: Render) => <>{children(useNotificationsSummary())}</>;
const TableSummary = ({ block, children }: Render & { block: BlockDto }) => <>{children(useTableSummary(block))}</>;
const TextSummary = ({ block, children }: Render & { block: BlockDto }) => <>{children(useTextSummary(block))}</>;

/** 블록 머리줄의 건수 배지. */
export function BlockCount({ block }: { block: BlockDto }) {
  return <SummaryOf block={block}>{(s) => (s.count === null ? null : <CountBadge n={s.count} alert={s.alert} />)}</SummaryOf>;
}

/** 휴대폰 타일의 내용: 3줄과 "외 N건". */
export function TileLines({ block, max = 3 }: { block: BlockDto; max?: number }) {
  return (
    <SummaryOf block={block}>
      {(s) => (
        <>
          <div className="min-h-0 flex-1 overflow-hidden px-3">
            {s.lines.length === 0 ? (
              <p className="truncate text-sm leading-7 text-sub">비어 있습니다</p>
            ) : (
              s.lines.slice(0, max).map((line, i) => (
                <p key={i} className="truncate text-sm leading-7">
                  {line}
                </p>
              ))
            )}
          </div>
          <p className="h-8 shrink-0 truncate px-3 text-xs leading-8 text-sub">{s.lines.length > max ? `외 ${s.lines.length - max}건` : s.count !== null ? `${s.count}건` : ' '}</p>
        </>
      )}
    </SummaryOf>
  );
}
