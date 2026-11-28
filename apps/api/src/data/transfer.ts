/*
 * 보드 자료 옮기기(두 트랙 공통, docs/TWO_EDITIONS_PLAN.md) — 내보내기·가져오기·구글 드라이브 맞춤이 모두 이것을 쓴다.
 * 파일 모양: { format: 'ssamboard-data', version: 1, schema, exported_at, tables: { 표: 줄[] } }
 *
 * - 내보내기: 한 사용자의 줄만. 열쇠(api_keys)·세션·연결 토큰·감사 기록은 담지 않는다.
 * - 가져오기: 그 사용자의 줄을 지우고 파일의 줄로 바꾼다. 모든 줄의 user_id 를 지금 사용자로 바꿔 넣으므로
 *   사용자 줄·세션·열쇠는 그대로다(다른 기기·다른 설치에서 만든 파일도 된다). 표끼리 가리키는 검사는 켠 채로,
 *   가리켜지는 표부터 넣는다(SYNC_TABLES 순서). 이 설치에 없는 연결(connector)을 가리키면 비운다.
 */
import type { Queryable } from '../db/db.service';

/** 옮기는 표 — 가리켜지는 쪽이 먼저(넣는 순서). users 는 설정 몇 칸만 옮긴다. */
export const SYNC_TABLES = [
  'users',
  'boards',
  'ai_commands',
  'data_tables',
  'data_rows',
  'menu_items',
  'memories',
  'shares',
  'quizzes',
  'quiz_responses',
  'blocks',
  'tasks',
  'events',
  'notifications',
  'conversations',
  'messages',
  'llm_runs',
] as const;
/** 나중에 더한 표 — 그 전에 만든 파일·드라이브 자료에는 없으므로 빈 표로 받는다(새 표를 SYNC_TABLES 에 더하면 여기에도). */
export const ADDED_LATER_TABLES = ['menu_items', 'memories', 'shares', 'quizzes', 'quiz_responses'] as const;
/** 옮기지 않는 표(시험이 표 목록 전체와 견준다 — 새 표가 생기면 둘 중 하나에 넣는다). */
export const LOCAL_ONLY_TABLES = ['schema_migrations', 'app_meta', 'allowed_emails', 'sessions', 'api_keys', 'connectors', 'uploads', 'audit_logs'] as const;
/** users 줄에서 옮기는 칸(이메일·PIN·암호·잠금은 옮기지 않는다) */
const USER_FIELDS = ['name', 'timezone', 'monthly_budget', 'llm_provider', 'llm_model', 'onboarded_at'] as const;

export interface SyncData {
  format: 'ssamboard-data';
  version: 1;
  /** 이 자료를 만든 앱의 마지막 마이그레이션 이름 */
  schema: string;
  exported_at: string;
  tables: Record<string, Record<string, unknown>[]>;
}

async function lastMigration(q: Queryable): Promise<string> {
  return (await q.one<{ name: string }>('select name from schema_migrations order by name desc limit 1'))?.name ?? '';
}

/** 한 시점의 모습으로 내보낸다 — 표마다 따로 읽다가 그사이 바뀌면 부모 없는 줄이 담길 수 있어 한 트랜잭션(반복 읽기)에서(코덱스 검토). */
export function exportSnapshot(db: { tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> }, userId: string): Promise<SyncData> {
  return db.tx(async (q) => {
    await q.query('set transaction isolation level repeatable read');
    return exportData(q, userId);
  });
}

/** 한 사용자의 자료를 JSON 으로. 날짜·jsonb 는 Postgres 가 글자로 바꿔 준다(row_to_json). */
export async function exportData(q: Queryable, userId: string): Promise<SyncData> {
  const tables: SyncData['tables'] = {};
  for (const t of SYNC_TABLES) {
    // users 는 옮기는 설정 칸만 — PIN·암호 해시·잠금 상태는 파일·드라이브에 담지 않는다(코덱스 검토).
    // 공유 링크는 구글 문서로 만든 것만 옮긴다 — 끄기 기록을 다른 기기·다시 로그인한 뒤에도 갖도록(코덱스 검토). 서버의 /s/ 링크는 그 서버에만 둔다(다른 곳에 옮기면 새로 공개되므로).
    const sql =
      t === 'users'
        ? `select json_build_object(${USER_FIELDS.map((f) => `'${f}', ${f}`).join(', ')}) as r from users where id = $1`
        : t === 'shares'
          ? `select row_to_json(x) as r from shares x where user_id = $1 and external_id is not null`
          : `select row_to_json(x) as r from ${t} x where user_id = $1`;
    const rows = await q.query<{ r: Record<string, unknown> }>(sql, [userId]);
    tables[t] = rows.map((row) => row.r);
  }
  return {
    format: 'ssamboard-data',
    version: 1,
    schema: await lastMigration(q),
    exported_at: new Date().toISOString(),
    tables,
  };
}

/** 파일 모양을 본다 — 지우기 전에(표가 빠진 파일로 지금 보드를 비우지 않게). */
export function checkSyncData(data: unknown, mySchema: string): SyncData {
  const d = data as SyncData;
  if (!d || d.format !== 'ssamboard-data' || d.version !== 1 || typeof d.tables !== 'object' || d.tables === null) throw new Error('쌤보드 자료 파일이 아닙니다.');
  if (typeof d.schema !== 'string' || d.schema > mySchema) throw new Error('더 새 판 쌤보드에서 만든 자료입니다. 앱을 새 판으로 바꾼 뒤 다시 하세요.');
  for (const name of ADDED_LATER_TABLES) if (d.tables[name] === undefined) d.tables[name] = [];
  for (const name of SYNC_TABLES) if (!Array.isArray(d.tables[name])) throw new Error(`자료 파일에 ${name} 표가 없습니다. 쌤보드에서 내보낸 파일인지 확인하세요.`);
  if (d.tables.users.length !== 1) throw new Error('자료 파일에 사용자가 한 명이어야 합니다.');
  for (const name of SYNC_TABLES) for (const r of d.tables[name]) if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error(`자료 파일의 ${name} 표가 잘못됐습니다.`);
  return d;
}

/**
 * 한 트랜잭션(q) 안에서 부른다. 그 사용자의 자료를 파일 것으로 통째로 바꾼다.
 * 잘못된 파일이면 첫 줄에서 멈추고(트랜잭션째 되돌아감) 지금 자료는 그대로다.
 */
export async function importData(q: Queryable, raw: unknown, userId: string): Promise<void> {
  const data = checkSyncData(raw, await lastMigration(q));
  // 지우기: 가리키는 쪽부터. 올린 파일 기록은 표를 잃어도 되게 끊는다.
  await q.query('update uploads set table_id = null where user_id = $1', [userId]);
  for (const name of [...SYNC_TABLES].reverse()) {
    if (name === 'users') continue;
    // 서버의 /s/ 공유 링크는 가져오기로 지우지 않는다(파일에 없으므로)
    await q.query(name === 'shares' ? `delete from shares where user_id = $1 and external_id is not null` : `delete from ${name} where user_id = $1`, [userId]);
  }

  // 사용자 설정 몇 칸
  const u = data.tables.users[0];
  const sets = USER_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(u, f) && u[f] !== null);
  if (sets.length > 0) {
    await q.query(`update users set ${sets.map((f, i) => `${f} = $${i + 2}`).join(', ')} where id = $1`, [userId, ...sets.map((f) => u[f])]);
  }

  const connectors = new Set((await q.query<{ id: string }>('select id from connectors where user_id = $1', [userId])).map((r) => r.id));
  for (const name of SYNC_TABLES) {
    if (name === 'users') continue;
    const rows = data.tables[name].map((r) => {
      const row: Record<string, unknown> = { ...r, user_id: userId };
      if ('connector_id' in row && row.connector_id !== null && !connectors.has(String(row.connector_id))) row.connector_id = null;
      return row;
    });
    if (rows.length === 0) continue;
    const info = await q.query<{
      column_name: string;
      is_identity: string;
      is_generated: string;
    }>("select column_name, is_identity, is_generated from information_schema.columns where table_schema = 'public' and table_name = $1", [name]);
    // 계산되는 칸·자동 번호 칸(행 순서 position 등)은 넣지 않는다 — 번호는 DB 가 새로 매기고, 줄은 파일의 번호 순서대로 넣어 순서를 지킨다.
    // (번호표를 손으로 맞추면 가져오기가 실패해도 되돌아가지 않는다 — 코덱스 검토)
    const identity = info.filter((c) => c.is_identity === 'YES').map((c) => c.column_name);
    const cols = info.filter((c) => c.is_generated === 'NEVER' && c.is_identity !== 'YES').map((c) => c.column_name);
    if (identity.length > 0) {
      const key = identity[0];
      rows.sort((a, b) => Number(a[key] ?? 0) - Number(b[key] ?? 0));
    }
    // 칸 구성이 같은 '이어진' 줄끼리 묶어 넣는다 — 줄에 없는 칸은 기본값, 있는 칸은 그 값. 이어진 줄만 묶어야 순서가 지켜진다(코덱스 재확인).
    const groups: [string, Record<string, unknown>[]][] = [];
    for (const r of rows) {
      const key = cols.filter((c) => Object.prototype.hasOwnProperty.call(r, c)).join(',');
      const last = groups[groups.length - 1];
      if (last && last[0] === key) last[1].push(r);
      else groups.push([key, [r]]);
    }
    for (const [key, group] of groups) {
      if (!key) continue;
      const list = key
        .split(',')
        .map((c) => `"${c}"`)
        .join(', ');
      await q.query(`insert into ${name} (${list}) select ${list} from json_populate_recordset(null::${name}, $1::json) with ordinality as x order by x.ordinality`, [JSON.stringify(group)]);
    }
  }
  // 넣은 줄이 가리키는 부모(보드·표·대화)가 모두 이 사용자 것인지 본다 — 여러 사람이 쓰는 서버에서 남의 보드·표에 줄을 붙이지 못하게(제미나이 검토).
  const foreign = await q.one<{ what: string }>(
    `select 'blocks.board_id' as what from blocks c where c.user_id = $1 and not exists (select 1 from boards p where p.id = c.board_id and p.user_id = $1)
     union all select 'blocks.source_table_id' from blocks c where c.user_id = $1 and c.source_table_id is not null and not exists (select 1 from data_tables p where p.id = c.source_table_id and p.user_id = $1)
     union all select 'data_rows.table_id' from data_rows c where c.user_id = $1 and not exists (select 1 from data_tables p where p.id = c.table_id and p.user_id = $1)
     union all select 'quiz_responses.quiz_id' from quiz_responses c where c.user_id = $1 and not exists (select 1 from quizzes p where p.id = c.quiz_id and p.user_id = $1)
     union all select 'messages.conversation_id' from messages c where c.user_id = $1 and not exists (select 1 from conversations p where p.id = c.conversation_id and p.user_id = $1)
     limit 1`,
    [userId],
  );
  if (foreign) throw new Error(`자료 파일이 이 보드에 없는 항목을 가리킵니다(${foreign.what}).`);
}
