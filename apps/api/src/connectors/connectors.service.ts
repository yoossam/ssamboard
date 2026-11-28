import { Injectable } from '@nestjs/common';
import { buildColumns, formColumnType, inferColumnType, splitHeader, type Column, type ColumnType, type ConnectorDto, type FormSpec, type TableDto } from '@jarvis/shared';
import { DRIVE_FILE_SCOPE, GoogleService } from '../auth/google.service';
import { decrypt, encrypt, randomToken, sha256 } from '../common/crypto';
import { bad, notFound } from '../common/http';
import { config } from '../config';
import { Db, json, type Queryable } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TablesService } from '../tables/tables.service';
import { createGoogleForm, getFormQuestions, listFormResponses, responseRows, type Fetch, type FormRef } from './google-forms';

export interface SheetRef {
  spreadsheet_id: string;
  spreadsheet_name: string;
  tab: string;
  range: string | null;
  /** 연결할 때의 머리글. 동기화 때 이 값과 다르면 구조가 바뀐 것으로 본다(GSH-4). */
  header: string[];
}

export interface LinkInput {
  connector_id: string;
  spreadsheet_id: string;
  tab: string;
  range?: string | null;
  mode: 'copy' | 'linked';
  name?: string;
  sync_minutes?: number;
  columns?: { name: string; type: ColumnType }[];
}

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
/** 연결된 시트 최대 10만 셀(5장 데이터 규모). */
const MAX_SHEET_CELLS = 100_000;
const SHEET_ID_RE = /^[A-Za-z0-9_-]{20,100}$/;
const RANGE_RE = /^[A-Za-z]{1,3}\d{0,7}(:[A-Za-z]{1,3}\d{0,7})?$/;
const CONNECTOR_COLUMNS = 'id, type, name, status, scopes, last_synced_at, last_error';

const cell = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));
const sameHeader = (a: string[], b: string[]) => a.length === b.length && a.every((h, i) => h.trim() === (b[i] ?? '').trim());

/** 커넥터(4.6). MVP는 Google 시트(읽기 전용)와 웹훅 수신이다. 토큰은 암호화해 서버에만 둔다(CON-3). */
@Injectable()
export class ConnectorsService {
  constructor(
    private readonly db: Db,
    private readonly google: GoogleService,
    private readonly tables: TablesService,
    private readonly notifications: NotificationsService,
  ) {}

  list(userId: string): Promise<ConnectorDto[]> {
    return this.db.query<ConnectorDto>(`select ${CONNECTOR_COLUMNS} from connectors where user_id = $1 order by created_at`, [userId]);
  }

  // ── Google 시트 ─────────────────────────────────────────────

  /** 동의를 마친 뒤 리프레시 토큰을 암호화해 저장한다. Google 시트 커넥터는 사용자당 하나다. */
  async saveGoogle(userId: string, refreshToken: string, scopes: string[]): Promise<string> {
    if (!scopes.includes(DRIVE_FILE_SCOPE)) bad('선택한 파일에 접근하는 권한(drive.file)에 동의해야 합니다.');
    const existing = await this.db.one<{ id: string }>(`select id from connectors where user_id = $1 and type = 'google_sheets'`, [userId]);
    const token = encrypt(refreshToken, config.masterKey);
    if (existing) {
      await this.db.query(`update connectors set token_encrypted = $2, scopes = $3, status = 'active', last_error = null where id = $1`, [existing.id, token, [DRIVE_FILE_SCOPE]]);
      return existing.id;
    }
    const row = await this.db.one<{ id: string }>(`insert into connectors(user_id, type, name, scopes, token_encrypted) values ($1, 'google_sheets', 'Google 시트', $2, $3) returning id`, [
      userId,
      [DRIVE_FILE_SCOPE],
      token,
    ]);
    return row!.id;
  }

  /** 구글 설문 퀴즈용 접근 토큰 — 트랜잭션 안에서도(q) 부를 수 있게(브라우저 판 DB 는 연결이 하나라 바깥 연결로 읽으면 멈춘다) */
  async formsToken(userId: string, q: Queryable = this.db): Promise<string> {
    const connector = await this.googleConnector(userId, q);
    if (!connector) bad('Google 이 연결돼 있지 않습니다. 설정 → 연결에서 Google 을 먼저 연결하세요.');
    return this.googleToken(userId, connector!.id, q);
  }

  /** 사용자의 구글 연결(drive.file)로 받은 접근 토큰 — 공유 링크(구글 문서)처럼 표 연결 밖에서 드라이브를 쓸 때. */
  async driveToken(userId: string): Promise<string> {
    const row = await this.db.one<{ id: string }>(`select id from connectors where user_id = $1 and type = 'google_sheets' order by created_at limit 1`, [userId]);
    if (!row) bad('구글 문서로 공유하려면 설정 → 연결에서 구글을 먼저 연결하세요.');
    return this.googleToken(userId, row!.id);
  }

  /** (트랜잭션 안에서 실패하면 '오류' 표시도 함께 되돌아간다 — 다음 시트 읽기 때 다시 표시되므로 둔다, 제미나이 재검토)
   * q: 트랜잭션 안에서 부를 때(설문 만들기 승인) — 브라우저 안 DB 는 연결이 하나라 바깥 연결로 읽으면 서로 기다린다(코덱스 검토) */
  private async googleToken(userId: string, connectorId: string, q: Queryable = this.db): Promise<string> {
    const row = await q.one<{ token_encrypted: string | null }>(`select token_encrypted from connectors where id = $1 and user_id = $2 and type = 'google_sheets'`, [connectorId, userId]);
    if (!row) notFound('커넥터');
    if (!row!.token_encrypted) bad('Google 연결이 끊겼습니다. 설정의 연결에서 다시 연결하세요.');
    try {
      return await this.google.accessToken(decrypt(row!.token_encrypted!, config.masterKey));
    } catch {
      await q.query(`update connectors set status = 'error', last_error = $2 where id = $1`, [connectorId, 'Google 권한이 만료됐거나 취소됐습니다. 다시 연결하세요.']);
      return bad('Google 권한이 만료됐거나 취소됐습니다. 설정의 연결에서 다시 연결하세요.');
    }
  }

  /**
   * Google Picker를 띄우는 데 필요한 값. Picker는 브라우저에서 돌기 때문에 1시간짜리 액세스 토큰을 내려보낸다.
   * 범위는 drive.file(사용자가 고른 파일만)이고, 리프레시 토큰은 서버 밖으로 나가지 않는다.
   */
  async pickerConfig(userId: string, connectorId: string): Promise<{ access_token: string; api_key: string; app_id: string }> {
    if (!config.google.pickerApiKey || !config.google.appId) bad('서버에 GOOGLE_PICKER_API_KEY와 GOOGLE_APP_ID가 설정돼 있지 않습니다.');
    return {
      access_token: await this.googleToken(userId, connectorId),
      api_key: config.google.pickerApiKey,
      app_id: config.google.appId,
    };
  }

  private async sheetsGet<T>(token: string, path: string): Promise<T> {
    const res = await fetch(`${SHEETS_API}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const status = res.status;
      throw new Error(status === 403 || status === 404 ? '시트에 접근할 수 없습니다. 시트를 다시 골라 주세요.' : `Google 시트 응답 오류(${status})`);
    }
    return (await res.json()) as T;
  }

  /** 고른 스프레드시트의 이름과 탭 목록. */
  async tabs(
    userId: string,
    connectorId: string,
    spreadsheetId: string,
  ): Promise<{
    name: string;
    tabs: { title: string; rows: number; cols: number }[];
  }> {
    if (!SHEET_ID_RE.test(spreadsheetId)) bad('스프레드시트 ID가 잘못됐습니다.');
    const token = await this.googleToken(userId, connectorId);
    const meta = await this.sheetsGet<any>(token, `${spreadsheetId}?fields=properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))`).catch((e) => bad(e.message));
    return {
      name: String(meta?.properties?.title ?? ''),
      tabs: (meta?.sheets ?? []).map((s: any) => ({
        title: String(s.properties?.title ?? ''),
        rows: s.properties?.gridProperties?.rowCount ?? 0,
        cols: s.properties?.gridProperties?.columnCount ?? 0,
      })),
    };
  }

  /** 탭(과 범위)을 읽어 머리글과 본문으로 나눈다. 숫자는 서식 없는 값으로, 날짜는 글자로 받는다. */
  private async readSheet(token: string, ref: Pick<SheetRef, 'spreadsheet_id' | 'tab' | 'range'>): Promise<{ header: string[]; body: string[][] }> {
    const a1 = `'${ref.tab.replace(/'/g, "''")}'${ref.range ? `!${ref.range}` : ''}`;
    const data = await this.sheetsGet<{ values?: unknown[][] }>(
      token,
      `${ref.spreadsheet_id}/values/${encodeURIComponent(a1)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&majorDimension=ROWS`,
    );
    const rows = (data.values ?? []).map((r) => r.map(cell));
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    if (rows.length * width > MAX_SHEET_CELLS) throw new Error(`범위가 너무 큽니다(최대 ${MAX_SHEET_CELLS.toLocaleString()}셀). 범위를 좁혀 주세요.`);
    const parsed = splitHeader(rows.filter((r) => r.some((c) => c !== '')).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')));
    if (parsed.header.length === 0) throw new Error('시트에 머리글 행이 없습니다.');
    return parsed;
  }

  /** 가져오기·연결 전 미리보기(GSH-2). 서버가 컬럼 타입을 추정한다. */
  async preview(
    userId: string,
    input: Pick<LinkInput, 'connector_id' | 'spreadsheet_id' | 'tab' | 'range'>,
  ): Promise<{
    header: string[];
    guess: ColumnType[];
    sample: string[][];
    total: number;
  }> {
    const ref = this.checkRef(input);
    const parsed = await this.readSheet(await this.googleToken(userId, input.connector_id), ref).catch((e) => bad(e.message));
    const sample = parsed.body.slice(0, 200);
    return {
      header: parsed.header,
      guess: parsed.header.map((_, i) => inferColumnType(sample.map((r) => r[i]))),
      sample: parsed.body.slice(0, 20),
      total: parsed.body.length,
    };
  }

  private checkRef(input: Pick<LinkInput, 'spreadsheet_id' | 'tab' | 'range'>): { spreadsheet_id: string; tab: string; range: string | null } {
    if (typeof input.spreadsheet_id !== 'string' || !SHEET_ID_RE.test(input.spreadsheet_id)) bad('스프레드시트 ID가 잘못됐습니다.');
    const tab = String(input.tab ?? '').trim();
    if (!tab || tab.length > 100) bad('탭 이름이 필요합니다.');
    const range = input.range ? String(input.range).trim().toUpperCase() : null;
    if (range && !RANGE_RE.test(range)) bad('범위는 A1:F200 같은 형식이어야 합니다.');
    return { spreadsheet_id: input.spreadsheet_id, tab, range };
  }

  /** 고른 시트를 1회 복사(가져오기)하거나, 원본으로 두고 주기적으로 읽는 연결된 표로 등록한다(GSH-2·3). */
  async link(userId: string, input: LinkInput): Promise<{ table: TableDto; failures: Record<string, number> }> {
    const ref = this.checkRef(input);
    const token = await this.googleToken(userId, input.connector_id);
    const meta = await this.tabs(userId, input.connector_id, ref.spreadsheet_id);
    const parsed = await this.readSheet(token, ref).catch((e) => bad(e.message));
    const sample = parsed.body.slice(0, 200);
    const columns =
      Array.isArray(input.columns) && input.columns.length === parsed.header.length
        ? input.columns
        : parsed.header.map((name, i) => ({
            name,
            type: inferColumnType(sample.map((r) => r[i])),
          }));
    const linked = input.mode === 'linked';
    const sheetRef: SheetRef = {
      ...ref,
      spreadsheet_name: meta.name,
      header: parsed.header,
    };
    const result = await this.tables.create(userId, {
      name: (input.name ?? '').trim() || `${meta.name} · ${ref.tab}`,
      columns,
      rawRows: parsed.body,
      origin: 'sheet',
      connector_id: linked ? input.connector_id : null,
      sheet_ref: linked ? (sheetRef as unknown as Record<string, unknown>) : null,
    });
    if (linked) {
      const minutes = Number.isInteger(input.sync_minutes) ? Math.min(1440, Math.max(5, input.sync_minutes!)) : 15;
      await this.db.query('update data_tables set sync_minutes = $2 where id = $1', [result.table.id, minutes]);
    }
    await this.db.query('update connectors set last_synced_at = now(), last_error = null where id = $1', [input.connector_id]);
    return result;
  }

  /**
   * 연결된 표 하나를 원본 시트에서 다시 읽는다(GSH-3).
   * 머리글이 달라졌으면 덮어쓰지 않고 알림으로 알린다(GSH-4). accept가 true면 새 구조를 받아들인다.
   */
  async syncTable(
    userId: string,
    tableId: string,
    accept = false,
  ): Promise<{
    status: 'synced' | 'structure_changed' | 'failed';
    message?: string;
  }> {
    const row = await this.db.one<{
      id: string;
      name: string;
      schema: { columns: Column[] };
      connector_id: string | null;
      sheet_ref: SheetRef | null;
    }>('select id, name, schema, connector_id, sheet_ref from data_tables where id = $1 and user_id = $2 and deleted_at is null', [tableId, userId]);
    if (!row) notFound('표');
    const table = row!;
    if (!table.connector_id || !table.sheet_ref) bad('연결된 표가 아닙니다.');
    // 설문에 이어진 표는 응답을 다시 읽는다(시트와 달리 머리글 견주기가 없다).
    if ((table.sheet_ref as unknown as { kind?: string }).kind === 'form')
      return this.syncForm(userId, {
        ...table,
        connector_id: table.connector_id!,
        sheet_ref: table.sheet_ref as unknown as FormRef,
      });
    const ref = table.sheet_ref!;
    const failKey = `sheet-sync:${tableId}`;
    const structureKey = `sheet-structure:${tableId}`;
    try {
      const parsed = await this.readSheet(await this.googleToken(userId, table.connector_id!), ref);
      let columns = table.schema.columns;
      if (!sameHeader(parsed.header, ref.header)) {
        if (!accept) {
          const message = '원본 시트의 컬럼 구조가 변경됐습니다. 표 상세에서 확인한 뒤 새 구조로 다시 연결하세요.';
          await this.db.query('update data_tables set last_error = $2 where id = $1', [tableId, message]);
          await this.notifications.notify(userId, {
            source: 'google_sheets',
            connector_id: table.connector_id,
            title: `${table.name}: 시트 구조가 변경됐습니다`,
            body: `이전: ${ref.header.join(', ')}\n현재: ${parsed.header.join(', ')}\n덮어쓰지 않고 기다립니다.`,
            priority: 'urgent',
            dedupe_key: structureKey,
            ref: { table_id: tableId },
          });
          return { status: 'structure_changed', message };
        }
        // 새 구조를 받아들인다. 이름이 같은 컬럼은 ID와 타입을 그대로 두어 저장된 집계가 깨지지 않게 한다.
        const sample = parsed.body.slice(0, 200);
        const kept: Column[] = [];
        columns = parsed.header.map((name, i) => {
          const old = table.schema.columns.find((c) => c.name === name.trim() && !kept.includes(c));
          if (old) {
            kept.push(old);
            return old;
          }
          const [created] = buildColumns([{ name, type: inferColumnType(sample.map((r) => r[i])) }], [...table.schema.columns, ...kept]);
          kept.push(created);
          return created;
        });
      }
      await this.db.tx(async (q) => {
        await this.tables.replaceRows(q, userId, tableId, columns, parsed.body);
        await q.query('update data_tables set schema = $2::jsonb, sheet_ref = $3::jsonb, last_synced_at = now(), last_error = null, updated_at = now() where id = $1', [
          tableId,
          json({ columns }),
          json({ ...ref, header: parsed.header }),
        ]);
        await q.query('update connectors set last_synced_at = now(), last_error = null, status = $2 where id = $1', [table.connector_id, 'active']);
      });
      await this.notifications.closeDedupe(userId, failKey);
      await this.notifications.closeDedupe(userId, structureKey);
      return { status: 'synced' };
    } catch (e: any) {
      const message = String(e?.response?.message ?? e?.message ?? '알 수 없는 오류').slice(0, 300);
      await this.db.query('update data_tables set last_error = $2 where id = $1', [tableId, message]);
      await this.db.query('update connectors set last_error = $2 where id = $1', [table.connector_id, message]);
      // 15분마다 같은 이유로 실패해도 알림은 한 줄로 묶인다(NTF-6).
      await this.notifications.notify(userId, {
        source: 'google_sheets',
        connector_id: table.connector_id,
        title: `${table.name}: 시트 동기화 실패`,
        body: message,
        priority: 'normal',
        dedupe_key: failKey,
        ref: { table_id: tableId },
      });
      return { status: 'failed', message };
    }
  }

  // ── Google 설문 ─────────────────────────────────────────────

  /** 설문과 시트가 함께 쓰는 Google 연결. 연결돼 있지 않으면 null. */
  googleConnector(userId: string, q: Queryable = this.db): Promise<{ id: string } | null> {
    return q.one<{ id: string }>(`select id from connectors where user_id = $1 and type = 'google_sheets' and status = 'active' and token_encrypted is not null order by created_at limit 1`, [userId]);
  }

  /**
   * 설문지를 만들고, 응답을 모을 표를 함께 만든다. 표는 설문에 이어진 읽기 전용 표이고 주기적으로 응답을 다시 읽는다.
   * Google 에 만든 설문지는 되돌릴 수 없다(표를 지워도 드라이브에 남는다).
   */
  async createForm(userId: string, spec: FormSpec, q: Queryable = this.db, commandId: string | null = null, f: Fetch = fetch): Promise<{ table: TableDto; form: FormRef }> {
    const connector = await this.googleConnector(userId, q);
    if (!connector) bad('Google 이 연결돼 있지 않습니다. 설정 → 연결에서 Google 을 먼저 연결하세요.');
    const token = await this.googleToken(userId, connector!.id, q);
    const made = await createGoogleForm(token, spec, f).catch((e) => bad(e.message));
    const { table } = await this.tables.create(
      userId,
      {
        name: spec.title,
        columns: [
          { name: '응답 시각', type: 'datetime' },
          ...spec.questions.map((question) => ({
            name: question.title.slice(0, 60),
            type: formColumnType(question.type),
          })),
        ],
        rawRows: [],
        origin: 'form',
        connector_id: connector!.id,
        // 열 ID 는 표를 만든 뒤에야 알 수 있어서, 연결 정보는 바로 아래에서 채운다.
        sheet_ref: { kind: 'form' },
      },
      q,
      commandId,
    );
    const [timeCol, ...answerCols] = table.schema.columns;
    const form: FormRef = {
      kind: 'form',
      form_id: made.form_id,
      title: spec.title,
      responder_uri: made.responder_uri,
      public_link: made.public_link,
      time_col_id: timeCol.id,
      questions: made.questions.map((question, i) => ({
        question_id: question.question_id,
        title: question.title,
        col_id: answerCols[i].id,
      })),
    };
    await q.query('update data_tables set sheet_ref = $2::jsonb where id = $1 and user_id = $3', [table.id, json(form), userId]);
    return { table: (await this.tables.get(userId, table.id, q))!, form };
  }

  /** 설문 응답을 다시 읽어 표를 채운다. 설문지에 새로 생긴 질문은 열을 더하고, 없어진 질문의 열은 남긴다. */
  private async syncForm(
    userId: string,
    table: {
      id: string;
      name: string;
      schema: { columns: Column[] };
      connector_id: string;
      sheet_ref: FormRef;
    },
    f: Fetch = fetch,
  ): Promise<{ status: 'synced' | 'failed'; message?: string }> {
    const failKey = `form-sync:${table.id}`;
    const ref = table.sheet_ref;
    try {
      const token = await this.googleToken(userId, table.connector_id);
      const [questions, responses] = await Promise.all([getFormQuestions(token, ref.form_id, f), listFormResponses(token, ref.form_id, f)]);
      const known = new Set(ref.questions.map((question) => question.question_id));
      let columns = table.schema.columns;
      const mapping = [...ref.questions];
      for (const question of questions) {
        if (known.has(question.question_id)) continue;
        const [col] = buildColumns(
          [
            {
              name: (question.title || '새 질문').slice(0, 60),
              type: formColumnType(question.type),
            },
          ],
          columns,
        );
        columns = [...columns, col];
        mapping.push({
          question_id: question.question_id,
          title: question.title,
          col_id: col.id,
        });
      }
      const next: FormRef = { ...ref, questions: mapping };
      await this.db.tx(async (q) => {
        await this.tables.replaceRows(
          q,
          userId,
          table.id,
          columns,
          responseRows(
            next,
            columns.map((c) => c.id),
            responses,
          ),
        );
        // updated_at 은 건드리지 않는다. 응답을 다시 읽은 것은 사용자가 고친 것이 아니어서, 설문 만들기를 되돌릴 때 막히면 안 된다.
        await q.query('update data_tables set schema = $2::jsonb, sheet_ref = $3::jsonb, last_synced_at = now(), last_error = null where id = $1', [table.id, json({ columns }), json(next)]);
        await q.query(`update connectors set last_synced_at = now(), last_error = null, status = 'active' where id = $1`, [table.connector_id]);
      });
      await this.notifications.closeDedupe(userId, failKey);
      return { status: 'synced' };
    } catch (e: any) {
      const message = String(e?.response?.message ?? e?.message ?? '알 수 없는 오류').slice(0, 300);
      await this.db.query('update data_tables set last_error = $2, last_synced_at = now() where id = $1', [table.id, message]);
      await this.notifications.notify(userId, {
        source: 'google_forms',
        connector_id: table.connector_id,
        title: `${table.name}: 설문 응답을 읽지 못했습니다`,
        body: message,
        priority: 'normal',
        dedupe_key: failKey,
        ref: { table_id: table.id },
      });
      return { status: 'failed', message };
    }
  }

  /** 커넥터에 연결된 표를 모두 지금 동기화한다(수동 새로고침). */
  async syncConnector(userId: string, connectorId: string): Promise<{ synced: number; failed: number; structure_changed: number }> {
    const connector = await this.db.one<{ type: string }>('select type from connectors where id = $1 and user_id = $2', [connectorId, userId]);
    if (!connector) notFound('커넥터');
    if (connector!.type !== 'google_sheets') bad('동기화할 수 있는 커넥터가 아닙니다.');
    const tables = await this.db.query<{ id: string }>('select id from data_tables where connector_id = $1 and user_id = $2 and sheet_ref is not null and deleted_at is null', [connectorId, userId]);
    const count = { synced: 0, failed: 0, structure_changed: 0 };
    for (const t of tables) count[(await this.syncTable(userId, t.id)).status] += 1;
    return count;
  }

  /** 주기가 된 연결된 표 목록(워커용). */
  dueTables(): Promise<{ id: string; user_id: string }[]> {
    return this.db.query(
      `select t.id, t.user_id from data_tables t join connectors c on c.id = t.connector_id
        where t.deleted_at is null and t.sheet_ref is not null and c.status = 'active'
          and (t.last_synced_at is null or t.last_synced_at < now() - make_interval(mins => t.sync_minutes))
        order by t.last_synced_at nulls first limit 20`,
    );
  }

  // ── 웹훅 ───────────────────────────────────────────────────

  /**
   * 웹훅 커넥터를 만든다(CON-6). 비밀 URL과 서명 키는 이때 한 번만 보여준다.
   * URL의 비밀값은 해시로, 서명 키는 암호화해 저장한다.
   */
  async createWebhook(userId: string, name: string): Promise<{ connector: ConnectorDto; url: string; signing_secret: string }> {
    const pathSecret = randomToken(24);
    const signingSecret = randomToken(32);
    const row = await this.db.one<ConnectorDto>(
      `insert into connectors(user_id, type, name, scopes, token_encrypted, config) values ($1, 'webhook', $2, $3, $4, $5::jsonb) returning ${CONNECTOR_COLUMNS}`,
      [userId, name, ['알림 만들기'], encrypt(signingSecret, config.masterKey), json({ path_hash: sha256(pathSecret) })],
    );
    return {
      connector: row!,
      url: `${config.publicUrl}/api/webhooks/${row!.id}/${pathSecret}`,
      signing_secret: signingSecret,
    };
  }

  /** 웹훅 수신에 필요한 값을 꺼낸다. 없거나 꺼진 커넥터면 null. */
  async webhookSecrets(connectorId: string): Promise<{
    user_id: string;
    name: string;
    path_hash: string;
    signing_secret: string;
  } | null> {
    const row = await this.db.one<{
      user_id: string;
      name: string;
      token_encrypted: string | null;
      config: { path_hash?: string };
    }>(`select user_id, name, token_encrypted, config from connectors where id = $1 and type = 'webhook' and status = 'active'`, [connectorId]);
    if (!row?.token_encrypted || !row.config?.path_hash) return null;
    return {
      user_id: row.user_id,
      name: row.name,
      path_hash: row.config.path_hash,
      signing_secret: decrypt(row.token_encrypted, config.masterKey),
    };
  }

  async touch(connectorId: string): Promise<void> {
    await this.db.query('update connectors set last_synced_at = now(), last_error = null where id = $1', [connectorId]);
  }

  // ── 해제 ───────────────────────────────────────────────────

  /** 연결 해제: 토큰을 Google에서 취소한 뒤 지운다(CON-3). 연결된 표는 마지막으로 읽은 내용 그대로 일반 표가 된다. */
  async remove(userId: string, connectorId: string): Promise<boolean> {
    const row = await this.db.one<{
      type: string;
      token_encrypted: string | null;
    }>('select type, token_encrypted from connectors where id = $1 and user_id = $2', [connectorId, userId]);
    if (!row) return false;
    if (row.type === 'google_sheets' && row.token_encrypted) {
      await this.google.revoke(decrypt(row.token_encrypted, config.masterKey)).catch(() => undefined);
    }
    await this.db.tx(async (q) => {
      await q.query('update data_tables set sheet_ref = null, last_error = null where connector_id = $1 and user_id = $2', [connectorId, userId]);
      await q.query('delete from connectors where id = $1 and user_id = $2', [connectorId, userId]);
    });
    return true;
  }
}
