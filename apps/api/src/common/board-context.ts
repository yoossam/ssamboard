import { AsyncLocalStorage } from 'node:async_hooks';
import { boardKindOf, type BoardKind } from '@jarvis/shared';

/*
 * 지금 요청이 보는 보드(업무·수업). 화면이 X-Board 머리글로 보내고(기기마다), main.ts 가 요청마다 담는다.
 * 서비스들은 currentBoard(userId) 만 부르면 되고 보드 id 를 넘겨받지 않는다. 요청 밖(일꾼)은 업무 보드.
 * 드라이브 트랙은 apps/local/src/shim/board-context.ts 가 대신한다(브라우저 탭 하나 = 보드 하나).
 */
const store = new AsyncLocalStorage<BoardKind>();

export const boardKind = (): BoardKind => store.getStore() ?? 'work';
export const runWithBoard = <T>(kind: unknown, fn: () => T): T => store.run(boardKindOf(kind), fn);
