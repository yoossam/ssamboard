/*
 * 구글 드라이브 트랙의 데이터베이스 — PGlite(브라우저 안에서 도는 PostgreSQL).
 * 서버 판과 같은 마이그레이션(apps/api/src/db/migrations.ts)과 같은 SQL 을 그대로 쓴다.
 * 서버 서비스들은 Db 의 query·one·tx 만 쓰므로, 같은 모양의 LocalDb 를 넘기면 고치지 않고 돈다.
 */
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { MIGRATIONS } from '../../api/src/db/migrations';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
}

type Runner = Pick<PGlite, 'query'> | Pick<Transaction, 'query'>;

function wrap(runner: Runner): Queryable {
  return {
    async query(sql, params = []) {
      return (await runner.query<any>(sql, params as any[])).rows;
    },
    async one(sql, params = []) {
      return (await runner.query<any>(sql, params as any[])).rows[0] ?? null;
    },
  };
}

export class LocalDb implements Queryable {
  private readonly plain: Queryable;
  constructor(readonly pg: PGlite) {
    this.plain = wrap(pg);
  }
  query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.plain.query<T>(sql, params);
  }
  one<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    return this.plain.one<T>(sql, params);
  }
  /** 서버 판과 같이 한 트랜잭션 안에서. PGlite 는 연결이 하나라 트랜잭션 안에서는 넘겨받은 q 만 써야 한다. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    return this.pg.transaction((t) => fn(wrap(t)));
  }
  close(): Promise<void> {
    return this.pg.close();
  }
}

/** 아직 적용하지 않은 마이그레이션을 순서대로(서버 판 runMigrations 와 같은 기록 표). */
export async function migrate(pg: PGlite): Promise<string[]> {
  await pg.exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await pg.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    await pg.transaction(async (t) => {
      await t.exec(m.sql);
      await t.query('insert into schema_migrations(name) values ($1)', [m.name]);
    });
    applied.push(m.name);
  }
  return applied;
}

/**
 * DB 열기. dataDir 이 'idb://이름' 이면 브라우저 IndexedDB 에 남고, 없으면 메모리(시험용).
 * PGlite 는 큰 파일(wasm)을 처음 한 번 내려받는다.
 */
export async function openLocalDb(dataDir?: string): Promise<LocalDb> {
  const pg = await PGlite.create(dataDir);
  await migrate(pg);
  return new LocalDb(pg);
}
