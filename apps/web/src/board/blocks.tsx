import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  eventDaysOf,
  EVENT_DAYS_LABEL,
  memoColor,
  notiShowOf,
  PRIORITY_LABEL,
  TASK_FILTER_LABEL,
  taskFilterOf,
  pickTasks,
  type BlockDto,
  type Column,
  type EventDto,
  type NotificationDto,
  type QueryResult,
  type TableDto,
  type TaskDto,
} from '@jarvis/shared';
import { Icon } from '../components/Icon';
import { SafeText } from '../components/SafeText';
import { CountBadge, Empty, IconButton, Tag, useSize } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { boardKey, keys, queryClient, refresh, useEvents, useMenus, useNotifications, useQueryResult, useRows, useTable, useTasks } from '../lib/data';
import { ago, cellText, dayKey, dueLabel, localInputToIso, shortWhen, timeLabel, zoneOffset } from '../lib/format';
import { useApp } from '../lib/store';
import { MenuBlockBody } from '../menu/menu';
import { QuizBody, useQuizStats } from './quiz';
import { LinksBody } from './links';
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

/** 블록 설정(할 일 보기 방식)대로 거른다 — 마감이 지난 것도 '오늘까지'에 든다 */
function filterTasks(tasks: TaskDto[], block: BlockDto): TaskDto[] {
  return pickTasks(tasks, taskFilterOf(block.config), new Date(`${dayKey(new Date())}T00:00:00${zoneOffset()}`).getTime());
}
function filterEvents(events: EventDto[], block: BlockDto): EventDto[] {
  const until = new Date(`${dayKey(new Date())}T00:00:00${zoneOffset()}`).getTime() + eventDaysOf(block.config) * 86_400_000;
  return events.filter((e) => new Date(e.start_at).getTime() < until);
}
function filterNotis(list: NotificationDto[], block: BlockDto): NotificationDto[] {
  return notiShowOf(block.config) === 'unread' ? list.filter((n) => n.status === 'unread') : list;
}

function TasksBody({ block }: { block: BlockDto }) {
  const { data: all = [], isLoading } = useTasks();
  const data = filterTasks(all, block);
  const open = useApp((s) => s.open);
  const f = taskFilterOf(block.config);
  return (
    <PagedList
      items={data}
      empty={isLoading ? '불러오는 중입니다' : f === 'all' || f === 'open' || f === 'dated' ? '할 일이 없습니다' : `${TASK_FILTER_LABEL[f]} 할 일이 없습니다`}
      action={<FooterButton icon="plus" label="추가" onClick={() => open({ kind: 'task' })} />}
      render={(t) => {
        const done = t.status === 'done';
        return (
          <li key={t.id} className={`${rowBase} pr-4 pl-1.5`}>
            <button type="button" aria-label={done ? '다시 열기' : '완료'} onClick={() => toggleTask(t)} className="flex size-11 shrink-0 items-center justify-center">
              <span className={`flex size-5 items-center justify-center rounded-md border-2 ${done ? 'border-accent bg-accent text-white' : 'border-field'}`}>
                {done && <Icon name="check" size={13} />}
              </span>
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

function EventsBody({ block }: { block: BlockDto }) {
  const { data: all = [], isLoading } = useEvents();
  const data = filterEvents(all, block);
  const open = useApp((s) => s.open);
  const days = eventDaysOf(block.config);
  return (
    <PagedList
      items={data}
      empty={isLoading ? '불러오는 중입니다' : days === 1 ? '오늘 일정이 없습니다' : `앞으로 ${EVENT_DAYS_LABEL[days]} 동안 일정이 없습니다`}
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

function NotificationsBody({ block }: { block: BlockDto }) {
  const { data: all = [], isLoading } = useNotifications();
  const data = filterNotis(all, block);
  const open = useApp((s) => s.open);
  const unread = all.filter((n) => n.status === 'unread').length;
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
    template: {
      gridTemplateColumns: `repeat(${Math.min(max, columns.length) || 1}, minmax(0, 1fr))`,
      paddingRight: columns.length > max ? NAV_WIDTH : 0,
    },
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
                <button
                  key={c.id}
                  type="button"
                  onClick={() => cycleSort(c.id)}
                  title={`${c.name} 정렬`}
                  className={`flex min-w-0 items-center gap-1 px-3 ${c.type === 'number' ? 'justify-end' : ''}`}
                >
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
              {table.linked && <CollectStatus table={table} />}
            </span>
            {total > per && (
              <PageControl
                from={(page - 1) * per + 1}
                to={Math.min(total, page * per)}
                total={total}
                onPrev={() => setPage(Math.max(1, page - 1))}
                onNext={() => setPage(Math.min(lastPage, page + 1))}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 수합 현황(2026-11-28 UX 토론 G): 설문·시트에 이은 표는 '응답 N · 갱신 시각'과 [새로 읽기].
 * 명단이 없으니 제출률·미제출은 짐작하지 않는다. 새로 읽기에 실패하면 이전 자료가 그대로 있다고 알린다.
 */
function CollectStatus({ table }: { table: TableDto }) {
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ status: string; message?: string }>(`/connectors/google-sheets/tables/${table.id}/sync`, { accept_structure: false });
      if (r.status === 'synced') toast(table.form ? '설문 응답을 새로 읽었습니다' : '시트를 새로 읽었습니다');
      else toast(`${r.message ?? '새로 읽지 못했습니다'} — 이전 자료는 그대로 있습니다`, 'error');
    } catch (e) {
      toast(`${errorMessage(e)} — 이전 자료는 그대로 있습니다`, 'error');
    } finally {
      setBusy(false);
      void refresh('tables', 'rows', 'query');
    }
  };
  return (
    <span className="flex min-w-0 items-center gap-0.5">
      <span title={table.last_error ?? undefined} className={`truncate text-xs ${table.last_error ? 'text-danger' : 'text-sub'}`}>
        {table.form ? `응답 ${table.row_count}` : '시트'}
        {table.last_error ? ' · 읽기 오류' : table.last_synced_at ? ` · ${timeLabel(table.last_synced_at)} 갱신` : ''}
      </span>
      <IconButton icon="refresh" label={table.form ? '응답 새로 읽기' : '시트 새로 읽기'} size={32} disabled={busy} onClick={() => void reload()} />
    </span>
  );
}

// ── 휴대폰: 할 일 바로 처리(2026-11-28 UX 토론 F) ─────────────────

/** 휴대폰 1열 카드 안의 할 일 — 시트를 열지 않고 바로 체크하고 바로 더한다. 글자 16px, 누를 곳 44px. */
export function PhoneTasks({ block, max = 4 }: { block: BlockDto; max?: number }) {
  const { data: all = [], isLoading } = useTasks();
  const open = useApp((s) => s.open);
  const toast = useApp((s) => s.toast);
  const list = filterTasks(all, block).filter((t) => t.status === 'open');
  // '오늘까지'·'이번 주까지' 카드에서 더하면 오늘 마감으로 — 마감 없이 넣으면 이 카드에 안 보여 실패로 오해한다(코덱스 재검토)
  const dated = ['today', 'week'].includes(taskFilterOf(block.config));
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const add = async () => {
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      await api.post('/tasks', { title: t.slice(0, 200), ...(dated ? { due_at: localInputToIso(`${dayKey(new Date())}T23:59`) } : {}) });
      setTitle('');
      await refresh('tasks');
    } catch (e) {
      toast(`할 일을 더하지 못했습니다: ${errorMessage(e)}`, 'error'); // 적은 글은 남겨 둔다
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col">
      {list.length === 0 ? (
        <p className="px-3 text-base leading-[44px] text-sub">{isLoading ? '불러오는 중입니다' : '남은 할 일이 없습니다'}</p>
      ) : (
        list.slice(0, max).map((t) => (
          <div key={t.id} className="flex min-h-11 items-center border-b border-rule">
            <button type="button" aria-label="완료" onClick={() => void toggleTask(t)} className="flex size-11 shrink-0 items-center justify-center">
              <span className="flex size-6 items-center justify-center rounded-md border-2 border-field" />
            </button>
            <button type="button" onClick={() => open({ kind: 'task', taskId: t.id })} className="min-w-0 flex-1 truncate py-2 text-left text-base">
              {t.title}
            </button>
            {t.due_at && (
              <Tag tone={isOverdue(t) ? 'danger' : 'neutral'} className="mr-2 shrink-0">
                {dueLabel(t.due_at)}
              </Tag>
            )}
          </div>
        ))
      )}
      {list.length > max && <p className="px-3 text-sm leading-9 text-sub">외 {list.length - max}건 — 제목을 누르면 모두 봅니다</p>}
      <form
        className="flex items-center gap-1.5 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder={dated ? '오늘 마감 할 일 바로 더하기' : '할 일 바로 더하기'}
          aria-label="할 일 바로 더하기"
          className="h-11 min-w-0 flex-1 rounded-lg border border-field bg-card px-3 text-base outline-none focus:border-accent"
        />
        <button type="submit" disabled={saving || !title.trim()} aria-label="더하기" className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-white disabled:opacity-40">
          <Icon name="plus" size={20} />
        </button>
      </form>
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

  // 저장은 한 줄로 차례차례(늦게 끝난 옛 저장이 새 글을 덮지 않게), '저장됨'은 성공한 뒤에만 적는다 — 실패하면 다음에 다시 저장한다(코덱스·제미나이 검토).
  const chain = useRef<Promise<void>>(Promise.resolve());
  const save = (value: string) => {
    chain.current = chain.current.then(async () => {
      if (value === saved.current) return;
      try {
        // 글만 보낸다. 서버는 보낸 키만 바꾸므로 그사이 바뀐 종이 색을 덮어쓰지 않는다.
        await api.patch(`/blocks/${block.id}`, { config: { text: value } });
        saved.current = value;
        queryClient.setQueryData<{ blocks: BlockDto[] }>(
          boardKey(),
          (b) =>
            b && {
              ...b,
              blocks: b.blocks.map((x) => (x.id === block.id ? { ...x, config: { ...x.config, text: value } } : x)),
            },
        );
      } catch (e) {
        useApp.getState().toast(`메모를 저장하지 못했습니다: ${errorMessage(e)}`, 'error');
      }
    });
    return chain.current;
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
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save(text)}
        maxLength={5000}
        placeholder="메모를 적으세요"
        className="min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-ink/40"
      />
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
          <PageControl
            from={current * per + 1}
            to={Math.min(result.rows.length, (current + 1) * per)}
            total={result.rows.length}
            onPrev={() => setPage(Math.max(0, current - 1))}
            onNext={() => setPage(Math.min(pages - 1, current + 1))}
          />
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
      return <TasksBody block={block} />;
    case 'events':
      return <EventsBody block={block} />;
    case 'notifications':
      return <NotificationsBody block={block} />;
    case 'table':
      return <TableBody block={block} />;
    case 'memo':
      return <MemoBody block={block} />;
    case 'ai_result':
      return <AiResultBody block={block} full={full} />;
    case 'view':
      return <ViewBody block={block} />;
    case 'menu':
      return <MenuBlockBody />;
    case 'quiz':
      return <QuizBody block={block} />;
    case 'links':
      return <LinksBody block={block} />;
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

function useTasksSummary(block: BlockDto): BlockSummary {
  const { data = [] } = useTasks();
  const openTasks = filterTasks(data, block).filter((t) => t.status === 'open');
  return {
    count: openTasks.length,
    alert: false,
    lines: openTasks.map((t) => t.title),
  };
}
function useEventsSummary(block: BlockDto): BlockSummary {
  const { data = [] } = useEvents();
  const shown = filterEvents(data, block);
  return {
    count: shown.filter(isToday).length,
    alert: false,
    lines: shown.map((e) => `${eventWhen(e)} ${e.title}`),
  };
}
function useNotificationsSummary(block: BlockDto): BlockSummary {
  const { data = [] } = useNotifications();
  const unread = data.filter((n) => n.status === 'unread');
  return {
    count: unread.length,
    alert: true,
    lines: (unread.length > 0 ? unread : filterNotis(data, block)).map((n) => n.title),
  };
}
function useTableSummary(block: BlockDto): BlockSummary {
  const { table } = useTable(block.source_table_id);
  const { data } = useRows(table?.id, 1, 3);
  const cols = table?.schema.columns.slice(0, 2) ?? [];
  return {
    count: table ? (data?.total ?? table.row_count) : null,
    alert: false,
    lines: (data?.rows ?? []).map((r) =>
      cols
        .map((c) => cellText(r.values[c.id], c.type))
        .filter(Boolean)
        .join(' · '),
    ),
  };
}
function useTextSummary(block: BlockDto): BlockSummary {
  const hasQuery = !!block.config.query && !!block.source_table_id;
  const { data } = useQueryResult(hasQuery ? block.source_table_id : null, block.config.query);
  if (hasQuery) {
    return {
      count: data ? data.rows.length : null,
      alert: false,
      lines: (data?.rows ?? []).map((row) => row.map((v, i) => cellText(v, data!.columns[i]?.type ?? 'text')).join(' · ')),
    };
  }
  const text = typeof block.config.text === 'string' ? block.config.text : '';
  return {
    count: null,
    alert: false,
    lines: text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  };
}

function SummaryOf({ block, children }: { block: BlockDto; children: (s: BlockSummary) => ReactNode }) {
  switch (block.type) {
    case 'tasks':
      return <TasksSummary block={block}>{children}</TasksSummary>;
    case 'events':
      return <EventsSummary block={block}>{children}</EventsSummary>;
    case 'notifications':
      return <NotificationsSummary block={block}>{children}</NotificationsSummary>;
    case 'table':
      return <TableSummary block={block}>{children}</TableSummary>;
    case 'menu':
      return <MenuSummary>{children}</MenuSummary>;
    case 'quiz':
      return <QuizSummary block={block}>{children}</QuizSummary>;
    case 'links': {
      const items = Array.isArray(block.config.items) ? (block.config.items as { title?: string }[]) : [];
      return <>{children({ count: items.length, alert: false, lines: items.map((i) => String(i.title ?? '')) })}</>;
    }
    case 'view':
      // 그려서 보여 주는 블록이라 줄로 줄일 내용이 없다. 휴대폰 타일에는 여는 법만 적는다.
      return (
        <>
          {children({
            count: null,
            alert: false,
            lines: ['눌러서 화면을 봅니다'],
          })}
        </>
      );
    default:
      return <TextSummary block={block}>{children}</TextSummary>;
  }
}
/** 휴대폰 타일: 받는 중에는 응답 수만(정답률은 마감 뒤 — 교실 화면으로 새지 않게, 코덱스 검토) */
function QuizSummary({ block, children }: Render & { block: BlockDto }) {
  const { data } = useQuizStats(typeof block.config.quiz_id === 'string' ? block.config.quiz_id : undefined);
  return (
    <>
      {children({
        count: data ? data.total : null,
        alert: false,
        lines: data
          ? [
              `${data.quiz.status === 'open' ? '받는 중' : '마감'} · 응답 ${data.total}명`,
              ...(data.quiz.status === 'open' ? [] : data.questions).map((q, i) => `${i + 1}. 정답 ${q.correct === null ? '-' : `${q.answered ? Math.round((q.correct / q.answered) * 100) : 0}%`}`),
            ]
          : [],
      })}
    </>
  );
}
function MenuSummary({ children }: Render) {
  const { data = [] } = useMenus();
  return <>{children({ count: null, alert: false, lines: data.map((m) => m.label) })}</>;
}
type Render = { children: (s: BlockSummary) => ReactNode };
const TasksSummary = ({ block, children }: Render & { block: BlockDto }) => <>{children(useTasksSummary(block))}</>;
const EventsSummary = ({ block, children }: Render & { block: BlockDto }) => <>{children(useEventsSummary(block))}</>;
const NotificationsSummary = ({ block, children }: Render & { block: BlockDto }) => <>{children(useNotificationsSummary(block))}</>;
const TableSummary = ({ block, children }: Render & { block: BlockDto }) => <>{children(useTableSummary(block))}</>;
const TextSummary = ({ block, children }: Render & { block: BlockDto }) => <>{children(useTextSummary(block))}</>;

/** 블록 머리줄의 건수 배지. */
export function BlockCount({ block }: { block: BlockDto }) {
  return <SummaryOf block={block}>{(s) => (s.count === null ? null : <CountBadge n={s.count} alert={s.alert} />)}</SummaryOf>;
}

/** 휴대폰 타일의 내용: 3줄과 "외 N건". */
export function TileLines({ block, max = 3, big }: { block: BlockDto; max?: number; big?: boolean }) {
  const line = big ? 'truncate text-base leading-9' : 'truncate text-sm leading-7';
  return (
    <SummaryOf block={block}>
      {(s) => (
        <>
          <div className="min-h-0 flex-1 overflow-hidden px-3">
            {s.lines.length === 0 ? (
              <p className={`${line} text-sub`}>비어 있습니다</p>
            ) : (
              s.lines.slice(0, max).map((text, i) => (
                <p key={i} className={line}>
                  {text}
                </p>
              ))
            )}
          </div>
          {/* 휴대폰 1열 카드는 머리줄에 건수가 있으니 넘칠 때만 */}
          {(!big || s.lines.length > max) && (
            <p className="h-8 shrink-0 truncate px-3 text-xs leading-8 text-sub">{s.lines.length > max ? `외 ${s.lines.length - max}건` : s.count !== null ? `${s.count}건` : ' '}</p>
          )}
        </>
      )}
    </SummaryOf>
  );
}
