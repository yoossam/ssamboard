import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import GridLayout from 'react-grid-layout';
import { blockBg, boardBg, GRID_COLS, memoColor, MIN_BLOCK_SIZE, mobileOrder, titleColor, type BlockDto, type BoardDto, type GridPos } from '@jarvis/shared';
import { BLOCK_ICON, Icon } from '../components/Icon';
import { Button, Empty, IconButton, useIsPhone, useSize } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { keys, queryClient, refresh, useBoard } from '../lib/data';
import { dateLabel } from '../lib/format';
import { FILE_ACCEPT, filesFrom, googleLinksOnly, MAX_FILES, MAX_IMAGES, readAttachedFile, shrinkImage, splitFiles } from '../lib/images';
import { useApp } from '../lib/store';
import { BlockBody, BlockCount, TileLines } from './blocks';
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
 * 모든 블록은 배치 편집을 켜지 않아도 머리줄을 끌어 옮기고 모서리를 끌어 크기를 바꾼다(2026-11-27 "크기를 자유자재로").
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

/** 메모(붙임쪽지): 종이 색으로 칠하고, 얇은 머리띠를 잡아 언제든 옮긴다. 제목을 누르면 AI에 알려 줄 블록으로 고른다. */
function MemoCard({ block }: { block: BlockDto }) {
  const editMode = useApp((s) => s.editMode);
  const isSelected = useApp((s) => s.selected.includes(block.id));
  const toggleSelected = useApp((s) => s.toggleSelected);
  const open = useApp((s) => s.open);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  return (
    <article data-memo={memoColor(block.config.color)} className={`memo-card memo-paper flex h-full flex-col overflow-hidden rounded-xl border shadow-sm ${isSelected ? 'border-accent! ring-2 ring-accent/25' : ''}`}>
      <header className={`memo-bar flex h-9 shrink-0 items-center pr-0.5 pl-3 ${block.pinned ? '' : 'block-drag'}`}>
        <button
          type="button"
          aria-pressed={isSelected}
          title={isSelected ? 'AI 컨텍스트에서 빼기' : 'AI에 이 메모 알려주기'}
          onPointerDown={(e) => (pressedAt.current = { x: e.clientX, y: e.clientY })}
          onClick={(e) => {
            // 머리띠를 끌어 옮긴 끝에 생기는 누름은 고르기로 치지 않는다(자판으로 누른 것은 detail 이 0 이다).
            const from = pressedAt.current;
            if (e.detail !== 0 && from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 5) return;
            toggleSelected(block.id);
          }}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {isSelected && <Icon name="check" size={16} className="shrink-0 text-accent" />}
          <h2 data-title-color={titleColor(block.config.title_color)} className="truncate text-[15px] font-bold">{block.title}</h2>
        </button>
        <span className="no-drag flex shrink-0 items-center">
          <BlockStyleButton block={block} />
          {editMode && (
            <button type="button" aria-label="블록 편집" title="블록 편집" onClick={() => open({ kind: 'block-edit', blockId: block.id })} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink/60 hover:bg-black/5 hover:text-ink">
              <Icon name="edit" size={18} />
            </button>
          )}
          <button
            type="button"
            aria-label={block.pinned ? '고정 해제' : '고정'}
            title={block.pinned ? '고정 해제' : '고정'}
            aria-pressed={block.pinned}
            onClick={() => togglePin(block)}
            className={`memo-tool flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 ${block.pinned ? 'text-accent' : 'text-ink/60 hover:text-ink'}`}
          >
            <Icon name="pin" size={18} />
          </button>
        </span>
      </header>
      <BlockBody block={block} />
    </article>
  );
}

function BlockCard({ block }: { block: BlockDto }) {
  const editMode = useApp((s) => s.editMode);
  const isSelected = useApp((s) => s.selected.includes(block.id));
  const toggleSelected = useApp((s) => s.toggleSelected);
  const open = useApp((s) => s.open);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const bg = blockBg(block);
  return (
    <article
      data-memo={bg === 'white' ? undefined : bg}
      className={`memo-card flex h-full flex-col overflow-hidden rounded-xl border ${bg === 'white' ? 'bg-card' : 'memo-paper'} ${isSelected ? 'border-accent! ring-2 ring-accent/25' : ''}`}
    >
      <header className={`flex h-11 shrink-0 items-center gap-1 border-b border-rule pr-1 pl-3 ${block.pinned ? '' : 'block-drag'}`}>
        <button
          type="button"
          aria-pressed={isSelected}
          title={isSelected ? 'AI 컨텍스트에서 빼기' : 'AI에 이 블록 알려주기'}
          onPointerDown={(e) => (pressedAt.current = { x: e.clientX, y: e.clientY })}
          onClick={(e) => {
            // 머리줄을 끌어 옮긴 끝에 생기는 누름은 고르기로 치지 않는다(자판으로 누른 것은 detail 이 0 이다).
            const from = pressedAt.current;
            if (e.detail !== 0 && from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 5) return;
            toggleSelected(block.id);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon name={isSelected ? 'check' : BLOCK_ICON[block.type]} size={18} className="text-accent" />
          <h2 data-title-color={titleColor(block.config.title_color)} className="truncate text-[17px] font-bold">{block.title}</h2>
          <BlockCount block={block} />
        </button>
        <span className="no-drag flex shrink-0 items-center">
          <BlockStyleButton block={block} />
          {editMode && <IconButton icon="edit" label="블록 편집" size={32} onClick={() => open({ kind: 'block-edit', blockId: block.id })} />}
          <IconButton icon="pin" label={block.pinned ? '고정 해제(자리 고정 풀기)' : '자리 고정'} size={32} active={block.pinned} onClick={() => togglePin(block)} />
        </span>
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
            <div key={b.id}>{b.type === 'memo' ? <MemoCard block={b} /> : <BlockCard block={b} />}</div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}

/**
 * 휴대폰 보드: 2열 타일(한 화면에 2×3). 타일을 누르면 블록이 아래 시트로 열린다.
 * 길게 눌러 끌면 순서를 바꾸고, 그때부터 휴대폰 순서를 따로 저장한다(MOB-1·2).
 */
function PhoneBoard({ blocks }: { blocks: BlockDto[] }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const open = useApp((s) => s.open);
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
  const tileHeight = Math.max(132, Math.floor((size.height - 2 * 12) / 3));

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
    <div ref={ref} className="h-full select-none" onPointerMove={onPointerMove} onPointerUp={finish} onPointerCancel={finish} onContextMenu={(e) => e.preventDefault()} style={{ WebkitTouchCallout: 'none' }}>
      <div className="grid grid-cols-2 gap-3" style={{ gridAutoRows: tileHeight }}>
        {tiles.map((b) => (
          <div
            key={b.id}
            data-tile={b.id}
            data-memo={b.type === 'memo' ? memoColor(b.config.color) : blockBg(b) === 'white' ? undefined : blockBg(b)}
            role="button"
            tabIndex={0}
            onPointerDown={(e) => onPointerDown(e, b.id)}
            onClick={() => !suppressClick.current && open({ kind: 'block', blockId: b.id })}
            onKeyDown={(e) => e.key === 'Enter' && open({ kind: 'block', blockId: b.id })}
            className={`flex min-w-0 flex-col overflow-hidden rounded-xl border text-left transition ${b.type === 'memo' ? 'memo-paper' : 'bg-card'} ${dragId === b.id ? 'scale-[1.03] border-accent! shadow-lg ring-2 ring-accent/25' : ''}`}
          >
            <div className={`flex h-11 shrink-0 items-center gap-1.5 px-3 ${b.type === 'memo' ? 'memo-bar' : 'border-b border-rule'}`}>
              <Icon name={BLOCK_ICON[b.type]} size={18} className={b.pinned ? 'text-accent' : 'text-sub'} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{b.title}</span>
              <BlockCount block={b} />
            </div>
            <TileLines block={b} max={Math.max(1, Math.floor((tileHeight - 44 - 32) / 28))} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 아래 가운데의 AI 입력줄(ONE-2). 입력하면 AI 창이 열린다. Ctrl/Cmd + K로 바로 입력한다. */
function AiBar() {
  const phone = useIsPhone();
  const openAi = useApp((s) => s.openAi);
  const selected = useApp((s) => s.selected.length);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // 파일·이미지를 고르거나 붙여넣으면 AI 창으로 넘긴다. 쓴 말이 있으면 함께 보내고, 없으면 붙여 둔 채 할 말을 기다린다.
  const sendImages = async (all: File[]) => {
    if (all.length === 0) return;
    // 못 읽는 파일(옛 한글 HWP 등)은 빼고 알려 주고, 읽은 것만 넘긴다.
    const { images: pics, others } = splitFiles(all);
    const [images, files] = await Promise.all([
      Promise.allSettled(pics.slice(0, MAX_IMAGES).map(shrinkImage)),
      Promise.allSettled(others.slice(0, MAX_FILES).map(readAttachedFile)),
    ]);
    const okImages = images.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const okFiles = files.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    for (const r of [...images, ...files]) if (r.status === 'rejected') useApp.getState().toast(errorMessage(r.reason), 'error');
    if (okImages.length + okFiles.length === 0) return;
    openAi(text.trim() || undefined, undefined, okImages, okFiles);
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
      <button type="button" aria-label="파일·이미지 첨부" title="파일·이미지 첨부(PDF·한글·워드·엑셀·사진)" onClick={() => fileInput.current?.click()} className="flex size-10 shrink-0 items-center justify-center rounded-full text-sub hover:bg-tint hover:text-accent">
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
      {selected > 0 && <span className="shrink-0 rounded-md bg-tint px-2 py-1 text-xs font-medium whitespace-nowrap text-accent">블록 {selected}개</span>}
      {!phone && <kbd className="shrink-0 rounded-md bg-tag px-2 py-1 font-sans text-xs whitespace-nowrap text-tagink">Ctrl K</kbd>}
      <button type="submit" aria-label="보내기" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:brightness-110">
        <Icon name="send" size={18} />
      </button>
    </form>
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
