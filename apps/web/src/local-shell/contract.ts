/*
 * 화면(apps/web)이 구글 드라이브 트랙 묶음(apps/local)에서 쓰는 것의 약속.
 * 화면의 타입 검사는 서버 코드(데코레이터)를 읽지 않으려고 apps/local 을 직접 보지 않고 이 약속만 본다.
 * apps/local/src/contract-check.ts 가 실제 코드가 이 약속을 지키는지 타입 검사로 확인한다.
 */
export type Track = 'drive' | 'device';
export type SyncState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error';
export type OpenResult = 'empty' | 'uploaded' | 'downloaded' | 'same' | 'conflict';

export interface LocalHandle {
  track: Track;
  fetch(input: string, init: RequestInit): Promise<Response>;
  identity: { email: string; name: string };
  openResult: OpenResult | null;
  syncState(): SyncState;
  onSyncState(fn: (s: SyncState, detail?: string) => void): () => void;
  googleConnected(): boolean;
  /** AI 화면 블록 틀 문서(srcdoc) — 서버 판과 같은 준비 코드, 샌드박스·문서 안 정책 */
  viewDocument(): string;
  connectDrive(): Promise<OpenResult>;
  saveNow(): Promise<void>;
  keepRemote(): Promise<void>;
  keepLocal(): Promise<void>;
  backups(): Promise<{ id: string; name: string }[]>;
  restore(id: string): Promise<void>;
  exportJson(): Promise<string>;
  importJson(text: string): Promise<void>;
  signOut(): Promise<void>;
}

export interface StartOptions {
  track: Track;
  clientId: string;
  interactive: boolean;
  replaceLocal?: boolean;
}

export interface LocalApi {
  startLocal(opts: StartOptions): Promise<LocalHandle>;
  savedTrack(): Track | null;
  NeedSignInError: new () => Error;
  AccountMismatchError: new (saved: string, signedIn: string) => Error & { saved: string; signedIn: string };
}
