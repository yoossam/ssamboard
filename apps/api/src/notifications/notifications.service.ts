import { Injectable } from '@nestjs/common';
import type { NotificationDto, Priority } from '@jarvis/shared';
import { Db, json, type Queryable } from '../db/db.service';

export interface NewNotification {
  source: string;
  title: string;
  body?: string;
  priority?: Priority;
  /** 같은 원인으로 반복되는 알림을 한 줄로 묶는 열쇠(NTF-6). */
  dedupe_key?: string | null;
  ref?: Record<string, unknown> | null;
  connector_id?: string | null;
}

const COLUMNS = 'id, source, title, body, priority, status, count, last_seen_at, created_at';

@Injectable()
export class NotificationsService {
  constructor(private readonly db: Db) {}

  /** 알림을 만든다. dedupe_key가 같은 열린 묶음이 있으면 횟수와 마지막 발생 시각만 갱신한다. */
  async notify(userId: string, n: NewNotification, q: Queryable = this.db): Promise<string> {
    const row = await q.one<{ id: string }>(
      `insert into notifications(user_id, source, connector_id, title, body, priority, ref, dedupe_key)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       on conflict (user_id, dedupe_key) where dedupe_key is not null and status <> 'archived'
       do update set count = notifications.count + 1, last_seen_at = now(), status = 'unread',
                     title = excluded.title, body = excluded.body, priority = excluded.priority
       returning id`,
      [userId, n.source, n.connector_id ?? null, n.title.slice(0, 200), (n.body ?? '').slice(0, 2000), n.priority ?? 'normal', json(n.ref ?? null), n.dedupe_key ?? null],
    );
    return row!.id;
  }

  /** 원인이 해소되면 묶음을 닫는다(보관). */
  async closeDedupe(userId: string, dedupeKey: string, q: Queryable = this.db): Promise<void> {
    await q.query(`update notifications set status = 'archived' where user_id = $1 and dedupe_key = $2 and status <> 'archived'`, [userId, dedupeKey]);
  }

  list(userId: string, status?: 'unread' | 'read' | 'archived', q: Queryable = this.db): Promise<NotificationDto[]> {
    return q.query<NotificationDto>(
      `select ${COLUMNS} from notifications
        where user_id = $1 and (case when $2::text is null then status <> 'archived' else status = $2 end)
        order by (status = 'unread') desc, last_seen_at desc limit 100`,
      [userId, status ?? null],
    );
  }

  async setStatus(userId: string, ids: string[], status: 'unread' | 'read' | 'archived', q: Queryable = this.db): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await q.query('update notifications set status = $3 where user_id = $1 and id = any($2::uuid[]) returning id', [userId, ids, status]);
    return rows.length;
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db.query(`update notifications set status = 'read' where user_id = $1 and status = 'unread'`, [userId]);
  }
}
