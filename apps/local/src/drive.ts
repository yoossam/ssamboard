/*
 * 구글 드라이브 맞춤(구글 드라이브 트랙).
 * - 자료는 브라우저 안 PGlite 에 바로 저장하고, 내 자료만 JSON 하나(ssamboard-data.json)로 드라이브 '앱 폴더'에 올린다.
 *   앱 폴더(appDataFolder)는 이 앱만 읽고 쓰는 숨은 폴더다 — 드라이브 화면에 보이지 않고 운영자도 볼 수 없다.
 * - 올리기 전에 드라이브 파일의 판 번호(version)를 보고, 다른 기기가 먼저 올렸으면 덮어쓰지 않고 묻는다.
 * - 하루 한 번 backup-YYYY-MM-DD.json 을 남기고 14개까지 둔다.
 * 열쇠(api_keys)·세션·감사 기록·로컬 상태(app_meta)는 올리지 않는다.
 */
import { exportData as exportShared, importData as importShared, type SyncData } from '../../api/src/data/transfer';
import type { LocalDb, Queryable } from './db';

// 옮기는 표·파일 모양·내보내기·가져오기는 서버 트랙과 같은 코드(apps/api/src/data/transfer.ts)를 쓴다.
export { SYNC_TABLES, LOCAL_ONLY_TABLES, type SyncData } from '../../api/src/data/transfer';

export const DATA_FILE = 'ssamboard-data.json';
export const BACKUP_KEEP = 14;
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

/** 이 브라우저의 사용자(한 명) */
async function owner(q: Queryable): Promise<string> {
  const id = (await q.one<{ id: string }>('select id from users order by created_at limit 1'))?.id;
  if (!id) throw new Error('이 브라우저에 보드가 아직 없습니다.');
  return id;
}

/** 내 자료를 JSON 으로(열쇠·세션은 빠진다). */
export async function exportData(db: Queryable): Promise<SyncData> {
  return exportShared(db, await owner(db));
}

/** 받은 자료로 이 브라우저의 내 자료를 통째로 바꾼다(한 트랜잭션, 잘못된 파일이면 그대로). 사용자 줄·열쇠는 그대로 둔다. */
export async function importData(db: LocalDb, data: unknown): Promise<void> {
  const id = await owner(db);
  await db.tx((q) => importShared(q, data, id));
}

/** 마지막으로 맞춘 판·바뀐 표시 — 이 브라우저에만(app_meta). */
async function meta(q: Queryable, key: string): Promise<string | null> {
  return (await q.one<{ value: string }>('select value from app_meta where key = $1', [key]))?.value ?? null;
}
async function setMeta(q: Queryable, key: string, value: string | null): Promise<void> {
  if (value === null) await q.query('delete from app_meta where key = $1', [key]);
  else await q.query('insert into app_meta(key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()', [key, value]);
}

interface DriveFile {
  id: string;
  name: string;
  version: string;
  modifiedTime: string;
}

export type SyncState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error';

export interface DriveSyncOptions {
  /** 구글 접근 토큰(drive.appdata). 만료되면 새로 받아 준다. */
  token: () => Promise<string>;
  fetch?: typeof fetch;
  /** 바뀐 뒤 몇 밀리초 조용하면 올릴지 */
  quietMs?: number;
  onState?: (s: SyncState, detail?: string) => void;
  now?: () => Date;
}

export type OpenResult = 'empty' | 'uploaded' | 'downloaded' | 'same' | 'conflict';

export class DriveSync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private readonly f: typeof fetch;
  state: SyncState = 'idle';

  constructor(
    private readonly db: LocalDb,
    private readonly opts: DriveSyncOptions,
  ) {
    this.f = opts.fetch ?? ((...a) => fetch(...a));
  }

  private set(s: SyncState, detail?: string) {
    this.state = s;
    this.opts.onState?.(s, detail);
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.opts.token();
    const res = await this.f(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`구글 드라이브 응답 ${res.status}`);
    return res;
  }

  private async find(name: string): Promise<DriveFile | null> {
    const q = encodeURIComponent(`name = '${name}' and trashed = false`);
    const res = await this.call(`${API}?spaces=appDataFolder&q=${q}&fields=files(id,name,version,modifiedTime)&orderBy=modifiedTime desc`);
    return ((await res.json()) as { files: DriveFile[] }).files[0] ?? null;
  }

  private async download(id: string): Promise<SyncData> {
    return (await (await this.call(`${API}/${id}?alt=media`)).json()) as SyncData;
  }

  private async upload(existing: DriveFile | null, data: SyncData): Promise<DriveFile> {
    const body = JSON.stringify(data);
    if (existing) {
      const res = await this.call(`${UPLOAD}/${existing.id}?uploadType=media&fields=id,name,version,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      return (await res.json()) as DriveFile;
    }
    const boundary = 'ssamboard' + Math.random().toString(36).slice(2);
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: DATA_FILE, parents: ['appDataFolder'] })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const res = await this.call(`${UPLOAD}?uploadType=multipart&fields=id,name,version,modifiedTime`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
    return (await res.json()) as DriveFile;
  }

  /**
   * 앱을 열 때 한 번: 드라이브와 이 브라우저를 맞춘다.
   * - 드라이브에 없음 → 이 브라우저 것을 올림 / 드라이브가 새것이고 여기 안 올린 변경이 없음 → 받아서 바꿈
   * - 둘 다 바뀜 → 'conflict'(화면이 고르게 한다: keepRemote / keepLocal)
   */
  async open(): Promise<OpenResult> {
    try {
      const remote = await this.find(DATA_FILE);
      const synced = await meta(this.db, 'drive_version');
      const dirty = (await meta(this.db, 'drive_dirty')) !== null;
      if (!remote) {
        // 처음 여는 브라우저라 아직 보드(사용자 줄)가 없으면 만든 뒤에 올린다(index.ts 가 markDirty).
        if (!(await this.db.one('select 1 as hit from users limit 1'))) return 'empty';
        await this.flush(true);
        return 'uploaded';
      }
      if (remote.version === synced) {
        if (dirty) await this.flush();
        return 'same';
      }
      // 여기에 안 올린 변경이 있는데 드라이브도 다르다 → 묻는다('이 기기에만'에서 옮겨 온 첫 연결도 여기에 걸려 드라이브의 다른 보드를 덮지 않는다).
      if (dirty) {
        this.set('conflict', '다른 기기에서 바뀐 자료가 있습니다.');
        return 'conflict';
      }
      await this.keepRemote(remote);
      return 'downloaded';
    } catch (e) {
      this.set('offline', String((e as Error).message));
      throw e;
    }
  }

  /** 드라이브 것으로 바꾼다(이 브라우저의 올리지 않은 변경은 버림). 화면은 이 뒤에 새로 고친다. */
  async keepRemote(remote?: DriveFile | null): Promise<void> {
    const file = remote ?? (await this.find(DATA_FILE));
    if (!file) return;
    await importData(this.db, await this.download(file.id));
    await setMeta(this.db, 'drive_file', file.id);
    await setMeta(this.db, 'drive_version', file.version);
    await setMeta(this.db, 'drive_dirty', null);
    this.set('saved');
  }

  /** 이 브라우저 것으로 드라이브를 덮어쓴다(다른 기기의 변경은 버림 — 그 전 것은 하루 백업에 남아 있다). */
  async keepLocal(): Promise<void> {
    await this.flush(true);
  }

  /**
   * 자료가 바뀌었다고 알린다. 조용해지면 올린다.
   * 표시는 바뀔 때마다 새 번호 — 올리는 동안 또 바뀌면 올린 뒤에도 표시가 남아 다음에 다시 올린다(검토: 저장 중 로그아웃·긴 AI 응답).
   */
  markDirty(): void {
    void setMeta(this.db, 'drive_dirty', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    if (this.state === 'conflict') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush().catch(() => undefined), this.opts.quietMs ?? 10_000);
  }

  /** 지금 올린다. force 가 아니면 드라이브 판이 마지막으로 맞춘 판과 같을 때만. */
  async flush(force = false): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) await this.running;
    this.running = (async () => {
      this.set('saving');
      try {
        const remote = await this.find(DATA_FILE);
        const synced = await meta(this.db, 'drive_version');
        if (!force && remote && remote.version !== synced) {
          this.set('conflict', '다른 기기에서 바뀐 자료가 있습니다.');
          return;
        }
        // 내보내기 직전의 표시 번호를 기억했다가, 올린 뒤에도 같으면(그 사이 바뀐 것이 없으면) 지운다.
        const mark = await meta(this.db, 'drive_dirty');
        const saved = await this.upload(remote, await exportData(this.db));
        await setMeta(this.db, 'drive_file', saved.id);
        await setMeta(this.db, 'drive_version', saved.version);
        // 번호가 그대로일 때만 지운다 — 비교와 지우기를 한 문장으로(그 사이 새 변경이 끼어도 지우지 않게, 코덱스 재확인).
        if (mark !== null) await this.db.query("delete from app_meta where key = 'drive_dirty' and value = $1", [mark]);
        await this.backupDaily(saved.id);
        this.set('saved');
      } catch (e) {
        if ((await meta(this.db, 'drive_dirty')) === null) await setMeta(this.db, 'drive_dirty', 'retry');
        this.set(navigator?.onLine === false ? 'offline' : 'error', String((e as Error).message));
        throw e;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** 진행 중인 저장이 끝날 때까지 기다린다(로그아웃 전에). */
  async settle(): Promise<void> {
    if (this.timer) await this.flush().catch(() => undefined);
    while (this.running) await this.running.catch(() => undefined);
  }

  /** 아직 드라이브에 올리지 않은 변경이 있는지 */
  async hasUnsaved(): Promise<boolean> {
    return (await meta(this.db, 'drive_dirty')) !== null;
  }

  /** 하루 한 번 백업 파일을 남기고 오래된 것은 지운다. */
  async backupDaily(fileId: string): Promise<void> {
    const today = (this.opts.now?.() ?? new Date()).toISOString().slice(0, 10);
    if ((await meta(this.db, 'drive_backup_day')) === today) return;
    const name = `backup-${today}.json`;
    if (!(await this.find(name))) {
      await this.call(`${API}/${fileId}/copy?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parents: ['appDataFolder'] }) });
    }
    const q = encodeURIComponent("name contains 'backup-' and trashed = false");
    const list = ((await (await this.call(`${API}?spaces=appDataFolder&q=${q}&fields=files(id,name)&pageSize=100`)).json()) as { files: { id: string; name: string }[] }).files;
    const old = list.sort((a, b) => b.name.localeCompare(a.name)).slice(BACKUP_KEEP);
    for (const f of old) await this.call(`${API}/${f.id}`, { method: 'DELETE' });
    await setMeta(this.db, 'drive_backup_day', today);
  }

  /** 백업 목록(최근 것 먼저) — 설정에서 되살리기용. */
  async backups(): Promise<{ id: string; name: string }[]> {
    const q = encodeURIComponent("name contains 'backup-' and trashed = false");
    const list = ((await (await this.call(`${API}?spaces=appDataFolder&q=${q}&fields=files(id,name)&pageSize=100`)).json()) as { files: { id: string; name: string }[] }).files;
    return list.sort((a, b) => b.name.localeCompare(a.name));
  }

  /** 백업 하나로 되살린다 — 이 브라우저와 드라이브 둘 다 그 날 자료로. */
  async restore(backupId: string): Promise<void> {
    await importData(this.db, await this.download(backupId));
    await this.flush(true);
  }
}
