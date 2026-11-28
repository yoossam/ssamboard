/*
 * 즉석 퀴즈(2026-11-28, 수업 보드): "분수 덧셈 퀴즈 5문제 만들어" → 계획(문항·정답 미리보기) → [퀴즈 시작] → 학생은 QR 로 로그인 없이 응답.
 * 문항 검사·채점·집계 규칙을 여기 한 곳에 둔다 — 서버(응답 받기·집계), 화면(미리보기·막대), AI 도구가 같이 쓴다.
 * 시작한 퀴즈의 문항은 고치지 않는다(응답과 정답이 어긋나지 않게 — 코덱스 검토). 고치려면 새 퀴즈를 만든다.
 */

export const QUIZ_QUESTION_TYPES = ['choice', 'ox', 'short'] as const;
export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];
export const QUIZ_QUESTION_TYPE_LABEL: Record<QuizQuestionType, string> = { choice: '객관식', ox: 'O·X', short: '단답(채점 안 함)' };

export const QUIZ_MAX_QUESTIONS = 20;
export const QUIZ_MAX_OPTIONS = 6;
export const QUIZ_DEFAULT_MAX_RESPONSES = 200;
export const QUIZ_DEFAULT_MINUTES = 120;
/** 학생이 적는 번호·별명, 단답의 글자 수 상한 */
export const QUIZ_NAME_MAX = 20;
export const QUIZ_SHORT_MAX = 100;

export interface QuizQuestion {
  /** q1, q2 … — 응답은 이 id 로 저장한다 */
  id: string;
  type: QuizQuestionType;
  text: string;
  /** choice 일 때 보기(2~6개) */
  options?: string[];
  /** choice: 보기 번호(0부터), ox: 'O' | 'X', short: 없음 */
  answer?: number | 'O' | 'X';
  /** 정답 해설(교사 화면·AI 정리에만) */
  explanation?: string;
}
export interface QuizSpec {
  title: string;
  questions: QuizQuestion[];
}

export type QuizStatus = 'open' | 'closed';
export interface QuizDto {
  id: string;
  title: string;
  status: QuizStatus;
  /** 학생이 여는 주소(QR) */
  url: string;
  closes_at: string | null;
  max_responses: number;
  response_count: number;
  spec: QuizSpec;
  created_at: string;
  /** board: 쌤보드 학생 페이지(/q/), google: 구글 설문 퀴즈(결과는 [결과 불러오기]로 읽는다) */
  source: QuizSource;
  /** 구글: 마지막으로 응답을 읽은 시각 */
  synced_at: string | null;
  /** 구글: 링크만 있으면 누구나 응답하게 열렸는지(학교 계정 정책으로 막힐 수 있다) */
  public_link: boolean;
  /** 방금 한 일에 덧붙일 말(예: 구글에서 응답 받기를 끄지 못함) */
  note?: string;
}

export const QUIZ_SOURCES = ['board', 'google'] as const;
export type QuizSource = (typeof QUIZ_SOURCES)[number];

export interface QuizQuestionStat {
  id: string;
  type: QuizQuestionType;
  text: string;
  options: string[];
  answer: number | 'O' | 'X' | null;
  /** 답한 사람 수 */
  answered: number;
  /** 맞힌 사람 수(채점하는 문항만) */
  correct: number | null;
  /** 보기별(choice: 보기 차례, ox: [O, X]) 고른 수. short 는 많이 나온 답 */
  counts: number[];
  top: { text: string; n: number }[];
}
export interface QuizResponseDto {
  id: string;
  name: string;
  score: number;
  hidden: boolean;
  created_at: string;
  answers: Record<string, string>;
}
export interface QuizStats {
  quiz: QuizDto;
  /** 숨긴 응답을 뺀 수 */
  total: number;
  /** 채점하는 문항 수 */
  graded: number;
  avg_score: number | null;
  questions: QuizQuestionStat[];
  responses: QuizResponseDto[];
}

type Check = { ok: true; spec: QuizSpec } | { ok: false; error: string };
const clean = (v: unknown, max: number): string =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .trim()
        .slice(0, max)
    : '';

/** AI·화면이 보낸 퀴즈를 검사해 저장할 모양으로 바꾼다. */
export function checkQuizSpec(input: any): Check {
  const title = clean(input?.title, 80);
  if (!title) return { ok: false, error: 'title(퀴즈 제목)이 필요합니다.' };
  const qs = input?.questions;
  if (!Array.isArray(qs) || qs.length === 0) return { ok: false, error: 'questions가 비어 있습니다.' };
  if (qs.length > QUIZ_MAX_QUESTIONS) return { ok: false, error: `문항은 ${QUIZ_MAX_QUESTIONS}개까지입니다.` };
  const questions: QuizQuestion[] = [];
  for (const [i, q] of qs.entries()) {
    const n = i + 1;
    const type = q?.type as QuizQuestionType;
    if (!QUIZ_QUESTION_TYPES.includes(type)) return { ok: false, error: `${n}번 type은 ${QUIZ_QUESTION_TYPES.join(', ')} 중 하나입니다.` };
    const text = clean(q?.text, 300);
    if (!text) return { ok: false, error: `${n}번 문제 글(text)이 비었습니다.` };
    const out: QuizQuestion = { id: `q${n}`, type, text };
    const explanation = clean(q?.explanation, 300);
    if (explanation) out.explanation = explanation;
    if (type === 'choice') {
      const options = Array.isArray(q?.options) ? q.options.map((o: unknown) => clean(o, 80)).filter(Boolean) : [];
      if (options.length < 2 || options.length > QUIZ_MAX_OPTIONS) return { ok: false, error: `${n}번 보기는 2~${QUIZ_MAX_OPTIONS}개입니다.` };
      if (new Set(options).size !== options.length) return { ok: false, error: `${n}번 보기에 같은 것이 있습니다.` };
      // 정답은 보기 번호(0부터)나 보기 글 그대로 받는다
      let answer = typeof q?.answer === 'number' ? q.answer : options.indexOf(clean(q?.answer, 80));
      if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return { ok: false, error: `${n}번 answer는 보기 번호(0부터) 또는 보기 글이어야 합니다.` };
      out.options = options;
      out.answer = answer;
    } else if (type === 'ox') {
      const a = clean(String(q?.answer ?? ''), 2).toUpperCase();
      if (a !== 'O' && a !== 'X') return { ok: false, error: `${n}번 answer는 O 또는 X입니다.` };
      out.answer = a;
    }
    questions.push(out);
  }
  return { ok: true, spec: { title, questions } };
}

/** 학생이 낸 답을 문항에 맞게 거른다. 모르는 문항·보기 밖 값은 버린다. */
export function cleanAnswers(spec: QuizSpec, raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of spec.questions) {
    const v = clean(raw?.[q.id], QUIZ_SHORT_MAX);
    if (!v) continue;
    if (q.type === 'choice') {
      const i = Number(v);
      if (Number.isInteger(i) && i >= 0 && i < (q.options?.length ?? 0)) out[q.id] = String(i);
    } else if (q.type === 'ox') {
      if (v === 'O' || v === 'X') out[q.id] = v;
    } else out[q.id] = v;
  }
  return out;
}

export const isGraded = (q: QuizQuestion): boolean => q.type !== 'short' && q.answer !== undefined;
export const isCorrect = (q: QuizQuestion, a: string | undefined): boolean => a !== undefined && isGraded(q) && a === String(q.answer);

export function scoreOf(spec: QuizSpec, answers: Record<string, string>): number {
  return spec.questions.filter((q) => isCorrect(q, answers[q.id])).length;
}

/** 응답들로 문항별 집계를 낸다(숨긴 응답은 넣지 않고 부른다). */
export function tallyQuiz(spec: QuizSpec, responses: { answers: Record<string, string> }[]): QuizQuestionStat[] {
  return spec.questions.map((q) => {
    const given = responses.map((r) => r.answers?.[q.id]).filter((a): a is string => typeof a === 'string' && a !== '');
    const options = q.type === 'choice' ? (q.options ?? []) : q.type === 'ox' ? ['O', 'X'] : [];
    const counts = options.map((_, i) => given.filter((a) => (q.type === 'choice' ? a === String(i) : a === options[i])).length);
    const top: { text: string; n: number }[] = [];
    if (q.type === 'short') {
      const m = new Map<string, number>();
      for (const a of given) m.set(a, (m.get(a) ?? 0) + 1);
      top.push(
        ...[...m.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([text, n]) => ({ text, n })),
      );
    }
    return {
      id: q.id,
      type: q.type,
      text: q.text,
      options,
      answer: q.answer ?? null,
      answered: given.length,
      correct: isGraded(q) ? given.filter((a) => isCorrect(q, a)).length : null,
      counts,
      top,
    };
  });
}

/** 정답을 사람 말로(미리보기·AI 정리) */
export function answerLabel(q: Pick<QuizQuestion, 'type' | 'options' | 'answer'>): string {
  if (q.type === 'choice' && typeof q.answer === 'number') return `${q.answer + 1}번 ${q.options?.[q.answer] ?? ''}`;
  if (q.type === 'ox') return String(q.answer ?? '');
  return '(채점 안 함)';
}
