import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { bad, notFound } from '../common/http';
import { config } from '../config';
import { Db, type Queryable } from '../db/db.service';

/*
 * 고칠 파일 보관(2026-11-28): AI 창에 붙인 엑셀·한글(HWPX) 원본(edit_source)과 고친 결과(edit_result).
 * uploads 표를 같이 쓰고(kind 로 나눔) 하루 뒤 일꾼이 지운다(표를 만들지 않은 업로드와 같은 규칙). 구글 드라이브 트랙은 이 탭의 메모리에만 있다.
 */
export const EDITABLE_EXT = new Set(['.xlsx', '.hwpx']);
const MIME: Record<string, string> = { '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.hwpx': 'application/hwp+zip' };

@Injectable()
export class FilesService {
  constructor(private readonly db: Db) {}

  private async store(q: Queryable, userId: string, kind: 'edit_source' | 'edit_result', name: string, buffer: Buffer): Promise<string> {
    const ext = extname(name).toLowerCase();
    await mkdir(config.uploadDir, { recursive: true });
    const row = (await q.one<{ id: string }>(`insert into uploads(user_id, filename, size, mime, storage_path, kind) values ($1, $2, $3, $4, '', $5) returning id`, [userId, name.slice(0, 200), buffer.length, MIME[ext] ?? '', kind]))!;
    const path = join(config.uploadDir, `${row.id}${ext}`);
    await writeFile(path, buffer);
    await q.query('update uploads set storage_path = $2 where id = $1', [row.id, path]);
    return row.id;
  }

  saveSource(userId: string, name: string, buffer: Buffer): Promise<string> {
    return this.store(this.db, userId, 'edit_source', name, buffer);
  }

  saveResult(userId: string, name: string, buffer: Buffer, q: Queryable = this.db): Promise<string> {
    return this.store(q, userId, 'edit_result', name, buffer);
  }

  async source(userId: string, id: string, q: Queryable = this.db): Promise<{ name: string; ext: string; buffer: Buffer }> {
    const row = await q.one<{ filename: string; storage_path: string }>(`select filename, storage_path from uploads where id = $1 and user_id = $2 and kind = 'edit_source'`, [id, userId]);
    if (!row) notFound('붙인 파일');
    try {
      return { name: row!.filename, ext: extname(row!.filename).toLowerCase(), buffer: await readFile(row!.storage_path) };
    } catch {
      return bad('붙인 파일이 지워졌습니다(하루가 지났거나 새로 고침). 파일을 다시 붙여 주세요.');
    }
  }

  /** 내려받기 — 고친 결과만 */
  async download(userId: string, id: string): Promise<{ name: string; mime: string; data: string }> {
    const row = await this.db.one<{ filename: string; mime: string; storage_path: string }>(`select filename, mime, storage_path from uploads where id = $1 and user_id = $2 and kind = 'edit_result'`, [id, userId]);
    if (!row) notFound('고친 파일');
    try {
      return { name: row!.filename, mime: row!.mime, data: (await readFile(row!.storage_path)).toString('base64') };
    } catch {
      return bad('고친 파일이 지워졌습니다(하루가 지났거나 새로 고침). 다시 고쳐 달라고 해 주세요.');
    }
  }
}
