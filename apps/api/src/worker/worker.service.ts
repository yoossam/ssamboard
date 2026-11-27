import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TRASH_DAYS } from '@jarvis/shared';
import { unlink } from 'node:fs/promises';
import { formatWhen } from '../ai/commands.service';
import { config } from '../config';
import { ConnectorsService } from '../connectors/connectors.service';
import { Db } from '../db/db.service';
import { NotificationsService } from '../notifications/notifications.service';

/** 일정 시작 몇 분 전에 알릴지(NTF-1 기본 10분). */
const REMIND_MINUTES = 10;
const TICK_MS = 60_000;
const HOURLY_MS = 60 * 60_000;
/** 같은 DB를 보는 서버가 둘이어도 워커는 한 곳에서만 돌게 하는 잠금 번호. */
const LOCK_KEY = 728_190_331;

/**
 * 같은 서버에서 도는 워커(6장). 1분마다 깨어나 알림을 만들고 연결된 시트를 동기화하며,
 * 1시간마다 휴지통과 지난 세션을 정리한다.
 * PRD는 PostgreSQL 기반 큐(pg-boss 또는 동급)를 들었는데, 작업이 모두 "때가 된 것을 찾아 처리"하는 꼴이라
 * 큐 테이블 없이 주기 실행 + advisory lock으로 구현했다. 처리 여부는 각 행(reminded_at, last_synced_at)에 남는다.
 */
@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Worker');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastHourly = 0;

  constructor(
    private readonly db: Db,
    private readonly notifications: NotificationsService,
    private readonly connectors: ConnectorsService,
  ) {}

  onModuleInit(): void {
    if (!config.workerEnabled) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 5_000).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const client = await this.db.pool.connect().catch(() => null);
    if (!client) {
      this.running = false;
      return;
    }
    try {
      const got = await client.query('select pg_try_advisory_lock($1) as ok', [LOCK_KEY]);
      if (!got.rows[0]?.ok) return;
      try {
        await this.step('task reminders', () => this.taskReminders());
        await this.step('event reminders', () => this.eventReminders());
        await this.step('sheet sync', () => this.sheetSync());
        if (Date.now() - this.lastHourly >= HOURLY_MS) {
          this.lastHourly = Date.now();
          await this.step('cleanup', () => this.cleanup());
        }
      } finally {
        await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
      }
    } finally {
      client.release();
      this.running = false;
    }
  }

  private async step(name: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e: any) {
      this.log.error(`${name}: ${e?.message ?? e}`);
    }
  }

  /** 마감이 된 할 일(NTF-1). 한 번 알린 것은 reminded_at으로 표시하고, 마감을 바꾸면 다시 알린다. */
  async taskReminders(): Promise<number> {
    const rows = await this.db.query<{ id: string; user_id: string; title: string; due_at: Date; timezone: string }>(
      `update tasks t set reminded_at = now() from users u
        where u.id = t.user_id and t.deleted_at is null and t.status = 'open' and t.reminded_at is null
          and t.due_at <= now() and t.due_at > now() - interval '1 day'
        returning t.id, t.user_id, t.title, t.due_at, u.timezone`,
    );
    for (const r of rows) {
      await this.notifications.notify(r.user_id, {
        source: 'tasks',
        title: `할 일 마감: ${r.title}`,
        body: `마감 ${formatWhen(new Date(r.due_at).toISOString(), r.timezone)}`,
        priority: 'urgent',
        ref: { task_id: r.id },
      });
    }
    return rows.length;
  }

  /** 곧 시작하는 일정(시작 10분 전). */
  async eventReminders(): Promise<number> {
    const rows = await this.db.query<{ id: string; user_id: string; title: string; start_at: Date; timezone: string }>(
      `update events e set reminded_at = now() from users u
        where u.id = e.user_id and e.deleted_at is null and e.reminded_at is null
          and e.start_at <= now() + make_interval(mins => $1) and e.start_at > now() - interval '5 minutes'
        returning e.id, e.user_id, e.title, e.start_at, u.timezone`,
      [REMIND_MINUTES],
    );
    for (const r of rows) {
      await this.notifications.notify(r.user_id, {
        source: 'events',
        title: `곧 시작: ${r.title}`,
        body: `시작 ${formatWhen(new Date(r.start_at).toISOString(), r.timezone)}`,
        priority: 'normal',
        ref: { event_id: r.id },
      });
    }
    return rows.length;
  }

  /** 주기가 된 연결된 표를 원본 시트에서 다시 읽는다(GSH-3). 실패·구조 변경은 알림으로 남는다. */
  async sheetSync(): Promise<number> {
    const due = await this.connectors.dueTables();
    for (const t of due) await this.connectors.syncTable(t.user_id, t.id);
    return due.length;
  }

  /** 휴지통 30일 정리(5장), 지난 세션·주인 없는 업로드 정리. */
  async cleanup(): Promise<void> {
    for (const table of ['data_rows', 'blocks', 'tasks', 'events', 'data_tables']) {
      await this.db.query(`delete from ${table} where deleted_at is not null and deleted_at < now() - make_interval(days => $1)`, [TRASH_DAYS]);
    }
    await this.db.query(`delete from sessions where expires_at < now() - interval '7 days' or revoked_at < now() - interval '7 days'`);
    await this.db.query(`delete from ai_commands where status in ('proposed', 'cancelled') and created_at < now() - interval '7 days'`);
    // 미리보기만 하고 표로 만들지 않은 업로드는 하루 뒤에 지운다.
    const stale = await this.db.query<{ id: string; storage_path: string }>(`delete from uploads where table_id is null and created_at < now() - interval '1 day' returning id, storage_path`);
    for (const u of stale) if (u.storage_path) await unlink(u.storage_path).catch(() => undefined);
  }
}
