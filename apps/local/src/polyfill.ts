// 서버 코드가 쓰는 Node 전역(Buffer)을 브라우저에 채운다. index.ts 의 맨 첫 import 여야 한다.
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer };
g.Buffer ??= Buffer;
