import { randomBytes } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import {
  QUIZ_DEFAULT_MAX_RESPONSES,
  QUIZ_DEFAULT_MINUTES,
  QUIZ_NAME_MAX,
  cleanAnswers,
  scoreOf,
  tallyQuiz,
  type QuizDto,
  type QuizResponseDto,
  type QuizSpec,
  type QuizStats,
  type QuizSource,
  type QuizStatus,
} from '@jarvis/shared';
import { ConnectorsService } from '../connectors/connectors.service';
import { answerText, createGoogleQuiz, listFormResponses, setAcceptingResponses, type Fetch } from '../connectors/google-forms';
import { bad, notFound } from '../common/http';
import { RateLimiter } from '../common/rate-limit';
import { config } from '../config';
import { Db, json, type Queryable } from '../db/db.service';

/*
 * 즉석 퀴즈(2026-11-28 수업 보드). 학생은 로그인 없이 /q/<열쇠> 에서 답한다(quiz-page.ts, 스크립트 없는 HTML 폼).
 * 남용 막기(코덱스·제미나이 검토): 추측하기 어려운 열쇠, 퀴즈마다 응답 상한, 자동 마감, 교실 와이파이는 IP 하나라
 * IP 제한은 넉넉히(반 전체가 막히지 않게), 숨은 칸(봇), 길이·보기 검사, 교사의 숨기기·비우기·링크 바꾸기.
 * 같은 기기에서 또 내는 것은 쿠키로 '알려만' 준다(태블릿을 돌려 쓰는 반이 있다). 번호·별명도 반에서는 누구인지 알 수 있으니 익명이라 부르지 않는다.
 * 드라이브 트랙은 서버가 없어 학생이 들어올 곳이 없다 — 만들 때 막는다(구글 설문을 쓰게 안내).
 */

interface QuizRow {
  id: string;
  token: string;
  title: string;
  spec: QuizSpec;
  status: QuizStatus;
  closes_at: string | null;
  max_responses: number;
  created_at: string;
  response_count?: number;
  source: QuizSource;
  form: GoogleQuizRef | null;
  synced_at: string | null;
}

/** 구글 설문 퀴즈 연결 정보(quizzes.form) */
interface GoogleQuizRef {
  form_id: string;
  responder_uri: string;
  name_qid: string;
  /** 우리 문항 id(q1…) → 설문 질문 id */
  qids: Record<string, string>;
  public_link: boolean;
}

const COLS = 'id, token, title, spec, status, closes_at, max_responses, created_at, source, form, synced_at';
/** 교실 하나가 IP 하나로 들어온다 — 한 퀴즈에 1분 120번까지(30명 반이 두 번씩 눌러도 넉넉) */
const perQuizIp = new RateLimiter(120, 60_000);
/** 한 IP 가 여러 퀴즈를 두드리는 것 */
const perIp = new RateLimiter(600, 10 * 60_000);

export const quizUrl = (token: string): string => `${config.publicUrl}/q/${token}`;
export const quizAvailable = (): boolean => config.shareMode === 'server';

function dto(r: QuizRow): QuizDto {
  return {
    id: r.id,
    title: r.title,
    status: effectiveStatus(r),
    url: r.source === 'google' ? (r.form?.responder_uri ?? '') : quizUrl(r.token),
    closes_at: r.closes_at,
    max_responses: r.max_responses,
    response_count: Number(r.response_count ?? 0),
    spec: r.spec,
    created_at: r.created_at,
    source: r.source,
    synced_at: r.synced_at,
    public_link: r.source === 'google' ? r.form?.public_link !== false : true,
  };
}
/** 마감 시각이 지났으면 닫힌 것으로 */
const effectiveStatus = (r: Pick<QuizRow, 'status' | 'closes_at'>): QuizStatus => (r.status === 'open' && (!r.closes_at || Date.parse(r.closes_at) > Date.now()) ? 'open' : 'closed');

export type SubmitResult = { ok: true } | { ok: false; status: number; message: string };

@Injectable()
export class QuizzesService {
  constructor(
    private readonly db: Db,
    @Optional() private readonly connectors?: ConnectorsService,
  ) {}

  /**
   * 퀴즈 만들기. board: 쌤보드 학생 페이지(서버 판만), google: 사용자의 구글 드라이브에 설문 퀴즈(두 판 모두, 구글 연결 필요).
   * 구글 설문은 되돌리기로 지워지지 않는다(드라이브에 남는다).
   */
  async create(
    userId: string,
    spec: QuizSpec,
    q: Queryable = this.db,
    commandId: string | null = null,
    minutes = QUIZ_DEFAULT_MINUTES,
    source: QuizSource = 'board',
    f: Fetch = fetch,
  ): Promise<QuizDto> {
    if (source === 'google') {
      const made = await createGoogleQuiz(await this.google().formsToken(userId, q), spec, f).catch((e) => bad(e.message));
      const form: GoogleQuizRef = { form_id: made.form_id, responder_uri: made.responder_uri, name_qid: made.name_qid, qids: made.qids, public_link: made.public_link };
      // 구글 설문은 교사가 [마감]할 때까지 받는다(앱의 자동 마감 없음)
      const row = await q.one<QuizRow>(
        `insert into quizzes(user_id, token, title, spec, closes_at, max_responses, command_id, source, form)
         values ($1, $2, $3, $4::jsonb, null, $5, $6, 'google', $7::jsonb) returning ${COLS}`,
        [userId, randomBytes(9).toString('base64url'), spec.title, json(spec), QUIZ_DEFAULT_MAX_RESPONSES, commandId, json(form)],
      );
      return dto(row!);
    }
    if (!quizAvailable()) bad('이 판(구글 드라이브)에는 학생이 들어올 서버가 없어 쌤보드 퀴즈를 낼 수 없습니다. 구글 설문으로 만드세요.');
    const token = randomBytes(9).toString('base64url');
    const row = await q.one<QuizRow>(
      `insert into quizzes(user_id, token, title, spec, closes_at, max_responses, command_id)
       values ($1, $2, $3, $4::jsonb, now() + make_interval(mins => $5::int), $6, $7) returning ${COLS}`,
      [userId, token, spec.title, json(spec), minutes, QUIZ_DEFAULT_MAX_RESPONSES, commandId],
    );
    return dto(row!);
  }

  private async row(userId: string, id: string, q: Queryable = this.db): Promise<QuizRow> {
    const r = await q.one<QuizRow>(
      `select ${COLS}, (select count(*)::int from quiz_responses r where r.quiz_id = z.id and not r.hidden and not r.removed) as response_count
       from quizzes z where id = $1 and user_id = $2 and deleted_at is null`,
      [id, userId],
    );
    if (!r) notFound('퀴즈');
    return r!;
  }

  async get(userId: string, id: string): Promise<QuizDto> {
    return dto(await this.row(userId, id));
  }

  async list(userId: string): Promise<QuizDto[]> {
    const rows = await this.db.query<QuizRow>(
      `select ${COLS}, (select count(*)::int from quiz_responses r where r.quiz_id = z.id and not r.hidden and not r.removed) as response_count
       from quizzes z where user_id = $1 and deleted_at is null order by created_at desc limit 50`,
      [userId],
    );
    return rows.map(dto);
  }

  async stats(userId: string, id: string): Promise<QuizStats> {
    const quiz = dto(await this.row(userId, id));
    const responses = await this.db.query<QuizResponseDto>(
      'select id, name, score, hidden, created_at, answers from quiz_responses where quiz_id = $1 and user_id = $2 and not removed order by created_at',
      [id, userId],
    );
    const shown = responses.filter((r) => !r.hidden);
    const questions = tallyQuiz(quiz.spec, shown);
    const graded = questions.filter((s) => s.correct !== null).length;
    return {
      quiz,
      total: shown.length,
      graded,
      avg_score: graded > 0 && shown.length > 0 ? Math.round((shown.reduce((a, r) => a + r.score, 0) / shown.length) * 10) / 10 : null,
      questions,
      responses,
    };
  }

  /** 마감·다시 열기. 다시 열 때 마감 시각이 지났으면 30분 늘린다. */
  async setStatus(userId: string, id: string, status: QuizStatus, f: Fetch = fetch): Promise<QuizDto> {
    const cur = await this.row(userId, id);
    let note: string | undefined;
    if (cur.source === 'google' && cur.form) {
      // 먼저 구글에서 응답 받기를 끄고, 그다음 마지막으로 읽는다(끄기 전에 읽으면 그 사이 낸 답이 빠진다 — 코덱스 검토)
      const token = await this.google().formsToken(userId);
      const notes: string[] = [];
      if (!(await setAcceptingResponses(token, cur.form.form_id, status === 'open', f)))
        notes.push(
          status === 'closed'
            ? '구글 설문지에서 응답 받기를 끄지 못했습니다. 설문지의 응답 탭에서 "응답 받기"를 직접 꺼 주세요.'
            : '구글 설문지에서 응답 받기를 켜지 못했습니다. 설문지의 응답 탭에서 직접 켜 주세요.',
        );
      if (status === 'closed')
        await this.syncWith(userId, cur, token, f).catch((e) => notes.push(`마지막 응답을 읽지 못했습니다(${String(e?.message ?? e).slice(0, 120)}). [결과 불러오기]를 다시 눌러 주세요.`));
      if (notes.length) note = notes.join(' ');
    }
    await this.db.query(
      `update quizzes set status = $3, closes_at = case when source = 'board' and $3 = 'open' and (closes_at is null or closes_at < now() + interval '5 minutes') then now() + interval '30 minutes' else closes_at end, updated_at = now()
       where id = $1 and user_id = $2`,
      [id, userId, status],
    );
    return { ...(await this.get(userId, id)), ...(note ? { note } : {}) };
  }

  /** 구글 설문 퀴즈의 응답을 읽어 쌓는다(새로 온 것만). 몇 개를 새로 받았는지 돌려준다. */
  async sync(userId: string, id: string, f: Fetch = fetch): Promise<{ added: number; quiz: QuizDto }> {
    const cur = await this.row(userId, id);
    if (cur.source !== 'google' || !cur.form) bad('구글 설문 퀴즈가 아닙니다.');
    const added = await this.syncWith(userId, cur, await this.google().formsToken(userId), f);
    return { added, quiz: await this.get(userId, id) };
  }

  private google(): ConnectorsService {
    if (!this.connectors) bad('구글 연결을 쓸 수 없습니다.');
    return this.connectors!;
  }

  private async syncWith(userId: string, cur: QuizRow, token: string, f: Fetch = fetch): Promise<number> {
    const form = cur.form!;
    const responses = await listFormResponses(token, form.form_id, f).catch((e) => bad(e.message));
    let added = 0;
    // 모두 읽는다(listFormResponses 가 2만 개 상한). 고쳐 낸 응답은 더 늦게 낸 것으로 바꾼다 — 숨김은 그대로, 지운 자리표는 건드리지 않는다
    for (const resp of responses) {
      if (!resp.responseId) continue;
      const name = answerText(resp, form.name_qid)
        .replace(/[\u0000-\u001f\u007f<>]/g, '')
        .trim()
        .slice(0, QUIZ_NAME_MAX);
      // 설문 답(보기 글) → 우리 모양(보기 번호·O/X·글)
      const raw: Record<string, string> = {};
      for (const q of cur.spec.questions) {
        const v = answerText(resp, form.qids[q.id] ?? '');
        if (!v) continue;
        raw[q.id] = q.type === 'choice' ? String((q.options ?? []).indexOf(v)) : v;
      }
      const answers = cleanAnswers(cur.spec, raw);
      const rows = await this.db.query(
        `insert into quiz_responses(quiz_id, user_id, name, answers, score, external_id, created_at)
         values ($1, $2, $3, $4::jsonb, $5, $6, coalesce($7::timestamptz, now()))
         on conflict (quiz_id, external_id) where external_id is not null do update set name = excluded.name, answers = excluded.answers, score = excluded.score, created_at = excluded.created_at
           where not quiz_responses.removed and quiz_responses.created_at < excluded.created_at
         returning (xmax = 0) as inserted`,
        [cur.id, userId, name || '(이름 없음)', json(answers), scoreOf(cur.spec, answers), resp.responseId, resp.lastSubmittedTime ?? resp.createTime ?? null],
      );
      added += (rows as { inserted: boolean }[]).filter((x) => x.inserted).length;
    }
    await this.db.query('update quizzes set synced_at = now() where id = $1 and user_id = $2', [cur.id, userId]);
    return added;
  }

  /** 링크 바꾸기 — 옛 QR·주소로는 더 못 들어온다(장난 응답이 몰릴 때) */
  async rotate(userId: string, id: string): Promise<QuizDto> {
    if ((await this.row(userId, id)).source === 'google') bad('구글 설문 퀴즈는 링크를 바꿀 수 없습니다. 구글 설문지에서 응답 받기를 끄세요.');
    await this.db.query('update quizzes set token = $3, updated_at = now() where id = $1 and user_id = $2', [id, userId, randomBytes(9).toString('base64url')]);
    return this.get(userId, id);
  }

  async hideResponse(userId: string, id: string, responseId: string, hidden: boolean): Promise<void> {
    await this.db.query('update quiz_responses set hidden = $4 where id = $3 and quiz_id = $1 and user_id = $2', [id, userId, responseId, hidden]);
  }

  /** 응답 모두 지우기(수업이 끝난 뒤 바로 지우고 싶을 때) */
  async clearResponses(userId: string, id: string): Promise<number> {
    // 구글 퀴즈는 쌤보드 사본만 지운다 — 자리표(removed)를 남겨 다시 읽어도 돌아오지 않게. 구글 원본은 설문지에서 지운다.
    if ((await this.row(userId, id)).source === 'google')
      return (
        await this.db.query(`update quiz_responses set removed = true, hidden = true, name = '', answers = '{}'::jsonb, score = 0 where quiz_id = $1 and user_id = $2 and not removed returning id`, [
          id,
          userId,
        ])
      ).length;
    return (await this.db.query('delete from quiz_responses where quiz_id = $1 and user_id = $2 returning id', [id, userId])).length;
  }

  // ── 학생 쪽(로그인 없음) ──────────────────────────────

  /** 열쇠로 퀴즈를 찾는다. 지웠거나 없으면 null */
  async byToken(token: string): Promise<(QuizRow & { user_id: string; open: boolean }) | null> {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return null;
    const r = await this.db.one<QuizRow & { user_id: string }>(`select ${COLS}, user_id from quizzes where token = $1 and source = 'board' and deleted_at is null`, [token]);
    return r ? { ...r, open: effectiveStatus(r) === 'open' } : null;
  }

  async submit(token: string, ip: string, body: Record<string, unknown>): Promise<SubmitResult> {
    if (!perIp.allow(ip)) return { ok: false, status: 429, message: '잠시 뒤에 다시 내 주세요.' };
    const quiz = await this.byToken(token);
    if (!quiz) return { ok: false, status: 404, message: '없는 퀴즈입니다. 주소를 다시 확인하세요.' };
    if (!quiz.open) return { ok: false, status: 410, message: '이 퀴즈는 마감됐습니다.' };
    if (!perQuizIp.allow(`${quiz.id}:${ip}`)) return { ok: false, status: 429, message: '잠시 뒤에 다시 내 주세요.' };
    // 숨은 칸에 글이 있으면 사람이 아니다 — 받은 척만 한다
    if (typeof body.homepage === 'string' && body.homepage.trim()) return { ok: true };
    const name = String(body.name ?? '')
      .replace(/[\u0000-\u001f\u007f<>]/g, '')
      .trim()
      .slice(0, QUIZ_NAME_MAX);
    if (!name) return { ok: false, status: 400, message: '번호나 별명을 적어 주세요.' };
    const raw: Record<string, unknown> = {};
    for (const q of quiz.spec.questions) raw[q.id] = body[q.id];
    const answers = cleanAnswers(quiz.spec, raw);
    if (Object.keys(answers).length === 0) return { ok: false, status: 400, message: '답을 하나 이상 골라 주세요.' };
    // 퀴즈 줄을 잠그고 다시 본다 — 동시에 낸 답이 상한을 넘지 않게, 그 사이 마감·링크 바꾸기·되돌리기가 끝났으면 받지 않게(코덱스·제미나이 검토).
    // 마감·링크 바꾸기(update)와 되돌리기(for update)도 같은 줄을 잠그므로 차례가 선다.
    const inserted = await this.db.tx(async (q) => {
      const live = await q.one<{ status: QuizStatus; closes_at: string | null; max_responses: number }>(
        'select status, closes_at, max_responses from quizzes where id = $1 and token = $2 and deleted_at is null for update',
        [quiz.id, token],
      );
      if (!live || effectiveStatus(live) !== 'open') return 'closed' as const;
      const n = (await q.one<{ n: number }>('select count(*)::int as n from quiz_responses where quiz_id = $1', [quiz.id]))?.n ?? 0;
      if (n >= live.max_responses) return 'full' as const;
      await q.query('insert into quiz_responses(quiz_id, user_id, name, answers, score) values ($1, $2, $3, $4::jsonb, $5)', [quiz.id, quiz.user_id, name, json(answers), scoreOf(quiz.spec, answers)]);
      return 'ok' as const;
    });
    if (inserted === 'closed') return { ok: false, status: 410, message: '이 퀴즈는 마감됐습니다.' };
    if (inserted === 'full') return { ok: false, status: 409, message: '응답이 꽉 찼습니다. 선생님께 알려 주세요.' };
    return { ok: true };
  }
}
