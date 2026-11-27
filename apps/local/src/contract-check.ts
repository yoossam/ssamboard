// 실제 코드(index.ts)가 화면과의 약속(apps/web/src/local-shell/contract.ts)을 지키는지 타입 검사로만 확인한다. 실행되지 않는다.
import type { LocalApi } from '../../web/src/local-shell/contract';
import * as real from './index';

export const _contract: LocalApi = real;
