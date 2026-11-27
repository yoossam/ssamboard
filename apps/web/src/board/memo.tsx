import { useEffect, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { MEMO_COLORS, MEMO_COLOR_LABEL, memoColor, type BlockDto, type BoardDto, type MemoColor } from '@jarvis/shared';
import { Icon } from '../components/Icon';
import { api, errorMessage } from '../lib/api';
import { keys, queryClient, refresh } from '../lib/data';
import { useApp } from '../lib/store';

// 메모(붙임쪽지)의 종이 색. 색 이름은 shared 의 MEMO_COLORS, 색 값은 styles.css 의 [data-memo] 에 있다.

/** 색은 누르자마자 바꾸고 저장한다. 서버는 config 를 보낸 키만 바꾸므로 메모 글과 서로 덮어쓰지 않는다. */
export async function setMemoColor(block: BlockDto, color: MemoColor): Promise<void> {
  if (memoColor(block.config.color) === color && block.config.color === color) return;
  queryClient.setQueryData<BoardDto>(keys.board, (board) => board && { ...board, blocks: board.blocks.map((b) => (b.id === block.id ? { ...b, config: { ...b.config, color } } : b)) });
  try {
    await api.patch(`/blocks/${block.id}`, { config: { color } });
  } catch (e) {
    useApp.getState().toast(errorMessage(e), 'error');
    void refresh('board');
  }
}

/** 색 동그라미 한 줄. 고른 색에는 테두리 고리가 생긴다. */
export function MemoColorDots({ value, onPick }: { value: MemoColor; onPick: (color: MemoColor) => void }) {
  return (
    <div role="radiogroup" aria-label="종이 색" className="flex flex-wrap gap-2">
      {MEMO_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === value}
          aria-label={MEMO_COLOR_LABEL[color]}
          title={MEMO_COLOR_LABEL[color]}
          data-memo={color}
          onClick={() => onPick(color)}
          className={`memo-dot flex size-8 shrink-0 items-center justify-center rounded-full text-ink ${color === value ? 'ring-2 ring-accent ring-offset-2' : ''}`}
        >
          {color === value && <Icon name="check" size={16} />}
        </button>
      ))}
    </div>
  );
}

const POPOVER_WIDTH = 306;

/** 메모 머리띠의 색 단추. 누르면 그 아래에 색 동그라미가 뜬다(격자 칸이 좁아도 잘리지 않게 화면 맨 위 층에 그린다). */
export function MemoColorButton({ block }: { block: BlockDto }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-memo-colors]')) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    if (open) return setAt(null);
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ x: Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_WIDTH - 8)), y: r.bottom + 6 });
  };

  return (
    <>
      <button
        type="button"
        data-memo-colors=""
        aria-label="종이 색"
        title="종이 색"
        aria-haspopup="true"
        aria-pressed={open}
        onClick={toggle}
        className="memo-tool flex size-8 shrink-0 items-center justify-center rounded-lg text-ink/60 hover:bg-black/5 hover:text-ink"
      >
        <Icon name="palette" size={18} />
      </button>
      {open &&
        createPortal(
          <div data-memo-colors="" className="anim-fade fixed z-[35] rounded-xl border bg-card p-3 shadow-lg" style={{ left: at.x, top: at.y, width: POPOVER_WIDTH }}>
            <MemoColorDots
              value={memoColor(block.config.color)}
              onPick={(color) => {
                setAt(null);
                void setMemoColor(block, color);
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
