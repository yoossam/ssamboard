import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { config } from '../config';
import { MIGRATIONS } from './migrations';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
}

type Runner = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

function wrap(runner: Runner): Queryable {
  return {
    async query(sql, params = []) {
      return (await runner.query(sql, params as any[])).rows;
    },
    async one(sql, params = []) {
      return (await runner.query(sql, params as any[])).rows[0] ?? null;
    },
  };
}

/** jsonb 파라미터는 항상 이 함수로 문자열로 만들어 `$n::jsonb`로 넘긴다(배열이 Postgres 배열로 바뀌는 것을 막는다). */
export const json = (v: unknown): string => JSON.stringify(v ?? null);

@Injectable()
export class Db implements Queryable, OnModuleDestroy {
  readonly pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

  query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return wrap(this.pool).query<T>(sql, params);
  }

  one<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    return wrap(this.pool).one<T>(sql, params);
  }

  /** 한 트랜잭션 안에서 실행한다. 이 안에서 now()는 모두 같은 시각이다(Undo의 충돌 판정에 쓴다). */
  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await fn(wrap(client));
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

/** 아직 적용하지 않은 마이그레이션을 순서대로 실행하고, 허용 이메일이 비어 있으면 환경변수로 채운다. */
export async function runMigrations(pool: Pool): Promise<string[]> {
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name as string));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(m.sql);
      await client.query('insert into schema_migrations(name) values ($1)', [m.name]);
      await client.query('commit');
      applied.push(m.name);
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
  for (const email of config.allowedEmails) {
    await pool.query('insert into allowed_emails(email) values ($1) on conflict (email) do nothing', [email]);
  }
  // 로그인 방식(google ↔ password)이 지난번과 다르면 모든 세션을 끝낸다 — 옛 방식으로 들어온 기기가 그대로 남지 않게.
  const before = (await pool.query("select value from app_meta where key = 'login_mode'")).rows[0]?.value as string | undefined;
  if (before !== config.loginMode) {
    if (before) await pool.query('update sessions set revoked_at = now() where revoked_at is null');
    await pool.query(
      "insert into app_meta(key, value) values ('login_mode', $1) on conflict (key) do update set value = excluded.value, updated_at = now()",
      [config.loginMode],
    );
  }
  return applied;
}
