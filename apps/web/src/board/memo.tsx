import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { blockBg, MEMO_COLORS, MEMO_COLOR_LABEL, TITLE_COLORS, TITLE_COLOR_LABEL, titleColor, type BlockDto, type BoardDto, type MemoColor, type TitleColor } from '@jarvis/shared';
import { Icon } from '../components/Icon';
import { api, errorMessage } from '../lib/api';
import { keys, queryClient, refresh } from '../lib/data';
import { useApp } from '../lib/store';

// 메모(붙임쪽지)의 종이 색. 색 이름은 shared 의 MEMO_COLORS, 색 값은 styles.css 의 [data-memo] 에 있다.

/**
 * 꾸미기 값(바탕·제목 색)은 누르자마자 바꾸고 저장한다. 서버는 config 를 보낸 키만 바꾸므로 메모 글과 서로 덮어쓰지 않는다.
 * 메모의 바탕은 옛 이름 그대로 config.color, 다른 블록은 config.bg.
 */
export async function setBlockStyle(block: BlockDto, change: { bg?: MemoColor; title_color?: TitleColor }): Promise<void> {
  const patch: Record<string, string> = {};
  if (change.bg) patch[block.type === 'memo' ? 'color' : 'bg'] = change.bg;
  if (change.title_color) patch.title_color = change.title_color;
  queryClient.setQueryData<BoardDto>(keys.board, (board) => board && { ...board, blocks: board.blocks.map((b) => (b.id === block.id ? { ...b, config: { ...b.config, ...patch } } : b)) });
  try {
    await api.patch(`/blocks/${block.id}`, { config: patch });
  } catch (e) {
    useApp.getState().toast(errorMessage(e), 'error');
    void refresh('board');
  }
}

/** 제목 글자색 동그라미 한 줄. */
export function TitleColorDots({ value, onPick }: { value: TitleColor; onPick: (color: TitleColor) => void }) {
  return (
    <div role="radiogroup" aria-label="제목 색" className="flex flex-wrap gap-2">
      {TITLE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === value}
          aria-label={TITLE_COLOR_LABEL[color]}
          title={TITLE_COLOR_LABEL[color]}
          data-title-color={color}
          onClick={() => onPick(color)}
          className={`title-dot flex size-8 shrink-0 items-center justify-center rounded-full ${color === value ? 'ring-2 ring-accent ring-offset-2' : ''}`}
        >
          {color === value && <Icon name="check" size={16} className="text-white" />}
        </button>
      ))}
    </div>
  );
}

/** 색 동그라미 한 줄. 고른 색에는 테두리 고리가 생긴다. */
export function MemoColorDots({ value, onPick }: { value: MemoColor; onPick: (color: MemoColor) => void }) {
  return (
    <div role="radiogroup" aria-label="바탕색" className="flex flex-wrap gap-2">
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

/** 블록 머리띠의 꾸미기 단추(바탕·제목 색). 누르면 그 아래에 색 동그라미가 뜬다(격자 칸이 좁아도 잘리지 않게 화면 맨 위 층에 그린다). */
/**
 * actions 를 주면 머리줄의 ⋯ 단추가 된다 — 편집·고정 같은 동작이 위에, 꾸미기 색이 아래에(2026-11-28 UX 토론 D: 머리줄 단추 줄이기).
 */
export function BlockStyleButton({
  block,
  className,
  icon = 'palette',
  label = '꾸미기(바탕·제목 색)',
  actions,
}: {
  block: BlockDto;
  className?: string;
  icon?: string;
  label?: string;
  actions?: (close: () => void) => ReactNode;
}) {
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
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-pressed={open}
        onClick={toggle}
        className={className ?? 'memo-tool flex size-8 shrink-0 items-center justify-center rounded-lg text-ink/60 hover:bg-black/5 hover:text-ink'}
      >
        <Icon name={icon} size={18} />
      </button>
      {open &&
        createPortal(
          <div data-memo-colors="" className="anim-fade fixed z-[35] rounded-xl border bg-card p-3 shadow-lg" style={{ left: at.x, top: at.y, width: POPOVER_WIDTH }}>
            {actions && <div className="-mx-1 -mt-1 mb-2 flex flex-col border-b border-rule pb-2">{actions(() => setAt(null))}</div>}
            <p className="mb-2 text-xs font-medium text-sub">바탕</p>
            <MemoColorDots value={blockBg(block)} onPick={(bg) => void setBlockStyle(block, { bg })} />
            <p className="mt-3 mb-2 text-xs font-medium text-sub">제목 글자색</p>
            <TitleColorDots value={titleColor(block.config.title_color)} onPick={(title_color) => void setBlockStyle(block, { title_color })} />
          </div>,
          document.body,
        )}
    </>
  );
}
