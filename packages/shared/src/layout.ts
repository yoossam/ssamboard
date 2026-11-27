import type { GridPos } from './types';

export type PlaceHint = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const PLACE_HINTS: PlaceHint[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
/** 가로 칸 수. 12칸이던 것을 2026-11-26 에 24칸으로 나눠 크기를 절반 칸 단위로 정할 수 있게 했다(마이그레이션 003). */
export const GRID_COLS = 24;
/** 블록 하나가 가질 수 있는 가장 큰 세로 칸 수. */
export const GRID_MAX_H = 80;

const overlaps = (a: GridPos, b: GridPos) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * 새 블록 자리를 정한다. 힌트가 없으면 위에서부터 처음 비는 칸에 놓고,
 * 힌트가 있으면 그 모서리에 놓는다(겹치는 블록은 격자가 아래로 민다).
 */
export function placeBlock(existing: GridPos[], size: { w: number; h: number }, hint?: PlaceHint | null): GridPos {
  const w = Math.min(Math.max(1, size.w), GRID_COLS);
  const h = Math.max(1, size.h);
  const bottom = existing.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  if (hint) {
    const x = hint.endsWith('right') ? GRID_COLS - w : 0;
    const y = hint.startsWith('top') ? 0 : bottom;
    return { x, y, w, h };
  }
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + w <= GRID_COLS; x++) {
      const candidate = { x, y, w, h };
      if (!existing.some((p) => overlaps(candidate, p))) return candidate;
    }
  }
  return { x: 0, y: bottom, w, h };
}

/** 휴대폰 순서: 따로 저장한 순서가 있으면 그것을, 없으면 데스크톱 배치의 위→아래, 왼→오른 순서를 따른다(MOB-1). */
export function mobileOrder<T extends { layout_lg: GridPos; layout_sm: { order: number } | null }>(blocks: T[]): T[] {
  const custom = blocks.every((b) => b.layout_sm !== null);
  return [...blocks].sort((a, b) =>
    custom ? a.layout_sm!.order - b.layout_sm!.order : a.layout_lg.y - b.layout_lg.y || a.layout_lg.x - b.layout_lg.x,
  );
}
