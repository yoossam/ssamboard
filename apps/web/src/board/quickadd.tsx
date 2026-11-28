/*
 * 블록 바로 넣기(2026-11-28 선생님 "블록 추가를 더 쉽게 — AI 말고 자주 쓰는 블록은 바로"):
 * 위쪽 줄의 [+ 블록]을 누르면 작은 창에 블록 종류가 자주 넣은 순으로 나오고, 누르면 그 자리에서 바로 보드 빈 곳에 놓인다.
 * 자주 넣은 순은 이 기기에만 센다(localStorage, 보드마다). 표는 표 고르기, 퀴즈·AI 화면은 AI 창으로 이어진다.
 */
import { useEffect, useRef, useState } from 'react';
import { BLOCK_LABEL, type BlockType, type BoardKind } from '@jarvis/shared';
import { BLOCK_ICON, Icon } from '../components/Icon';
import { api, errorMessage } from '../lib/api';
import { refresh } from '../lib/data';
import { useApp } from '../lib/store';

/** 보드마다 처음 순서(아직 센 것이 없을 때) — 내 메뉴는 보드마다 하나라 뺀다 */
const DEFAULT_ORDER: Record<BoardKind, BlockType[]> = {
  work: ['memo', 'tasks', 'events', 'table', 'links', 'notifications', 'view'],
  class: ['memo', 'links', 'quiz', 'table', 'tasks', 'events', 'view'],
};
const countKey = (kind: BoardKind) => `ssb-quick-add:${kind}`;

function counts(kind: BoardKind): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(countKey(kind)) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function bump(kind: BoardKind, type: BlockType): void {
  try {
    const c = counts(kind);
    localStorage.setItem(countKey(kind), JSON.stringify({ ...c, [type]: (Number(c[type]) || 0) + 1 }));
  } catch {
    /* 저장이 막힌 브라우저는 처음 순서 그대로 */
  }
}
/** 자주 넣은 순(같으면 처음 순서) */
export function quickOrder(kind: BoardKind): BlockType[] {
  const c = counts(kind);
  const base = DEFAULT_ORDER[kind];
  return [...base].sort((a, b) => (Number(c[b]) || 0) - (Number(c[a]) || 0) || base.indexOf(a) - base.indexOf(b));
}

/** 블록 종류 하나를 넣는다 — 블록 추가 창과 [+ 블록]이 함께 쓴다 */
export async function addBlockOfType(type: BlockType): Promise<boolean> {
  const app = useApp.getState();
  bump(app.boardKind, type);
  if (type === 'table') {
    app.open({ kind: 'tables' });
    app.toast('표를 고른 뒤 "보드에 배치"를 누르세요');
    return true;
  }
  if (type === 'quiz' || type === 'view') {
    app.openAi();
    app.toast(type === 'quiz' ? '어떤 퀴즈를 낼지 말해 주세요. 예: 분수의 덧셈 퀴즈 5문제 만들어' : '무엇을 보여 줄지 말해 주세요. 예: 할 일을 마감 날짜별 막대그래프로');
    return true;
  }
  try {
    await api.post('/blocks', { type });
    await refresh('board');
    app.toast(`${BLOCK_LABEL[type]} 블록을 놓았습니다`);
    return true;
  } catch (e) {
    app.toast(errorMessage(e), 'error');
    return false;
  }
}

/** 위쪽 줄 [+ 블록] — 누르면 자주 넣는 블록이 나오고, 하나를 누르면 바로 놓인다 */
export function QuickAddButton({ compact = false }: { compact?: boolean }) {
  const kind = useApp((s) => s.boardKind);
  const open = useApp((s) => s.open);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!show) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setShow(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setShow(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [show]);
  const pick = async (type: BlockType) => {
    setBusy(true);
    const ok = await addBlockOfType(type);
    setBusy(false);
    if (ok) setShow(false);
  };
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label="블록 넣기"
        aria-expanded={show}
        title="자주 쓰는 블록을 바로 넣기"
        onClick={() => setShow((v) => !v)}
        className="flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm font-medium text-ink hover:bg-tint"
      >
        <Icon name="plus" size={18} className="text-accent" />
        {!compact && '블록'}
      </button>
      {show && (
        <div role="menu" aria-label="블록 넣기" data-quick-add className="anim-fade absolute top-full right-0 z-40 mt-1 w-64 rounded-2xl border bg-card p-2 shadow-xl">
          <p className="px-1.5 pb-1.5 text-xs text-sub">누르면 바로 놓여요 · 자주 넣는 순</p>
          <div className={`grid grid-cols-2 gap-1.5 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            {quickOrder(kind).map((type) => (
              <button
                key={type}
                type="button"
                role="menuitem"
                onClick={() => void pick(type)}
                className="flex min-h-11 items-center gap-2 rounded-xl border bg-card px-2.5 text-left text-sm font-medium transition hover:border-accent hover:bg-tint active:scale-[0.98]"
              >
                <Icon name={BLOCK_ICON[type]} size={16} className="shrink-0 text-accent" />
                <span className="min-w-0 truncate">{BLOCK_LABEL[type]}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setShow(false);
              open({ kind: 'add-block' });
            }}
            className="mt-1.5 w-full rounded-xl px-2 py-2 text-left text-xs text-sub hover:bg-ground"
          >
            모든 블록 보기 · 설명 →
          </button>
        </div>
      )}
    </div>
  );
}
