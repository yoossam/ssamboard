/*
 * 처리 결과 → 보드의 어느 블록이 바뀌었나(2026-11-28 UX 토론 A·J).
 * 블록은 그대로, 표는 그 표를 보여 주는 블록, 할 일·일정은 그 종류의 블록으로 찾는다.
 */
import type { BlockDto, BoardDto, CommandDto } from '@jarvis/shared';
import { keys, queryClient, boardKey } from './data';
import { useApp } from './store';

export function blocksFor(cmd: Pick<CommandDto, 'touched'>, blocks: BlockDto[]): string[] {
  const ids = new Set<string>();
  for (const t of cmd.touched ?? []) {
    for (const b of blocks) {
      if (t.entity === 'blocks' && b.id === t.id) ids.add(b.id);
      else if (t.entity === 'data_tables' && b.source_table_id === t.id) ids.add(b.id);
      else if (t.entity === 'tasks' && b.type === 'tasks') ids.add(b.id);
      else if (t.entity === 'events' && b.type === 'events') ids.add(b.id);
      else if (t.entity === 'notifications' && b.type === 'notifications') ids.add(b.id);
    }
  }
  return [...ids];
}

/** 바뀐 블록을 강조하고 첫 블록까지 스크롤한다. 찾은 블록 수를 돌려준다. close 면 AI 창·다른 창을 닫는다. */
export function showOnBoard(cmd: Pick<CommandDto, 'touched'>, close = true): number {
  const blocks = queryClient.getQueryData<BoardDto>(boardKey())?.blocks ?? [];
  const ids = blocksFor(cmd, blocks);
  const app = useApp.getState();
  if (close) {
    // 옆 패널로 연 AI 창은 둔다 — 보드가 함께 보인다
    if (app.aiOpen && app.aiLayout !== 'panel') app.closeAi();
    app.closeAll();
  }
  app.flash(ids);
  if (ids.length > 0) setTimeout(() => document.querySelector(`[data-block="${ids[0]}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  return ids.length;
}
