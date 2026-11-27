import { Injectable } from '@nestjs/common';
import type { EventDto, TaskDto } from '@jarvis/shared';
import { Db, type Queryable } from '../db/db.service';

const TASK_COLUMNS = 'id, title, due_at, status, note';
const EVENT_COLUMNS = 'id, title, start_at, end_at';

/** 할 일과 일정. 시각은 UTC로 저장하고 사용자 시간대로 보여 준다(BRD-8). 반복 일정은 MVP에서 다루지 않는다. */
@Injectable()
export class ItemsService {
  constructor(private readonly db: Db) {}

  listTasks(userId: string, status?: 'open' | 'done', q: Queryable = this.db): Promise<TaskDto[]> {
    return q.query<TaskDto>(
      `select ${TASK_COLUMNS} from tasks where user_id = $1 and deleted_at is null and ($2::text is null or status = $2)
       order by (status = 'done'), due_at nulls last, created_at limit 200`,
      [userId, status ?? null],
    );
  }

  async createTask(userId: string, input: { title: string; due_at: string | null }, q: Queryable = this.db, commandId: string | null = null): Promise<TaskDto> {
    return (await q.one<TaskDto>(`insert into tasks(user_id, title, due_at, command_id) values ($1, $2, $3, $4) returning ${TASK_COLUMNS}`, [
      userId,
      input.title,
      input.due_at,
      commandId,
    ]))!;
  }

  /** due_at을 지우려면 clear_due를 true로 준다. 마감이 바뀌면 알림을 다시 보낼 수 있게 reminded_at을 비운다. */
  updateTask(
    userId: string,
    id: string,
    patch: { title?: string; due_at?: string | null; status?: 'open' | 'done'; note?: string },
    q: Queryable = this.db,
  ): Promise<TaskDto | null> {
    const setDue = patch.due_at !== undefined;
    return q.one<TaskDto>(
      `update tasks set
         title = coalesce($3, title),
         due_at = case when $4::boolean then $5::timestamptz else due_at end,
         reminded_at = case when $4::boolean then null else reminded_at end,
         status = coalesce($6, status),
         note = coalesce($7, note),
         updated_at = now()
       where id = $1 and user_id = $2 and deleted_at is null returning ${TASK_COLUMNS}`,
      [id, userId, patch.title ?? null, setDue, setDue ? patch.due_at : null, patch.status ?? null, patch.note ?? null],
    );
  }

  async deleteTask(userId: string, id: string, q: Queryable = this.db): Promise<boolean> {
    return (await q.query('update tasks set deleted_at = now(), updated_at = now() where id = $1 and user_id = $2 and deleted_at is null returning id', [id, userId])).length > 0;
  }

  /** 기간을 주지 않으면 사용자 시간대의 오늘 하루를 돌려준다. */
  listEvents(userId: string, timezone: string, from?: string | null, to?: string | null, q: Queryable = this.db): Promise<EventDto[]> {
    return q.query<EventDto>(
      `select ${EVENT_COLUMNS} from events
        where user_id = $1 and deleted_at is null
          and start_at >= coalesce($3::timestamptz, date_trunc('day', now() at time zone $2) at time zone $2)
          and start_at <  coalesce($4::timestamptz, (date_trunc('day', now() at time zone $2) + interval '1 day') at time zone $2)
        order by start_at limit 200`,
      [userId, timezone, from ?? null, to ?? null],
    );
  }

  async createEvent(
    userId: string,
    input: { title: string; start_at: string; end_at: string | null },
    q: Queryable = this.db,
    commandId: string | null = null,
  ): Promise<EventDto> {
    return (await q.one<EventDto>(`insert into events(user_id, title, start_at, end_at, command_id) values ($1, $2, $3, $4, $5) returning ${EVENT_COLUMNS}`, [
      userId,
      input.title,
      input.start_at,
      input.end_at,
      commandId,
    ]))!;
  }

  updateEvent(userId: string, id: string, patch: { title?: string; start_at?: string; end_at?: string | null }, q: Queryable = this.db): Promise<EventDto | null> {
    const setEnd = patch.end_at !== undefined;
    return q.one<EventDto>(
      `update events set
         title = coalesce($3, title),
         start_at = coalesce($4::timestamptz, start_at),
         reminded_at = case when $4::timestamptz is null then reminded_at else null end,
         end_at = case when $5::boolean then $6::timestamptz else end_at end,
         updated_at = now()
       where id = $1 and user_id = $2 and deleted_at is null returning ${EVENT_COLUMNS}`,
      [id, userId, patch.title ?? null, patch.start_at ?? null, setEnd, setEnd ? patch.end_at : null],
    );
  }

  async deleteEvent(userId: string, id: string, q: Queryable = this.db): Promise<boolean> {
    return (await q.query('update events set deleted_at = now(), updated_at = now() where id = $1 and user_id = $2 and deleted_at is null returning id', [id, userId])).length > 0;
  }
}
