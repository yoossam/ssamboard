import { boardKindOf, type BoardKind } from '@jarvis/shared';

// apps/api/src/common/board-context.ts 대체품. 브라우저에는 AsyncLocalStorage 가 없다.
// 드라이브 트랙은 탭 하나에서만 돌고(다른 탭은 막음) 그 탭은 한 번에 보드 하나만 보이므로, 마지막 요청의 X-Board 를 그대로 쓴다.
// 오래 걸리거나 다른 보드를 다루는 일(AI 응답·계획 승인)은 이 값에 기대지 않고 보드를 직접 넘긴다
// (ai.service.ts 가 처음에 잡은 kind, commands.apply 의 boardId — 겹친 요청끼리 섞이지 않게, 코덱스·제미나이 검토).
let current: BoardKind = 'work';
export const boardKind = (): BoardKind => current;
export const runWithBoard = <T>(kind: unknown, fn: () => T): T => {
  current = boardKindOf(kind);
  return fn();
};
