/*
 * 구글 드라이브 트랙 시작점 — 화면(apps/web)이 VITE_EDITION=local 일 때 이것 하나만 부른다.
 *   1) 이 브라우저의 DB(PGlite, IndexedDB)를 연다
 *   2) 구글 드라이브 트랙이면 구글 로그인 → 드라이브와 맞춘다(없으면 올리고, 새것이면 받는다)
 *   3) 서버 판 코드를 그대로 잇은 작은 서버의 fetch 를 돌려준다 → 화면이 setFetcher() 로 끼운다
 * '이 기기에만' 트랙은 구글 없이 이 브라우저에만 저장한다(써 보기용, 나중에 드라이브로 옮길 수 있다).
 */
import './polyfill'; // 반드시 맨 처음(서버 코드가 Buffer 를 쓴다)
import { createLocalApp, ensureLocalUser } from './app';
import { openLocalDb, type LocalDb } from './db';
import { DriveSync, exportData, importData, type OpenResult, type SyncData, type SyncState } from './drive';
import { GoogleAccountMismatch, GoogleSession } from './google';
import { BadRequestException } from './shim/nest-common';
import { setLocalGoogle } from './stub/google';
import { LOCAL_VIEW_SCRIPT, localViewDocument } from '../../api/src/boards/view-frame';

export type Track = 'drive' | 'device';
export type { OpenResult, SyncState };

const TRACK_KEY = 'ssamboard.track';
const DB_NAME = 'ssamboard';
const DEVICE_IDENTITY = { email: 'me@this-device', name: '선생님' };

export function savedTrack(): Track | null {
  try {
    const v = localStorage.getItem(TRACK_KEY);
    return v === 'drive' || v === 'device' ? v : null;
  } catch {
    return null;
  }
}
function saveTrack(t: Track | null): void {
  try {
    if (t) localStorage.setItem(TRACK_KEY, t);
    else localStorage.removeItem(TRACK_KEY);
  } catch {
    /* 무시 */
  }
}

export class NeedSignInError extends Error {
  constructor() {
    super('구글 로그인이 필요합니다.');
  }
}
export class AccountMismatchError extends Error {
  constructor(
    readonly saved: string,
    readonly signedIn: string,
  ) {
    super(`이 브라우저에는 ${saved} 계정의 보드가 있습니다. 지금 로그인한 계정은 ${signedIn} 입니다.`);
  }
}

export interface LocalHandle {
  track: Track;
  fetch(input: string, init: RequestInit): Promise<Response>;
  identity: { email: string; name: string };
  openResult: OpenResult | null;
  syncState(): SyncState;
  onSyncState(fn: (s: SyncState, detail?: string) => void): () => void;
  googleConnected(): boolean;
  /** AI 화면 블록 틀 문서(srcdoc) */
  viewDocument(): string;
  /** 구글 다시 연결(토큰 만료·처음 연결). 누름 안에서 부른다. 드라이브와 다시 맞춘다. */
  connectDrive(): Promise<OpenResult>;
  saveNow(): Promise<void>;
  keepRemote(): Promise<void>;
  keepLocal(): Promise<void>;
  backups(): Promise<{ id: string; name: string }[]>;
  restore(id: string): Promise<void>;
  exportJson(): Promise<string>;
  importJson(text: string): Promise<void>;
  /** 로그아웃: 드라이브에 저장하고 이 브라우저의 자료를 지운 뒤 처음 화면으로(공용 컴퓨터 대비). */
  signOut(): Promise<void>;
}

async function wipe(db: LocalDb | null): Promise<void> {
  await db?.close().catch(() => undefined);
  for (const name of [`/pglite/${DB_NAME}`, DB_NAME]) {
    // 다른 탭이 열려 있어 막히면 지워진 척 넘어가지 않는다 — 공용 컴퓨터에 자료가 남는다(제미나이 검토)
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      let timer: ReturnType<typeof setTimeout> | null = null;
      req.onsuccess = req.onerror = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      req.onblocked = () => {
        timer ??= setTimeout(() => reject(new Error('다른 탭에 쌤보드가 열려 있어 이 브라우저의 자료를 지우지 못했습니다. 다른 쌤보드 탭을 모두 닫으면 지워집니다.')), 5000);
      };
    });
  }
}

export interface StartOptions {
  track: Track;
  /** 구글 OAuth 클라이언트 ID(구글 드라이브 트랙) */
  clientId: string;
  /** 누름 안에서 불렸으면 참 — 구글 창을 띄울 수 있다 */
  interactive: boolean;
  /** 계정이 달라 이 브라우저 자료를 지우고 시작할 때 */
  replaceLocal?: boolean;
}

/** 이 보드의 계정(이메일). '이 기기에만'에서 옮겨 온 보드는 아직 계정이 없다(null). */
const boardEmail = (who: { email: string } | null): string | null => (who && who.email !== DEVICE_IDENTITY.email ? who.email : null);

/** 새로 고치기 전에 DB 를 닫는다 — 닫아야 IndexedDB 에 끝까지 써 넣는다(바로 새로 고치면 방금 바꾼 것이 사라질 수 있다). */
async function reloadAfter(db: LocalDb | null): Promise<void> {
  await db?.close().catch(() => undefined);
  location.reload();
}

export async function startLocal(opts: StartOptions): Promise<LocalHandle> {
  if (opts.replaceLocal) await wipe(null);
  const db = await openLocalDb(`idb://${DB_NAME}`);
  const existing = await db.one<{ email: string; name: string }>('select email, name from users order by created_at limit 1');
  const listeners = new Set<(s: SyncState, d?: string) => void>();
  let state: SyncState = 'idle';
  const emit = (s: SyncState, d?: string) => {
    state = s;
    listeners.forEach((f) => f(s, d));
  };

  let google: GoogleSession | null = null;
  let sync: DriveSync | null = null;
  let identity = existing ?? DEVICE_IDENTITY;
  let openResult: OpenResult | null = null;

  if (opts.track === 'drive') {
    if (!opts.clientId) throw new Error('이 주소에는 구글 연결 설정(VITE_GOOGLE_CLIENT_ID)이 없습니다.');
    google = new GoogleSession(opts.clientId);
    const expected = boardEmail(existing);
    // 이 탭에 남은 토큰은 로그인할 때 확인한 계정과 함께 저장돼 있다 — 이 보드의 계정과 다르면 쓰지 않는다(코덱스 재확인).
    if (google.connected && expected && google.email !== expected.toLowerCase()) google.forget();
    if (!google.connected) {
      if (!opts.interactive) {
        if (!existing) {
          await db.close();
          throw new NeedSignInError();
        }
      } else {
        try {
          // 계정을 확인한 뒤에만 토큰을 받아들인다(다르면 새 토큰은 버려진다)
          await google.signIn(expected ?? undefined, [], expected);
        } catch (e) {
          await db.close();
          throw e instanceof GoogleAccountMismatch ? new AccountMismatchError(e.expected, e.got) : e;
        }
      }
    }
    if (google.connected) identity = expected ? existing! : google.profile();
    const g = google;
    // 드라이브와 맞추기 전에 이 브라우저의 사용자 줄을 만든다 — 받은 자료를 이 사용자에게 넣는다(새 기기에서 받기가 되게).
    await ensureLocalUser(db, identity);
    sync = new DriveSync(db, { token: () => g.accessToken(), onState: emit });
    if (google.connected) openResult = await sync.open().catch(() => null);
  }

  // 시트·설문 연결(서버 판 connectors 코드)이 쓰는 구글 토큰 — 구글 드라이브 트랙에서만
  const g2 = google;
  setLocalGoogle(
    g2
      ? {
          token: async (scope) => {
            if (!g2.connected) throw new BadRequestException('구글 연결이 끝났습니다. 위쪽의 "구글 다시 연결"을 누른 뒤 다시 하세요.');
            if (!g2.hasScope(scope)) throw new BadRequestException('시트·설문 권한이 없습니다. 설정 → 연결에서 구글 시트를 다시 연결하세요.');
            return g2.accessToken();
          },
          connect: async (scopes) => {
            try {
              await g2.signIn(boardEmail(identity) ?? undefined, scopes, boardEmail(identity));
            } catch (e) {
              throw new BadRequestException(e instanceof GoogleAccountMismatch ? `이 보드는 ${identity.email} 계정의 것입니다. 그 계정으로 연결하세요.` : (e as Error).message);
            }
          },
        }
      : null,
  );

  const router = await createLocalApp(db, identity, {
    onChange: () => sync?.markDirty(),
    // 로그아웃 요청 자신이 끝나기를 기다리며 멈추지 않게, 요청이 끝난 뒤에 시작한다(코덱스 검토)
    onLogout: async () => {
      setTimeout(() => void handle.signOut().catch((e: Error) => alert(e.message)), 0);
    },
  });
  // 처음 만든 보드(기본 블록)도 드라이브에 올린다.
  // 드라이브에 처음 올린 경우(또는 드라이브를 못 본 새 보드)는 방금 만든 기본 블록까지 다시 올린다. 받아 온 경우는 올릴 것이 없다.
  if (sync && google?.connected && (openResult === 'uploaded' || openResult === 'empty' || (openResult === null && !existing))) sync.markDirty();
  saveTrack(opts.track);

  const handle: LocalHandle = {
    track: opts.track,
    fetch: (input, init) => router.fetch(input, init),
    identity,
    openResult,
    syncState: () => state,
    onSyncState: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    googleConnected: () => Boolean(google?.connected),
    viewDocument: () => localViewDocument(new URL(LOCAL_VIEW_SCRIPT, document.baseURI).href),
    async connectDrive() {
      if (!google) {
        // '이 기기에만' 에서 드라이브로 옮기기 — 다음 시작부터 드라이브 트랙. 이 기기 자료를 '안 올린 변경'으로 표시해 두면
        // 그 계정 드라이브에 이미 보드가 있을 때 말없이 덮지 않고 어느 쪽을 남길지 묻는다.
        await db.query("insert into app_meta(key, value) values ('drive_dirty', '1') on conflict (key) do update set value = '1'");
        saveTrack('drive');
        await reloadAfter(db);
        return 'same';
      }
      // 처음 시작할 때처럼 계정을 대조한다 — 다른 계정의 토큰은 확인 전에 쓰이지 않고 버려진다(검토: 코덱스·제미나이).
      try {
        await google.signIn(boardEmail(identity) ?? undefined, [], boardEmail(identity));
      } catch (e) {
        throw e instanceof GoogleAccountMismatch ? new Error(`이 보드는 ${identity.email} 계정의 것입니다. 그 계정으로 다시 연결하세요(다른 계정으로 쓰려면 로그아웃 뒤 시작).`) : e;
      }
      return sync!.open();
    },
    saveNow: async () => {
      await sync?.flush();
    },
    // 자료를 통째로 바꾼 뒤에는 성공·실패와 상관없이 새로 고친다 — 화면과 작은 서버가 옛 사용자·세션을 붙잡고 있지 않게(검토: 제미나이).
    keepRemote: async () => {
      try {
        await sync?.keepRemote();
      } finally {
        await reloadAfter(db);
      }
    },
    keepLocal: async () => {
      await sync?.keepLocal();
    },
    backups: async () => (sync ? sync.backups() : []),
    restore: async (id) => {
      try {
        await sync?.restore(id);
      } finally {
        await reloadAfter(db);
      }
    },
    exportJson: async () => JSON.stringify(await exportData(db), null, 1),
    importJson: async (text) => {
      let data: SyncData;
      try {
        data = JSON.parse(text) as SyncData;
      } catch {
        throw new Error('JSON 파일이 아닙니다.');
      }
      await importData(db, data); // 파일이 잘못됐으면 여기서 멈추고 지금 보드는 그대로다
      try {
        sync?.markDirty();
        await sync?.flush(true);
      } catch {
        /* 다음에 다시 올린다(바뀜 표시가 남아 있다) */
      } finally {
        await reloadAfter(db);
      }
    },
    async signOut() {
      if (opts.track === 'drive') {
        // 올리지 못한 변경이 있으면 지우지 않는다 — 공용 컴퓨터라도 자료를 잃는 것보다 낫다.
        // 진행 중인 저장·AI 응답 기록까지 끝난 뒤에 본다(검토: 저장 중 로그아웃).
        await router.idle(); // 진행 중인 AI 응답 등 쓰기가 끝나 DB 에 기록될 때까지(코덱스 재확인)
        await sync!.settle();
        if (await sync!.hasUnsaved()) {
          if (!google?.connected) throw new Error('드라이브에 아직 저장하지 않은 변경이 있습니다. "구글 다시 연결" 뒤 로그아웃하세요.');
          await sync!.flush().catch(() => undefined);
          await sync!.settle();
          if (await sync!.hasUnsaved()) throw new Error('드라이브에 저장하지 못해 로그아웃을 멈췄습니다. 설정 → 드라이브에서 확인하세요.');
        }
        await google?.signOut();
        await wipe(db);
      } else await db.close();
      saveTrack(null);
      location.reload();
    },
  };
  return handle;
}
