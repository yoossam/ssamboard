import { useState, type ReactNode } from 'react';
import { BLOCK_LABEL, BLOCK_TYPES, memoColor, TRASH_DAYS, type BlockDto, type BlockType, type EventDto, type NotificationDto, type TaskDto, type TrashItem } from '@jarvis/shared';
import { useAi } from '../ai/AiWindow';
import { BlockBody, PriorityTag, readAll } from '../board/blocks';
import { togglePin } from '../board/Board';
import { MemoColorDots } from '../board/memo';
import { BLOCK_ICON, Icon } from '../components/Icon';
import { Button, ButtonRow, CountBadge, Empty, Field, IconButton, inputClass, Sheet, Tag, useIsPhone } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { LOCAL_TRACK, localHandle } from '../lib/edition';
import { queryClient, refresh, useBoard, useEvents, useNotifications, useTables, useTasks, useTrash } from '../lib/data';
import { ago, isoToLocalInput, localInputToIso } from '../lib/format';
import { useApp, type Panel } from '../lib/store';
import { SettingsPanel } from './Settings';
import { SheetPanel, TablePanel, TablesPanel, UploadPanel } from './Tables';

// 보드를 떠나지 않고 여는 창들(ONE-1). PC는 가운데 팝업, 휴대폰은 아래 시트다.

/** 큰 단추 타일. 한 줄에 두 개씩 놓는다. */
function Tile({ icon, label, onClick, badge, tone }: { icon: string; label: string; onClick: () => void; badge?: ReactNode; tone?: 'danger' }) {
  return (
    <button type="button" onClick={onClick} className={`flex h-14 min-w-0 items-center gap-2.5 rounded-[10px] border px-3 text-left text-sm font-medium hover:bg-ground ${tone === 'danger' ? 'text-danger' : ''}`}>
      <Icon name={icon} className={tone === 'danger' ? '' : 'text-accent'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge}
    </button>
  );
}

function fail(e: unknown): void {
  useApp.getState().toast(errorMessage(e), 'error');
}

// ── 메뉴(왼쪽) · 더보기(오른쪽) ────────────────────────────────

function MenuPanel() {
  const { close, replace } = useApp.getState();
  const { data: notifications = [] } = useNotifications();
  const { data: tables = [] } = useTables();
  const unread = notifications.filter((n) => n.status === 'unread').length;
  return (
    <Sheet title="메뉴" icon="menu" onClose={close} width={440}>
      <div className="grid grid-cols-2 gap-2">
        <Tile icon="bell" label="알림 센터" badge={<CountBadge n={unread} alert />} onClick={() => replace({ kind: 'notifications' })} />
        <Tile icon="table" label="표" badge={<CountBadge n={tables.length} />} onClick={() => replace({ kind: 'tables' })} />
        <Tile icon="upload" label="파일 올리기" onClick={() => replace({ kind: 'upload' })} />
        <Tile icon="link" label="연결" onClick={() => replace({ kind: 'settings', tab: 'connect' })} />
        <Tile icon="trash" label="휴지통" onClick={() => replace({ kind: 'trash' })} />
        <Tile icon="settings" label="설정" onClick={() => replace({ kind: 'settings' })} />
        {/* 사용 안내(apps/web/public/guide.html) — 기능을 바꾸면 안내도 같이(scripts/check-guide.mjs 가 npm test 에서 견준다) */}
        <Tile icon="info" label="사용 안내" onClick={() => window.open('./guide.html', '_blank', 'noopener')} />
      </div>
    </Sheet>
  );
}

function MorePanel() {
  const { close, replace, setEditMode, markLocked, markSignedOut } = useApp.getState();
  const email = useApp((s) => s.status?.user?.email ?? '');
  const phone = useIsPhone();
  const lock = async () => {
    await api.post('/auth/lock').catch(() => undefined);
    queryClient.clear();
    useAi.getState().reset();
    markLocked('manual');
  };
  const logout = async () => {
    // 구글 드라이브 트랙: 드라이브에 저장한 뒤 이 브라우저 자료를 지우고 처음 화면으로(저장 못 하면 멈추고 알린다).
    const local = localHandle();
    if (local) {
      await local.signOut().catch((e: Error) => useApp.getState().toast(e.message, 'error'));
      return;
    }
    await api.post('/auth/logout').catch(() => undefined);
    queryClient.clear();
    useAi.getState().reset();
    markSignedOut();
  };
  return (
    <Sheet title="더보기" icon="more" onClose={close} width={440}>
      <div className="grid grid-cols-2 gap-2">
        <Tile icon="plus" label="블록 추가" onClick={() => replace({ kind: 'add-block' })} />
        {phone ? (
          <Tile icon="drag" label="순서: 길게 눌러 끌기" onClick={close} />
        ) : (
          <Tile
            icon="grid"
            label="배치 편집"
            onClick={() => {
              setEditMode(true);
              close();
            }}
          />
        )}
        {!LOCAL_TRACK && <Tile icon="lock" label="지금 잠그기" onClick={lock} />}
        <Tile icon="logout" label="로그아웃" onClick={logout} />
      </div>
      <p className="mt-3 truncate text-center text-xs text-sub">{email}</p>
    </Sheet>
  );
}

// ── 블록 ─────────────────────────────────────────────────────

function AddBlockPanel() {
  const { close, replace, toast } = useApp.getState();
  const [busy, setBusy] = useState(false);
  const add = async (type: BlockType) => {
    if (type === 'table') return replace({ kind: 'tables' });
    // AI 화면은 AI가 그려 주는 블록이다. AI 창을 열어 무엇을 보여 줄지 말하게 한다.
    if (type === 'view') {
      close();
      useApp.getState().openAi();
      return toast('무엇을 보여 줄지 말해 주세요. 예: 할 일을 마감 날짜별 막대그래프로');
    }
    setBusy(true);
    try {
      await api.post('/blocks', { type });
      await refresh('board');
      toast(`${BLOCK_LABEL[type]} 블록을 놓았습니다`);
      close();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="블록 추가" icon="plus" onClose={close} width={440}>
      <div className={`grid grid-cols-2 gap-2 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        {BLOCK_TYPES.map((type) => (
          <Tile key={type} icon={BLOCK_ICON[type]} label={BLOCK_LABEL[type]} onClick={() => add(type)} />
        ))}
      </div>
      <p className="mt-3 text-xs text-sub">표 블록은 표를 고른 뒤 "보드에 배치"로 놓습니다. AI 결과 블록은 AI 창에서 "새 블록으로"라고 요청해도 만들어집니다.</p>
      <p className="mt-1.5 text-xs text-sub">메모는 붙임쪽지처럼 씁니다. 머리띠를 끌어 옮기고, 오른쪽 아래 모서리를 끌어 크기를 정하고, 머리띠의 색 단추로 종이 색을 바꿉니다.</p>
      <p className="mt-1.5 text-xs text-sub">AI 화면은 그래프·달력처럼 그려서 보여 주는 블록입니다. AI 창에서 "예산 표를 막대그래프로 보여 줘"처럼 말하면 만들어집니다.</p>
    </Sheet>
  );
}

function useBlock(id: string): BlockDto | undefined {
  return useBoard().data?.blocks.find((b) => b.id === id);
}

/** 블록 하나를 크게 본다(휴대폰에서 타일을 눌렀을 때, AI 결과의 "전체 보기"). */
function BlockPanel({ blockId }: { blockId: string }) {
  const { close, replace } = useApp.getState();
  const block = useBlock(blockId);
  if (!block) return null;
  return (
    <Sheet
      title={block.title}
      icon={BLOCK_ICON[block.type]}
      onClose={close}
      width={640}
      tall
      flush
      footer={
        <ButtonRow>
          <Button icon="pin" tone={block.pinned ? 'primary' : 'ghost'} onClick={() => togglePin(block)}>
            {block.pinned ? '고정 해제' : '고정'}
          </Button>
          <Button icon="edit" onClick={() => replace({ kind: 'block-edit', blockId })}>
            블록 편집
          </Button>
        </ButtonRow>
      }
    >
      <BlockBody block={block} full />
    </Sheet>
  );
}

function BlockEditPanel({ blockId }: { blockId: string }) {
  const { close, toast } = useApp.getState();
  const block = useBlock(blockId);
  const [title, setTitle] = useState(block?.title ?? '');
  const [color, setColor] = useState(memoColor(block?.config.color));
  const [busy, setBusy] = useState(false);
  if (!block) return null;
  const isMemo = block.type === 'memo';
  const run = async (action: 'save' | 'delete') => {
    setBusy(true);
    try {
      if (action === 'save') await api.patch(`/blocks/${block.id}`, { title: title.trim() || block.title, ...(isMemo ? { config: { color } } : {}) });
      else await api.del(`/blocks/${block.id}`);
      await refresh('board', 'trash');
      toast(action === 'save' ? '저장했습니다' : '휴지통으로 보냈습니다');
      close();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="블록 편집"
      icon="edit"
      onClose={close}
      width={440}
      footer={
        <ButtonRow>
          <Button icon="trash" tone="danger" disabled={busy} onClick={() => run('delete')}>
            삭제
          </Button>
          <Button icon="save" tone="primary" disabled={busy} onClick={() => run('save')}>
            저장
          </Button>
        </ButtonRow>
      }
    >
      <Field label="제목" hint="삭제한 블록은 휴지통에 30일 동안 남습니다. 블록이 보여 주던 표나 할 일은 지워지지 않습니다.">
        <input className={inputClass} value={title} maxLength={60} autoFocus onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {isMemo && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-sub">종이 색</p>
          <MemoColorDots value={color} onPick={setColor} />
        </div>
      )}
    </Sheet>
  );
}

// ── 할 일 · 일정 ──────────────────────────────────────────────

function ItemPanel({ kind, item }: { kind: 'task' | 'event'; item?: TaskDto | EventDto }) {
  const { close, toast } = useApp.getState();
  const isTask = kind === 'task';
  const [title, setTitle] = useState(item?.title ?? '');
  const [when, setWhen] = useState(isoToLocalInput(item ? (isTask ? (item as TaskDto).due_at : (item as EventDto).start_at) : null));
  const [end, setEnd] = useState(isoToLocalInput(!isTask && item ? (item as EventDto).end_at : null));
  const [note, setNote] = useState(isTask && item ? (item as TaskDto).note ?? '' : '');
  const [busy, setBusy] = useState(false);
  const path = isTask ? '/tasks' : '/events';
  const name = isTask ? '할 일' : '일정';

  const save = async () => {
    if (!title.trim()) return toast('제목을 입력하세요', 'error');
    if (!isTask && !when) return toast('시작 시각을 입력하세요', 'error');
    const body = isTask ? { title: title.trim(), due_at: localInputToIso(when), ...(item ? { note } : {}) } : { title: title.trim(), start_at: localInputToIso(when), end_at: localInputToIso(end) };
    setBusy(true);
    try {
      if (item) await api.patch(`${path}/${item.id}`, body);
      else await api.post(path, body);
      await refresh(isTask ? 'tasks' : 'events');
      toast(item ? '저장했습니다' : `${name}을 추가했습니다`);
      close();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!item) return close();
    setBusy(true);
    try {
      await api.del(`${path}/${item.id}`);
      await refresh(isTask ? 'tasks' : 'events', 'trash');
      toast('휴지통으로 보냈습니다');
      close();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={item ? `${name} 편집` : `${name} 추가`}
      icon={isTask ? 'tasks' : 'calendar'}
      onClose={close}
      width={440}
      footer={
        <ButtonRow>
          {item ? (
            <Button icon="trash" tone="danger" disabled={busy} onClick={remove}>
              삭제
            </Button>
          ) : (
            <Button icon="close" disabled={busy} onClick={close}>
              취소
            </Button>
          )}
          <Button icon={item ? 'save' : 'plus'} tone="primary" disabled={busy} onClick={save}>
            {item ? '저장' : '추가'}
          </Button>
        </ButtonRow>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="제목">
          <input className={inputClass} value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className={`grid gap-2 ${isTask ? '' : 'grid-cols-2'}`}>
          <Field label={isTask ? '마감 (비워 둘 수 있음)' : '시작'}>
            <input className={inputClass} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          {!isTask && (
            <Field label="끝 (비워 둘 수 있음)">
              <input className={inputClass} type="datetime-local" value={end} min={when} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          )}
        </div>
        {isTask && item ? (
          <Field label="내용">
            <textarea className={`${inputClass} min-h-40 resize-y leading-relaxed`} value={note} maxLength={20000} onChange={(e) => setNote(e.target.value)} />
          </Field>
        ) : null}
      </form>
    </Sheet>
  );
}

function TaskPanel({ taskId }: { taskId?: string }) {
  const { data, isLoading } = useTasks();
  if (taskId && isLoading) return null;
  return <ItemPanel kind="task" item={data?.find((t) => t.id === taskId)} />;
}
function EventPanel({ eventId }: { eventId?: string }) {
  const { data, isLoading } = useEvents();
  if (eventId && isLoading) return null;
  return <ItemPanel kind="event" item={data?.find((e) => e.id === eventId)} />;
}

// ── 알림 센터 ─────────────────────────────────────────────────

function NotificationCard({ n }: { n: NotificationDto }) {
  const toast = useApp((s) => s.toast);
  const set = async (status: NotificationDto['status']) => {
    try {
      await api.patch(`/notifications/${n.id}`, { status });
      await refresh('notifications');
    } catch (e) {
      fail(e);
    }
  };
  const toTask = async () => {
    try {
      await api.post('/tasks', { title: n.title.slice(0, 200) });
      await api.patch(`/notifications/${n.id}`, { status: 'read' });
      await refresh('tasks', 'notifications');
      toast('할 일로 만들었습니다');
    } catch (e) {
      fail(e);
    }
  };
  const unread = n.status === 'unread';
  return (
    <article className={`flex min-w-0 flex-col rounded-[10px] border p-3 ${unread ? 'border-accent/40 bg-tint/40' : ''}`}>
      <div className="flex items-center gap-2">
        <PriorityTag n={n} />
        {n.count > 1 && <Tag>×{n.count}</Tag>}
        <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-sub">{ago(n.last_seen_at)}</span>
      </div>
      <p className={`mt-2 truncate text-sm ${unread ? 'font-bold' : ''}`}>{n.title}</p>
      <p className="mt-0.5 line-clamp-2 min-h-10 text-xs whitespace-pre-line text-sub">{n.body}</p>
      <div className="mt-1 -mb-1.5 flex justify-end">
        <IconButton icon="tasks" label="할 일로 만들기" size={36} onClick={toTask} />
        <IconButton icon="check" label={unread ? '읽음' : '안 읽음'} size={36} active={!unread} onClick={() => set(unread ? 'read' : 'unread')} />
        <IconButton icon="archive" label="보관" size={36} onClick={() => set('archived')} />
      </div>
    </article>
  );
}

function NotificationsPanel() {
  const { close, openAi } = useApp.getState();
  const { data = [], isLoading } = useNotifications();
  const unread = data.filter((n) => n.status === 'unread').length;
  return (
    <Sheet
      title={`알림 센터 · 안 읽음 ${unread}`}
      icon="bell"
      onClose={close}
      width={720}
      tall
      footer={
        <ButtonRow>
          <Button icon="check" disabled={unread === 0} onClick={readAll}>
            모두 읽음
          </Button>
          <Button icon="sparkle" tone="primary" disabled={data.length === 0} onClick={() => openAi('오늘 온 알림을 중요도별로 요약해 줘')}>
            AI 요약
          </Button>
        </ButtonRow>
      }
    >
      {data.length === 0 ? (
        <Empty>{isLoading ? '불러오는 중입니다' : '알림이 없습니다'}</Empty>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {data.map((n) => (
            <NotificationCard key={n.id} n={n} />
          ))}
        </div>
      )}
    </Sheet>
  );
}

// ── 휴지통 ───────────────────────────────────────────────────

const KIND_LABEL: Record<TrashItem['kind'], string> = { blocks: '블록', data_tables: '표', data_rows: '행', tasks: '할 일', events: '일정' };

function TrashPanel() {
  const { close, toast } = useApp.getState();
  const { data = [], isLoading } = useTrash();
  const restore = async (item: TrashItem) => {
    try {
      await api.post(`/trash/${item.id}/restore`);
      await refresh();
      toast('복구했습니다');
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Sheet title="휴지통" icon="trash" onClose={close} width={720} tall>
      <p className="mb-3 text-xs text-sub">삭제한 것은 {TRASH_DAYS}일 동안 여기에 두었다가 완전히 지웁니다.</p>
      {data.length === 0 ? (
        <Empty>{isLoading ? '불러오는 중입니다' : '휴지통이 비어 있습니다'}</Empty>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {data.map((item) => (
            <div key={item.id} className="flex h-14 min-w-0 items-center gap-2 rounded-[10px] border pr-1 pl-3">
              <Tag>{KIND_LABEL[item.kind]}</Tag>
              <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
              <span className="shrink-0 text-xs whitespace-nowrap text-sub">{ago(item.deleted_at)}</span>
              <IconButton icon="undo" label="복구" onClick={() => restore(item)} />
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

// ── 창 띄우기 ─────────────────────────────────────────────────

function PanelView({ panel }: { panel: Panel }) {
  switch (panel.kind) {
    case 'menu':
      return <MenuPanel />;
    case 'more':
      return <MorePanel />;
    case 'add-block':
      return <AddBlockPanel />;
    case 'block':
      return <BlockPanel blockId={panel.blockId} />;
    case 'block-edit':
      return <BlockEditPanel blockId={panel.blockId} />;
    case 'task':
      return <TaskPanel taskId={panel.taskId} />;
    case 'event':
      return <EventPanel eventId={panel.eventId} />;
    case 'notifications':
      return <NotificationsPanel />;
    case 'trash':
      return <TrashPanel />;
    case 'tables':
      return <TablesPanel />;
    case 'table':
      return <TablePanel tableId={panel.tableId} addRow={panel.addRow} />;
    case 'upload':
      return <UploadPanel />;
    case 'sheet':
      return <SheetPanel connectorId={panel.connectorId} />;
    case 'settings':
      return <SettingsPanel initialTab={panel.tab} />;
    default:
      return null;
  }
}

/** 맨 위의 창 하나만 그린다. 닫으면 그 아래 창(예: 표 목록)이 다시 보인다. */
export function PanelHost() {
  const panels = useApp((s) => s.panels);
  const top = panels[panels.length - 1];
  if (!top) return null;
  return <PanelView key={`${panels.length}:${top.kind}:${'blockId' in top ? top.blockId : 'tableId' in top ? top.tableId : ''}`} panel={top} />;
}
