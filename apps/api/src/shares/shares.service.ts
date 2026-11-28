import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SHARE_DAYS, SHAREABLE_BLOCKS, type BlockDto, type ShareDto, type ShareOptions } from '@jarvis/shared';
import type { UserRow } from '../auth/auth.types';
import { bad, notFound } from '../common/http';
import { config } from '../config';
import { ConnectorsService } from '../connectors/connectors.service';
import { Db } from '../db/db.service';
import { ItemsService } from '../items/items.service';
import { TablesService } from '../tables/tables.service';
import { buildShareView, renderGonePage, renderSharePage } from './share-page';
import { maskPii } from '@jarvis/shared';

const clean = (v: string): string => maskPii(v);

/*
 * 공유 링크(2026-11-28 선생님 "공유 링크 기능 넣어보자").
 *  - 서버 트랙: /s/<열쇠> 를 쌤보드가 직접 내보낸다(로그인 없이, 볼 때마다 지금 자료). 열쇠는 48자 무작위 — 링크를 아는 사람만 본다.
 *  - 구글 드라이브 트랙: 서버가 없으니 같은 HTML 을 내 구글 드라이브에 구글 문서로 올리고 '링크가 있는 사람 보기'로 연다(만든 때 자료).
 *  끄면(revoke) 서버 트랙은 바로 볼 수 없고, 드라이브 트랙은 '링크가 있는 사람' 권한을 지운 뒤(확인되어야 꺼짐) 문서를 휴지통으로.
 *  (휴지통만으로는 받은 사람이 계속 본다 — 코덱스 검토. 구글 공개 링크에는 기간을 둘 수 없어 드라이브 트랙은 기간 없음.)
 *  표는 만들 때 보이기로 한 칸만 저장해 두고(options.show_columns) 뒤에 더한 칸은 보이지 않는다.
 */

interface ShareRow {
  id: string;
  user_id: string;
  block_id: string;
  token: string;
  title: string;
  options: ShareOptions;
  external_url: string | null;
  external_id: string | null;
  external_perm: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

function dto(r: ShareRow): ShareDto {
  return {
    id: r.id,
    block_id: r.block_id,
    title: r.title,
    url: r.external_url ?? `${config.publicUrl}/s/${r.token}`,
    mode: r.external_url ? 'drive' : 'server',
    options: r.options ?? {},
    expires_at: r.expires_at,
    revoked_at: r.revoked_at,
    view_count: r.view_count,
    last_viewed_at: r.last_viewed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function checkOptions(raw: unknown): ShareOptions {
  const o = (raw ?? {}) as ShareOptions;
  const hide = Array.isArray(o.hide_columns) ? o.hide_columns.filter((x): x is string => typeof x === 'string' && x.length <= 100).slice(0, 100) : [];
  return hide.length > 0 ? { hide_columns: hide } : {};
}

@Injectable()
export class SharesService {
  constructor(
    private readonly db: Db,
    private readonly items: ItemsService,
    private readonly tables: TablesService,
    private readonly connectors: ConnectorsService,
  ) {}

  private async block(userId: string, blockId: string): Promise<BlockDto | null> {
    return this.db.one<BlockDto>('select * from blocks where id = $1 and user_id = $2 and deleted_at is null', [blockId, userId]);
  }

  async list(userId: string, blockId?: string): Promise<ShareDto[]> {
    const rows = await this.db.query<ShareRow>(
      `select * from shares where user_id = $1 and ($2::uuid is null or block_id = $2::uuid) order by revoked_at nulls first, created_at desc limit 100`,
      [userId, blockId ?? null],
    );
    return rows.map(dto);
  }

  /** 만들기 전에 받는 사람이 볼 페이지를 그대로(저장하지 않음) */
  async preview(user: UserRow, body: any): Promise<{ html: string }> {
    const { view } = await this.prepare(user, body);
    return { html: renderSharePage(view, user.timezone, '미리 보기') };
  }

  private async prepare(user: UserRow, body: any) {
    const blockId = typeof body?.block_id === 'string' ? body.block_id : bad('공유할 블록을 고르세요.');
    const block = (await this.block(user.id, blockId)) ?? notFound('블록');
    if (!SHAREABLE_BLOCKS.includes(block!.type)) bad('이 블록은 공유할 수 없습니다(할 일·일정·표·메모·AI 결과만 됩니다).');
    const days = config.shareMode === 'drive' ? 0 : Number(body?.days ?? 30);
    if (!(SHARE_DAYS as readonly number[]).includes(days)) bad(`기간은 ${SHARE_DAYS.filter(Boolean).join('·')}일 또는 기간 없음(0) 중 하나입니다.`);
    const asked = checkOptions(body?.options);
    const title = clean(typeof body?.title === 'string' ? body.title.trim() : '').slice(0, 120) || clean(block!.title) || '쌤보드';
    // 한 번 만들어 본다 — 못 만드는 블록(원본 표 없음·칸 모두 숨김)이면 링크를 만들기 전에 알린다. 보인 칸을 저장해 둔다.
    const view = await buildShareView({ items: this.items, tables: this.tables }, user.id, user.timezone, { ...block!, title }, asked);
    const options: ShareOptions = view.shown ? { show_columns: view.shown } : {};
    return { block: block!, days, title, view, options };
  }

  async create(user: UserRow, body: any): Promise<ShareDto> {
    const { block, days, title, view, options } = await this.prepare(user, body);
    const token = randomBytes(24).toString('hex');
    const insert = (q: Pick<Db, 'one'>, externalId: string | null) =>
      q.one<ShareRow>(
        `insert into shares(user_id, block_id, token, title, options, external_id, expires_at)
         values ($1, $2, $3, $4, $5::jsonb, $6, case when $7::int > 0 then now() + make_interval(days => $7::int) else null end) returning *`,
        [user.id, block.id, token, title, JSON.stringify(options), externalId, days],
      );
    if (config.shareMode !== 'drive') return dto((await insert(this.db, null))!);

    // 구글 문서: ① 비공개로 만들기 → ② 기록 → ③ 공개 권한 → ④ 주소·권한 기록. 중간에 실패하면 문서를 지우고 기록도 지운다(반쪽 공개 문서가 남지 않게 — 코덱스 검토).
    const token2 = await this.connectors.driveToken(user.id);
    const doc = await this.uploadDoc(token2, null, title, renderSharePage(view, user.timezone, '만든 때의 내용'));
    let row: ShareRow | null = null;
    try {
      row = await insert(this.db, doc.id);
      const perm = await this.drive(token2, `${DRIVE_API}/${encodeURIComponent(doc.id)}/permissions?fields=id`, { method: 'POST', body: JSON.stringify({ role: 'reader', type: 'anyone' }) }, '링크를 열');
      const permId = String(((await perm.json()) as { id?: string }).id ?? 'anyoneWithLink');
      // 그 사이 끄기를 눌렀으면(revoked_at) 공개로 바꾸지 않고 아래에서 치운다 — 확인과 기록을 한 문장으로(코덱스 재확인)
      const done = await this.db.one<ShareRow>('update shares set external_url = $2, external_perm = $3, updated_at = now() where id = $1 and revoked_at is null returning *', [row!.id, doc.url, permId]);
      if (!done) bad('만드는 사이 링크를 껐습니다. 공개하지 않았습니다.');
      return dto(done);
    } catch (e) {
      const gone = await fetch(`${DRIVE_API}/${encodeURIComponent(doc.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token2}` } }).then((r) => r.ok || r.status === 404, () => false);
      // 문서를 지웠을 때만 기록도 지운다. 못 지웠으면 기록을 남겨(목록에 '만들다 만 링크') 끄기로 다시 치울 수 있게(코덱스 재확인).
      if (row && gone) await this.db.query('delete from shares where id = $1', [row.id]);
      if (!gone) bad(`링크를 만들지 못했고, 만들다 만 구글 문서("쌤보드 공유 · ${title}")를 지우지 못했습니다. 목록에서 끄기를 누르거나 드라이브에서 직접 지워 주세요.`);
      throw e;
    }
  }

  /** 구글 문서로 만든 링크를 지금 내용으로 다시 올린다(서버 트랙은 늘 지금 내용이라 할 일 없음). */
  async refresh(user: UserRow, id: string): Promise<ShareDto> {
    const row = (await this.db.one<ShareRow>('select * from shares where id = $1 and user_id = $2', [id, user.id])) ?? notFound('공유 링크');
    if (row!.revoked_at) bad('꺼진 링크입니다.');
    if (row!.expires_at && new Date(row!.expires_at).getTime() < Date.now()) bad('기간이 지난 링크입니다.');
    if (row!.external_id) {
      if (!row!.external_url) bad('만들다 만 링크입니다. 끄고 새로 만들어 주세요.');
      const block = (await this.block(user.id, row!.block_id)) ?? bad('공유한 블록이 지워졌습니다.');
      const view = await buildShareView({ items: this.items, tables: this.tables }, user.id, user.timezone, { ...block!, title: row!.title }, row!.options ?? {});
      await this.uploadDoc(await this.connectors.driveToken(user.id), row!.external_id, row!.title, renderSharePage(view, user.timezone, '만든 때의 내용'));
    }
    const updated = await this.db.one<ShareRow>('update shares set updated_at = now() where id = $1 returning *', [id]);
    return dto(updated!);
  }

  /**
   * 링크 끄기. 구글 문서는 '링크가 있는 사람' 권한을 지워야 꺼진다 — 지워진 것이 확인되어야 꺼짐으로 적고(실패하면 오류, 다시 누를 수 있음),
   * 그 뒤 문서는 휴지통으로(이건 못 해도 이미 비공개라 괜찮다).
   */
  async revoke(user: UserRow, id: string): Promise<{ ok: true; warning?: string }> {
    const row = (await this.db.one<ShareRow>('select * from shares where id = $1 and user_id = $2', [id, user.id])) ?? notFound('공유 링크');
    let warning: string | undefined;
    // 만드는 중인 링크(공개 주소가 아직 없음)는 2분 동안 끄지 않는다 — 만들기와 끄기가 엇갈려 '꺼짐인데 공개'가 되지 않게(코덱스 재확인).
    // 2분이 지나도 주소가 없으면 만들다 멈춘 것이라 끄기로 치운다.
    if (row!.external_id && !row!.external_url && !row!.revoked_at && Date.now() - new Date(row!.created_at).getTime() < 120_000) bad('링크를 만드는 중입니다. 잠시 뒤 다시 눌러 주세요.');
    if (row!.external_id && !row!.revoked_at) {
      const token = await this.connectors.driveToken(user.id);
      const file = encodeURIComponent(row!.external_id);
      const perm = encodeURIComponent(row!.external_perm ?? 'anyoneWithLink');
      const res = await fetch(`${DRIVE_API}/${file}/permissions/${perm}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      // 404 = 권한(또는 문서)이 이미 없음 → 꺼진 것
      if (!res || (!res.ok && res.status !== 404)) bad(`구글 문서의 공개를 끄지 못했습니다(${res?.status ?? '연결 실패'}). 잠시 뒤 다시 누르거나 드라이브에서 공유를 꺼 주세요.`);
      const trashed = await fetch(`${DRIVE_API}/${file}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }).then((r) => r.ok || r.status === 404, () => false);
      if (!trashed) warning = '공개는 껐습니다. 구글 문서는 휴지통으로 옮기지 못해 드라이브에 남아 있습니다(나만 볼 수 있음).';
    }
    await this.db.query('update shares set revoked_at = coalesce(revoked_at, now()), updated_at = now() where id = $1', [id]);
    return warning ? { ok: true, warning } : { ok: true };
  }

  /** 로그인 없이 보는 페이지(서버 트랙 /s/<열쇠>). 없거나 꺼졌거나 지났으면 null. */
  async publicPage(token: string): Promise<string | null> {
    if (!/^[0-9a-f]{48}$/.test(token)) return null;
    const row = await this.db.one<ShareRow & { timezone: string }>(
      `select s.*, u.timezone from shares s join users u on u.id = s.user_id
        where s.token = $1 and s.revoked_at is null and s.external_url is null and (s.expires_at is null or s.expires_at > now())`,
      [token],
    );
    if (!row) return null;
    const block = await this.block(row.user_id, row.block_id);
    if (!block) return null;
    try {
      const view = await buildShareView({ items: this.items, tables: this.tables }, row.user_id, row.timezone, { ...block, title: row.title }, row.options ?? {});
      await this.db.query('update shares set view_count = view_count + 1, last_viewed_at = now() where id = $1', [row.id]);
      return renderSharePage(view, row.timezone);
    } catch {
      return null;
    }
  }

  gonePage(): string {
    return renderGonePage();
  }

  private async drive(token: string, url: string, init: RequestInit, what: string): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body && typeof init.body === 'string' && init.body.startsWith('{') ? { 'Content-Type': 'application/json' } : {}), ...(init.headers as Record<string, string>) } });
    if (res.ok) return res;
    const msg = await res
      .json()
      .then((j: any) => String(j?.error?.message ?? ''))
      .catch(() => '');
    if (res.status === 403 && /share|domain|공유|publish/i.test(msg)) bad('학교·기관 계정이 바깥 공유를 막아 두어 링크를 열 수 없습니다. 개인 구글 계정으로 연결하거나 관리자에게 문의하세요.');
    return bad(`구글 드라이브에 ${what}하지 못했습니다(${res.status}).`);
  }

  /** HTML 을 구글 문서로(비공개로 새로 만들거나, 그 문서 내용을 바꾼다). */
  private async uploadDoc(token: string, fileId: string | null, title: string, html: string): Promise<{ id: string; url: string }> {
    if (fileId) {
      const res = await this.drive(token, `${DRIVE_UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media&fields=id,webViewLink`, { method: 'PATCH', headers: { 'Content-Type': 'text/html; charset=UTF-8' }, body: html }, '다시 올리');
      const j = (await res.json()) as { id: string; webViewLink: string };
      return { id: j.id, url: j.webViewLink };
    }
    const boundary = 'ssamshare' + randomBytes(8).toString('hex');
    const meta = { name: `쌤보드 공유 · ${title}`, mimeType: 'application/vnd.google-apps.document' };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${boundary}--`;
    const res = await this.drive(token, `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,webViewLink`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, '공유 문서를 만들');
    const file = (await res.json()) as { id: string; webViewLink: string };
    return { id: file.id, url: file.webViewLink };
  }
}
