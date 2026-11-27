import { useEffect, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { BOARD_BGS, BOARD_BG_LABEL, boardBg, type BoardBg, type BoardDto } from '@jarvis/shared';
import { Icon } from '../components/Icon';
import { api, errorMessage } from '../lib/api';
import { keys, queryClient, refresh, useBoard } from '../lib/data';
import { useApp } from '../lib/store';

// 보드 전체 바탕색(2026-11-27 "배경 색깔 수정"). 값은 boards.theme.bg, 색 값은 styles.css 의 [data-board-bg].

async function setBoardBg(bg: BoardBg): Promise<void> {
  queryClient.setQueryData<BoardDto>(keys.board, (board) => board && { ...board, theme: { ...board.theme, bg } });
  try {
    await api.patch('/boards/current/theme', { bg });
  } catch (e) {
    useApp.getState().toast(errorMessage(e), 'error');
    void refresh('board');
  }
}

const POPOVER_WIDTH = 252;

/** 머리말의 보드 꾸미기 단추. 누르면 바탕색 동그라미가 뜬다. */
export function BoardStyleButton() {
  const { data: board } = useBoard();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const open = at !== null;
  const value = boardBg(board?.theme?.bg);

  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-board-style]')) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    if (open) return setAt(null);
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ x: Math.max(8, Math.min(r.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 8)), y: r.bottom + 6 });
  };

  return (
    <>
      <button
        type="button"
        data-board-style=""
        aria-label="보드 바탕색"
        title="보드 바탕색"
        aria-haspopup="true"
        aria-pressed={open}
        onClick={toggle}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sub hover:bg-tint hover:text-accent"
      >
        <Icon name="palette" size={18} />
      </button>
      {open &&
        createPortal(
          <div data-board-style="" className="anim-fade fixed z-[35] rounded-xl border bg-card p-3 shadow-lg" style={{ left: at.x, top: at.y, width: POPOVER_WIDTH }}>
            <p className="mb-2 text-xs font-medium text-sub">보드 바탕</p>
            <div role="radiogroup" aria-label="보드 바탕색" className="flex flex-wrap gap-2">
              {BOARD_BGS.map((bg) => (
                <button
                  key={bg}
                  type="button"
                  role="radio"
                  aria-checked={bg === value}
                  aria-label={BOARD_BG_LABEL[bg]}
                  title={BOARD_BG_LABEL[bg]}
                  data-board-bg={bg}
                  onClick={() => void setBoardBg(bg)}
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full border ${bg === value ? 'ring-2 ring-accent ring-offset-2' : ''}`}
                >
                  {bg === value && <Icon name="check" size={16} className={bg === 'slate' ? 'text-white' : 'text-ink'} />}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
