import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import GridLayout from 'react-grid-layout';
import { blockBg, boardBg, GRID_COLS, memoColor, MIN_BLOCK_SIZE, mobileOrder, SHAREABLE_BLOCKS, titleColor, type BlockDto, type BoardDto, type GridPos } from '@jarvis/shared';
import { BLOCK_ICON, Icon } from '../components/Icon';
import { Button, CountBadge, Empty, IconButton, useIsPhone, useSize } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { keys, queryClient, refresh, useBoard, useCommands, useEvents, useNotifications, useSettings, useTasks } from '../lib/data';
import { dateLabel, dayKey } from '../lib/format';
import { FILE_ACCEPT, filesFrom, googleLinksOnly, MAX_FILES, MAX_IMAGES, readAttachedFile, shrinkImage, splitFiles } from '../lib/images';
import { useApp } from '../lib/store';
import { showOnBoard } from '../lib/results';
import { BlockBody, BlockCount, PhoneTasks, TileLines } from './blocks';
import { BlockStyleButton } from './memo';
import { BoardStyleButton } from './boardStyle';
import { MenuBar } from '../menu/menu';

// 한 페이지 보드(ONE-1). PC는 24칸 격자에 블록을 놓고, 휴대폰은 2열 타일로 보여준다.

const GAP = 10;
/** 화면 높이를 격자 16줄로 나눈다. 기본 배치(블록 높이 8줄 × 2단)가 스크롤 없이 한 화면에 들어온다. */
const ROWS_PER_SCREEN = 16;
/** 화면이 낮아도 한 줄은 이만큼은 된다(그보다 낮으면 보드가 세로로 스크롤된다). */
const MIN_ROW_HEIGHT = 16;
const AI_PANEL_WIDTH = 420;

interface Item extends GridPos {
  i: string;
  static?: boolean;
  minW?: number;
  minH?: number;
  isDraggable?: boolean;
  isResizable?: boolean;
}

/**
 * 모든 블록은 배치 편집을 켜지 않아도 옮기고 모서리를 끌어 크기를 바꾼다(2026-11-27 "크기를 자유자재로").
 * 옮기기는 머리줄 왼쪽 손잡이(⠿)를 잡을 때만 — 제목·단추를 누르다 블록이 밀리지 않게(2026-11-28 UX 토론 H, 선생님 결정을 지킨 수정안).
 * 고정한 블록은 자리만 붙박이고 크기는 바꿀 수 있다.
 */
const toItems = (blocks: BlockDto[]): Item[] =>
  blocks.map((b) => {
    const min = MIN_BLOCK_SIZE[b.type] ?? MIN_BLOCK_SIZE.tasks;
    return { i: b.id, ...b.layout_lg, minW: min.w, minH: min.h, isDraggable: !b.pinned, isResizable: true };
  });
const samePos = (a: GridPos, b: GridPos) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

function patchBoard(update: (blocks: BlockDto[]) => BlockDto[]): void {
  queryClient.setQueryData<BoardDto>(keys.board, (board) => board && { ...board, blocks: update(board.blocks) });
}

export async function togglePin(block: BlockDto): Promise<void> {
  patchBoard((blocks) => blocks.map((b) => (b.id === block.id ? { ...b, pinned: !block.pinned } : b)));
  try {
    await api.patch(`/blocks/${block.id}`, { pinned: !block.pinned });
  } catch (e) {
    useApp.getState().toast(errorMessage(e), 'error');
    void refresh('board');
  }
}

function TopBar() {
  const open = useApp((s) => s.open);
  const phone = useIsPhone();
  const editMode = useApp((s) => s.editMode);
  const setEditMode = useApp((s) => s.setEditMode);
  return (
    <header className="z-20 shrink-0 border-b bg-card">
      {/* 머리말은 얇게(2026-11-27 "로고 최소화, 화면 전체를 다 쓰게") — 이름·날짜는 작게, 단추는 오른쪽에 모은다 */}
      <div className="flex h-10 items-center gap-1 px-1">
        <IconButton icon="menu" label="메뉴" size={36} onClick={() => open({ kind: 'menu' })} />
        <h1 className="text-sm font-bold text-accent">쌤보드</h1>
        <span className="min-w-0 shrink-0 truncate text-xs text-sub">{dateLabel(new Date())}</span>
        {/* 내 메뉴(위쪽 바로가기) — 휴대폰은 아래 한 줄 */}
        {phone ? <span className="flex-1" /> : <MenuBar />}
        <ResultsButton />
        <BoardStyleButton />
        <IconButton icon="more" label="더보기" size={36} onClick={() => open({ kind: 'more' })} />
      </div>
      {phone && <MenuBar />}
      {editMode && (
        <div className="flex h-11 items-center justify-between gap-3 border-t border-rule bg-tint pr-1.5 pl-4">
          <p className="min-w-0 truncate text-sm font-medium text-accent">배치 편집 중 · 머리줄을 끌어 옮기고 모서리로 크기를 조절합니다</p>
          <Button icon="check" tone="primary" onClick={() => setEditMode(false)}>
            완료
          </Button>
        </div>
      )}
    </header>
  );
}

/**
 * 블록 글자 배율: 블록이 작아지면 글자도 작게, 넓고 높으면 조금 크게. 너비 380px·높이 260px 이면 1.
 * 읽기 어렵지 않게 0.88(본문 약 13px) 아래로는 줄이지 않고, 1.15 위로는 키우지 않는다.
 */
export const BLOCK_SCALE_MIN = 0.88;
export const BLOCK_SCALE_MAX = 1.15;
export function blockScale(size: { width: number; height: number }): number {
  if (!size.width || !size.height) return 1;
  const s = Math.min(size.width / 380, size.height / 260);
  return Math.round(Math.min(BLOCK_SCALE_MAX, Math.max(BLOCK_SCALE_MIN, s)) * 100) / 100;
}

/** 머리줄의 '크게 보기' — 블록을 큰 창으로 */
function ExpandButton({ block }: { block: BlockDto }) {
  const open = useApp((s) => s.open);
  return <IconButton icon="expand" label="크게 보기" size={32} onClick={() => open({ kind: 'block', blockId: block.id })} />;
}

/** 위쪽 줄의 [처리 결과] — 승인을 기다리는 것이 있으면 숫자를 단다(2026-11-28 UX 토론 A) */
function ResultsButton() {
  const open = useApp((s) => s.open);
  const phone = useIsPhone();
  const { data } = useCommands();
  const waiting = data?.filter((c) => c.status === 'proposed').length ?? 0;
  return (
    <button
      type="button"
      onClick={() => open({ kind: 'results' })}
      aria-label={`처리 결과${waiting > 0 ? ` · 승인 대기 ${waiting}건` : ''}`}
      title="AI 에게 맡긴 일의 결과(파일·링크·되돌리기)"
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-ink hover:bg-tint"
    >
      <Icon name="archive" size={18} className="text-accent" />
      {!phone && '처리 결과'}
      {waiting > 0 && <CountBadge n={waiting} alert />}
    </button>
  );
}

/** 오늘 확인할 것 한 줄(2026-11-28 UX 토론 B) — 0건은 숨기고, 다 0이면 줄도 없다. 누르면 그 블록·창으로. */
function TodayBar({ blocks }: { blocks: BlockDto[] }) {
  const open = useApp((s) => s.open);
  const toast = useApp((s) => s.toast);
  const { data: tasks = [] } = useTasks();
  const { data: events = [] } = useEvents();
  const { data: notis = [] } = useNotifications();
  const { data: cmds = [] } = useCommands();
  const now = Date.now();
  const today = dayKey(new Date());
  const openTasks = tasks.filter((t) => t.status === 'open' && t.due_at);
  const overdue = openTasks.filter((t) => new Date(t.due_at!).getTime() < now).length;
  const dueToday = openTasks.filter((t) => new Date(t.due_at!).getTime() >= now && dayKey(t.due_at!) === today).length;
  const eventsLeft = events.filter((e) => dayKey(e.start_at) === today && new Date(e.end_at ?? e.start_at).getTime() >= now).length;
  const unread = notis.filter((n) => n.status === 'unread').length;
  const waiting = cmds.filter((c) => c.status === 'proposed').length;
  const flashType = (type: BlockDto['type'], what: string) => {
    const ids = blocks.filter((b) => b.type === type).map((b) => b.id);
    if (ids.length === 0) return toast(`보드에 ${what} 블록이 없습니다. ⋯ → 블록 추가에서 넣을 수 있습니다`, 'error');
    showOnBoard({ touched: ids.map((id) => ({ entity: 'blocks', id })) });
  };
  const chips = [
    { n: waiting, label: '승인 대기', tone: 'accent', go: () => open({ kind: 'results' }) },
    { n: overdue, label: '마감 지남', tone: 'danger', go: () => flashType('tasks', '할 일') },
    { n: dueToday, label: '오늘 마감', tone: 'plain', go: () => flashType('tasks', '할 일') },
    { n: eventsLeft, label: '오늘 남은 일정', tone: 'plain', go: () => flashType('events', '일정') },
    { n: unread, label: '안 읽은 알림', tone: 'plain', go: () => open({ kind: 'notifications' }) },
  ].filter((c) => c.n > 0);
  if (chips.length === 0) return null;
  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-rule bg-card px-2.5 [scrollbar-width:none]" aria-label="오늘 확인할 것">
      <span className="shrink-0 pr-1 text-xs font-bold text-sub">오늘 확인</span>
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={c.go}
          className={`flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-sm whitespace-nowrap transition hover:bg-tint ${c.tone === 'danger' ? 'border-danger/50 text-danger' : c.tone === 'accent' ? 'border-accent/50 text-accent' : ''}`}
        >
          {c.label} <b className="tabular-nums">{c.n}</b>
        </button>
      ))}
    </div>
  );
}

/** 'AI 에 알려 주기' — 제목과 따로 있는 체크(2026-11-28 UX 토론 D). 고르면 다음 요청에 이 블록 내용을 함께 보낸다. */
function AiPick({ block }: { block: BlockDto }) {
  const isSelected = useApp((s) => s.selected.includes(block.id));
  const toggleSelected = useApp((s) => s.toggleSelected);
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      aria-label={isSelected ? 'AI 에 알려 주기 빼기' : 'AI 에 이 블록 알려 주기'}
      title={isSelected ? 'AI 에 알려 줄 블록에서 빼기' : 'AI 에 이 블록 알려 주기(다음 요청에 함께 보냅니다)'}
      onClick={() => toggleSelected(block.id)}
      className={`flex h-7 shrink-0 items-center gap-0.5 rounded-full border px-2 text-xs font-bold transition ${isSelected ? 'border-accent bg-accent text-white' : 'border-field text-sub hover:border-accent hover:text-accent'}`}
    >
      {isSelected ? <Icon name="check" size={13} /> : <Icon name="sparkle" size={13} />}AI
    </button>
  );
}

/** 머리줄 왼쪽 손잡이 — 여기를 잡아야만 옮겨진다(UX 토론 H). 고정한 블록은 핀 표시. */
function Grip({ block }: { block: BlockDto }) {
  if (block.pinned)
    return (
      <span title="자리 고정됨" className="flex w-5 shrink-0 justify-center">
        <Icon name="pin" size={15} className="text-accent" />
      </span>
    );
  return (
    <span className="block-drag -ml-1.5 flex h-9 w-6 shrink-0 cursor-grab items-center justify-center rounded text-sub/70 hover:bg-black/5 hover:text-ink active:cursor-grabbing" title="끌어서 옮기기">
      <Icon name="drag" size={16} />
    </span>
  );
}

/** 머리줄 오른쪽: [AI][공유(되는 블록만)][크게 보기][⋯ 편집·고정·꾸미기] */
function BlockTools({ block }: { block: BlockDto }) {
  const open = useApp((s) => s.open);
  const row = 'flex h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-tint';
  return (
    <span className="no-drag flex shrink-0 items-center gap-0.5">
      <AiPick block={block} />
      {SHAREABLE_BLOCKS.includes(block.type) && <IconButton icon="link" label="공유 링크" size={32} onClick={() => open({ kind: 'share', blockId: block.id })} />}
      <ExpandButton block={block} />
      <BlockStyleButton
        block={block}
        icon="more"
        label="더보기 — 편집·고정·꾸미기"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink/60 hover:bg-black/5 hover:text-ink"
        actions={(close) => (
          <>
            <button
              type="button"
              className={row}
              onClick={() => {
                close();
                open({ kind: 'block-edit', blockId: block.id });
              }}
            >
              <Icon name="edit" size={18} className="text-sub" />
              블록 편집(제목·보여 줄 내용·삭제)
            </button>
            <button
              type="button"
              className={row}
              onClick={() => {
                close();
                void togglePin(block);
              }}
            >
              <Icon name="pin" size={18} className={block.pinned ? 'text-accent' : 'text-sub'} />
              {block.pinned ? '자리 고정 풀기' : '자리 고정'}
            </button>
          </>
        )}
      />
    </span>
  );
}

const ringOf = (selected: boolean, lit: boolean) => (lit ? 'flash-ring border-accent!' : selected ? 'border-accent! ring-2 ring-accent/25' : '');

/** 메모(붙임쪽지): 종이 색으로 칠하고, 손잡이를 잡아 옮긴다. */
function MemoCard({ block }: { block: BlockDto }) {
  const isSelected = useApp((s) => s.selected.includes(block.id));
  const lit = useApp((s) => s.highlight.includes(block.id));
  const [ref, size] = useSize<HTMLElement>();
  return (
    <article
      ref={ref}
      data-memo={memoColor(block.config.color)}
      style={{ '--fs': blockScale(size) } as CSSProperties}
      className={`memo-card memo-paper block-scale flex h-full flex-col overflow-hidden rounded-xl border shadow-sm ${ringOf(isSelected, lit)}`}
    >
      <header className="memo-bar flex h-9 shrink-0 items-center gap-1 pr-0.5 pl-2">
        <Grip block={block} />
        <h2 data-title-color={titleColor(block.config.title_color)} className="min-w-0 flex-1 truncate text-[calc(15px*var(--fs,1))] font-bold">
          {block.title}
        </h2>
        <BlockTools block={block} />
      </header>
      <BlockBody block={block} />
    </article>
  );
}

function BlockCard({ block }: { block: BlockDto }) {
  const isSelected = useApp((s) => s.selected.includes(block.id));
  const lit = useApp((s) => s.highlight.includes(block.id));
  const bg = blockBg(block);
  const [ref, size] = useSize<HTMLElement>();
  return (
    <article
      ref={ref}
      data-memo={bg === 'white' ? undefined : bg}
      style={{ '--fs': blockScale(size) } as CSSProperties}
      className={`memo-card block-scale flex h-full flex-col overflow-hidden rounded-xl border ${bg === 'white' ? 'bg-card' : 'memo-paper'} ${ringOf(isSelected, lit)}`}
    >
      <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-rule pr-1 pl-2">
        <Grip block={block} />
        <Icon name={BLOCK_ICON[block.type]} size={18} className="shrink-0 text-accent" />
        <h2 data-title-color={titleColor(block.config.title_color)} className="min-w-0 truncate text-[calc(17px*var(--fs,1))] font-bold">
          {block.title}
        </h2>
        <BlockCount block={block} />
        <span className="flex-1" />
        <BlockTools block={block} />
      </header>
      <BlockBody block={block} />
    </article>
  );
}

function DesktopBoard({ blocks }: { blocks: BlockDto[] }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const editMode = useApp((s) => s.editMode);
  const [items, setItems] = useState<Item[]>(() => toItems(blocks));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(blocks);
  latest.current = blocks;

  /** 사용자가 마지막으로 블록을 끌어 놓은 때. 배치 편집 밖에서는 이 직후의 변경만 저장한다. */
  const droppedAt = useRef(0);
  const markDrop = () => {
    droppedAt.current = Date.now();
  };

  // 서버의 배치가 달라지면(다른 기기, AI의 변경) 그대로 따른다.
  const serverKey = JSON.stringify(blocks.map((b) => [b.id, b.layout_lg, b.pinned]));
  useEffect(() => setItems(toItems(latest.current)), [serverKey]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onLayoutChange = (next: Item[]) => {
    // 배치 편집 밖에서는 직접 끌어 놓거나 크기를 바꾼 때만 받아들인다(격자는 그 바로 뒤에 이 함수를 부른다).
    if (!editMode && Date.now() - droppedAt.current > 1000) return;
    const moved = new Map(next.map((n) => [n.i, n]));
    setItems(
      toItems(latest.current).map((item) => {
        const n = moved.get(item.i);
        return n ? { ...item, x: n.x, y: n.y, w: n.w, h: n.h } : item;
      }),
    );
    // 변경 1초 뒤에 저장한다(BRD-4).
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const changed = next
        .map((n) => ({ id: n.i, layout_lg: { x: n.x, y: n.y, w: n.w, h: n.h } }))
        .filter((n) => {
          const block = latest.current.find((b) => b.id === n.id);
          return block && !samePos(block.layout_lg, n.layout_lg);
        });
      if (changed.length === 0) return;
      patchBoard((list) => list.map((b) => ({ ...b, layout_lg: changed.find((c) => c.id === b.id)?.layout_lg ?? b.layout_lg })));
      try {
        await api.put('/boards/current/layout', { blocks: changed });
      } catch (e) {
        useApp.getState().toast(errorMessage(e), 'error');
        void refresh('board');
      }
    }, 1000);
  };

  const rowHeight = Math.max(MIN_ROW_HEIGHT, Math.floor((size.height - (ROWS_PER_SCREEN - 1) * GAP) / ROWS_PER_SCREEN));
  return (
    <div ref={ref} className="h-full">
      {size.width > 0 && (
        <GridLayout
          width={size.width}
          cols={GRID_COLS}
          rowHeight={rowHeight}
          margin={[GAP, GAP]}
          containerPadding={[0, 0]}
          layout={items}
          isDraggable
          isResizable
          draggableHandle=".block-drag"
          draggableCancel=".no-drag"
          compactType="vertical"
          onDragStop={markDrop}
          onResizeStop={markDrop}
          onLayoutChange={onLayoutChange}
        >
          {blocks.map((b) => (
            <div key={b.id} data-block={b.id}>
              {b.type === 'memo' ? <MemoCard block={b} /> : <BlockCard block={b} />}
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}

/**
 * 휴대폰 보드: 1열 카드(2026-11-28 UX 토론 F — 2열 타일은 글이 좁아 보기만 됐다).
 * 할 일 카드는 시트를 열지 않고 바로 체크·더하기, 다른 카드는 몇 줄 미리 보기. 머리줄을 누르면 블록이 아래 시트로 열린다.
 * 머리줄을 길게 눌러 끌면 순서를 바꾸고, 그때부터 휴대폰 순서를 따로 저장한다(MOB-1·2).
 */
function PhoneBoard({ blocks }: { blocks: BlockDto[] }) {
  const [ref] = useSize<HTMLDivElement>();
  const open = useApp((s) => s.open);
  const lit = useApp((s) => s.highlight);
  const base = useMemo(() => mobileOrder(blocks).map((b) => b.id), [blocks]);
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const moved = useRef(false);
  const suppressClick = useRef(false);
  const dragging = useRef(false);
  dragging.current = dragId !== null;

  const ids = order ?? base;
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const tiles = ids.map((id) => byId.get(id)).filter((b): b is BlockDto => !!b);

  // 끄는 동안에는 화면이 같이 스크롤되지 않게 막는다.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (dragging.current) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, [ref]);

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  const onPointerDown = (e: ReactPointerEvent, id: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelPress();
    moved.current = false;
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press.current = null;
        setOrder(ids);
        setDragId(id);
        navigator.vibrate?.(10);
      }, 450),
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 8) cancelPress();
    if (!dragId || !order) return;
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-tile]')?.dataset.tile;
    if (!target || target === dragId) return;
    const next = order.filter((x) => x !== dragId);
    next.splice(order.indexOf(target), 0, dragId);
    moved.current = true;
    setOrder(next);
  };

  const finish = async () => {
    cancelPress();
    if (!dragId) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 350);
    setDragId(null);
    if (!moved.current || !order) return setOrder(null);
    const saved = order.map((id, i) => ({ id, layout_sm: { order: i } }));
    patchBoard((list) => list.map((b) => ({ ...b, layout_sm: saved.find((s) => s.id === b.id)?.layout_sm ?? b.layout_sm })));
    setOrder(null);
    try {
      await api.put('/boards/current/layout', { blocks: saved });
    } catch (err) {
      useApp.getState().toast(errorMessage(err), 'error');
      void refresh('board');
    }
  };

  return (
    <div ref={ref} className="h-full" onPointerMove={onPointerMove} onPointerUp={finish} onPointerCancel={finish}>
      <div className="flex flex-col gap-2.5">
        {tiles.map((b) => (
          <section
            key={b.id}
            data-tile={b.id}
            data-block={b.id}
            data-memo={b.type === 'memo' ? memoColor(b.config.color) : blockBg(b) === 'white' ? undefined : blockBg(b)}
            className={`flex min-w-0 flex-col overflow-hidden rounded-xl border transition ${b.type === 'memo' || blockBg(b) !== 'white' ? 'memo-paper' : 'bg-card'} ${dragId === b.id ? 'scale-[1.02] border-accent! shadow-lg ring-2 ring-accent/25' : ''} ${lit.includes(b.id) ? 'flash-ring border-accent!' : ''}`}
          >
            <div
              role="button"
              tabIndex={0}
              onPointerDown={(e) => onPointerDown(e, b.id)}
              onClick={() => !suppressClick.current && open({ kind: 'block', blockId: b.id })}
              onKeyDown={(e) => e.key === 'Enter' && open({ kind: 'block', blockId: b.id })}
              // 길게 눌러 끄는 머리줄만 글자 고르기·길게 누름 메뉴를 막는다(바로 더하기 칸은 그대로 — 제미나이 재검토)
              onContextMenu={(e) => e.preventDefault()}
              style={{ WebkitTouchCallout: 'none' }}
              className={`flex h-12 shrink-0 items-center gap-2 px-3 select-none ${b.type === 'memo' ? 'memo-bar' : 'border-b border-rule'}`}
            >
              <Icon name={BLOCK_ICON[b.type]} size={20} className={b.pinned ? 'text-accent' : 'text-sub'} />
              <span data-title-color={titleColor(b.config.title_color)} className="min-w-0 flex-1 truncate text-base font-bold">
                {b.title}
              </span>
              <BlockCount block={b} />
              <Icon name="next" size={18} className="shrink-0 text-sub" />
            </div>
            {b.type === 'tasks' ? <PhoneTasks block={b} /> : <TileLines block={b} max={4} big />}
          </section>
        ))}
      </div>
    </div>
  );
}

/** 보내자마자 AI 가 시작하는 말 — 가정통신문에서 일정 뽑기 */
const NOTICE_PROMPT = '첨부한 가정통신문(안내문)에서 날짜가 있는 행사·마감을 찾아 일정과 할 일로 넣어 줘. 날짜·시간이 분명하지 않은 것은 따로 알려 줘.';

/**
 * AI 입력줄 위의 빠른 업무 3개(2026-11-28 UX 토론 C). 빈칸 앞에서 할 말을 고민하지 않게, 필요한 자료부터 받는다.
 * AI 열쇠가 없으면 먼저 열쇠 넣는 곳으로 안내한다(토론 I 의 단서).
 */
function QuickTasks({ onFiles, onText }: { onFiles: (files: File[], prompt?: string) => void; onText: (text: string) => void }) {
  const { data: settings } = useSettings();
  const open = useApp((s) => s.open);
  const toast = useApp((s) => s.toast);
  const notice = useRef<HTMLInputElement>(null);
  const edit = useRef<HTMLInputElement>(null);
  const ready = () => {
    if (settings && settings.api_keys.length === 0) {
      toast('AI 열쇠를 먼저 넣어 주세요 — 설정 → 일반에서 넣습니다', 'error');
      open({ kind: 'settings', tab: 'general' });
      return false;
    }
    return true;
  };
  const chip = 'flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 text-sm whitespace-nowrap shadow-sm transition hover:border-accent hover:text-accent';
  return (
    <div className="mb-1.5 flex items-center gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]" aria-label="빠른 업무">
      <button type="button" className={chip} onClick={() => ready() && notice.current?.click()} title="가정통신문 사진·PDF·한글 파일을 고르면 날짜를 찾아 일정·할 일로 넣습니다">
        <Icon name="calendar" size={16} className="text-accent" />
        통신문 → 일정
      </button>
      <button type="button" className={chip} onClick={() => ready() && edit.current?.click()} title="엑셀·한글(hwpx) 파일을 고르고 고칠 내용을 적으면 고친 파일을 만들어 줍니다">
        <Icon name="edit" size={16} className="text-accent" />
        파일 고치기
      </button>
      <button type="button" className={chip} onClick={() => ready() && onText('구글 설문 만들어 줘 — 주제: ')} title="주제와 문항을 적으면 구글 설문과 응답 표를 만들어 줍니다">
        <Icon name="sheet" size={16} className="text-accent" />
        설문 만들기
      </button>
      <input
        ref={notice}
        type="file"
        accept="image/*,.pdf,.hwpx,.docx"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files, NOTICE_PROMPT);
        }}
      />
      <input
        ref={edit}
        type="file"
        accept=".xlsx,.hwpx"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) {
            onFiles(files); // 할 말 없이 붙여 두면 AI 창이 고칠 내용을 기다린다
            toast('무엇을 고칠지 적어 보내세요');
          }
        }}
      />
    </div>
  );
}

/** 아래 가운데의 AI 입력줄(ONE-2). 입력하면 AI 창이 열린다. Ctrl/Cmd + K로 바로 입력한다. */
function AiBar() {
  const phone = useIsPhone();
  const openAi = useApp((s) => s.openAi);
  const selected = useApp((s) => s.selected.length);
  const clearSelected = useApp((s) => s.clearSelected);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // 파일·이미지를 고르거나 붙여넣으면 AI 창으로 넘긴다. 쓴 말이 있으면 함께 보내고, 없으면 붙여 둔 채 할 말을 기다린다.
  const sendImages = async (all: File[], prompt?: string) => {
    if (all.length === 0) return;
    // 못 읽는 파일(옛 한글 HWP 등)은 빼고 알려 주고, 읽은 것만 넘긴다.
    const { images: pics, others } = splitFiles(all);
    const [images, files] = await Promise.all([Promise.allSettled(pics.slice(0, MAX_IMAGES).map(shrinkImage)), Promise.allSettled(others.slice(0, MAX_FILES).map(readAttachedFile))]);
    const okImages = images.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const okFiles = files.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    for (const r of [...images, ...files]) if (r.status === 'rejected') useApp.getState().toast(errorMessage(r.reason), 'error');
    if (okImages.length + okFiles.length === 0) return;
    openAi(prompt ?? (text.trim() || undefined), undefined, okImages, okFiles);
    setText('');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const s = useApp.getState();
        if (s.panels.length === 0 && !s.aiOpen) input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = () => {
    openAi(text.trim() || undefined);
    setText('');
  };

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <QuickTasks
        onFiles={(files, prompt) => void sendImages(files, prompt)}
        onText={(t) => {
          setText(t);
          setTimeout(() => {
            input.current?.focus();
            input.current?.setSelectionRange(t.length, t.length);
          }, 0);
        }}
      />
      <form
        className="mx-auto flex h-[52px] w-full max-w-[720px] items-center gap-2 rounded-[26px] border border-field bg-card pr-1.5 pl-4 shadow-lg focus-within:border-accent"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Icon name="sparkle" className="text-accent" />
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = filesFrom(e.clipboardData);
            if (pasted.length > 0) {
              e.preventDefault();
              void sendImages(pasted);
              return;
            }
            // 구글 문서·시트 링크만 붙여 넣으면 첨부(링크)로 AI 창에 넘긴다
            const found = googleLinksOnly(e.clipboardData.getData('text'));
            if (found.length === 0) return;
            e.preventDefault();
            openAi(text.trim() || undefined, undefined, [], [], found);
            setText('');
          }}
          placeholder="무엇을 도와드릴까요?"
          aria-label="AI에게 요청"
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <button
          type="button"
          aria-label="파일·이미지 첨부"
          title="파일·이미지 첨부(PDF·한글·워드·엑셀·사진)"
          onClick={() => fileInput.current?.click()}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-sub hover:bg-tint hover:text-accent"
        >
          <Icon name="clip" size={20} />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void sendImages(files);
          }}
        />
        {selected > 0 && (
          <button
            type="button"
            onClick={clearSelected}
            title="AI 에 알려 줄 블록 비우기(보내면 저절로 비워집니다)"
            className="flex shrink-0 items-center gap-1 rounded-md bg-tint px-2 py-1 text-xs font-medium whitespace-nowrap text-accent hover:bg-accent hover:text-white"
          >
            블록 {selected}개 <Icon name="close" size={12} />
          </button>
        )}
        {!phone && <kbd className="shrink-0 rounded-md bg-tag px-2 py-1 font-sans text-xs whitespace-nowrap text-tagink">Ctrl K</kbd>}
        <button type="submit" aria-label="보내기" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:brightness-110">
          <Icon name="send" size={18} />
        </button>
      </form>
    </div>
  );
}

export function Board() {
  const phone = useIsPhone();
  const { data: board, isLoading, error } = useBoard();
  const open = useApp((s) => s.open);
  const aiOpen = useApp((s) => s.aiOpen);
  const aiLayout = useApp((s) => s.aiLayout);
  const setEditMode = useApp((s) => s.setEditMode);
  const sidePanel = !phone && aiOpen && aiLayout === 'panel';

  // 휴대폰은 보기 모드가 기본이다(MOB-2).
  useEffect(() => {
    if (phone) setEditMode(false);
  }, [phone, setEditMode]);

  const blocks = board?.blocks ?? [];
  return (
    <div data-board-bg={boardBg(board?.theme?.bg)} className="flex h-dvh flex-col" style={{ paddingRight: sidePanel ? AI_PANEL_WIDTH : 0 }}>
      <TopBar />
      {board && blocks.length > 0 && <TodayBar blocks={blocks} />}
      <main className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto ${phone ? 'p-2' : 'p-2.5'}`}>
        {error ? (
          <Empty>{errorMessage(error)}</Empty>
        ) : !board ? (
          <Empty>{isLoading ? '보드를 불러오는 중입니다' : ''}</Empty>
        ) : blocks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-sub">보드가 비어 있습니다</p>
            <Button icon="plus" tone="primary" onClick={() => open({ kind: 'add-block' })}>
              블록 추가
            </Button>
          </div>
        ) : phone ? (
          <PhoneBoard blocks={blocks} />
        ) : (
          <DesktopBoard blocks={blocks} />
        )}
      </main>
      {/* AI 창이 열려 있어도 자리는 그대로 둔다. 보드 높이가 달라져 블록이 출렁이지 않게 한다. */}
      <div className={`shrink-0 ${phone ? 'px-3 pt-1 pb-[max(12px,env(safe-area-inset-bottom))]' : 'px-4 pt-0.5 pb-2.5'} ${aiOpen ? 'invisible' : ''}`}>
        <AiBar />
      </div>
    </div>
  );
}
