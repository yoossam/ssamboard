import type { ColumnType } from './types';

// 자료 수합용 설문(Google 설문지). AI가 질문을 정하면 서버가 Google 설문지를 만들고, 응답을 표로 모은다.
// 여기에는 질문 모양과 그 확인만 둔다. Google 을 부르는 일은 서버의 connectors/google-forms.ts 가 한다.

export const FORM_QUESTION_TYPES = ['short', 'long', 'choice', 'checkbox', 'dropdown', 'date', 'scale'] as const;
export type FormQuestionType = (typeof FORM_QUESTION_TYPES)[number];
export const FORM_QUESTION_LABEL: Record<FormQuestionType, string> = {
  short: '짧은 글',
  long: '긴 글',
  choice: '하나 고르기',
  checkbox: '여러 개 고르기',
  dropdown: '목록에서 고르기',
  date: '날짜',
  scale: '점수',
};
const WITH_OPTIONS: FormQuestionType[] = ['choice', 'checkbox', 'dropdown'];

export interface FormQuestion {
  title: string;
  type: FormQuestionType;
  required: boolean;
  /** choice·checkbox·dropdown 의 보기 */
  options?: string[];
  /** scale 의 가장 낮은 점수(0 또는 1)와 가장 높은 점수(2~10) */
  low?: number;
  high?: number;
}
export interface FormSpec {
  title: string;
  description: string;
  questions: FormQuestion[];
}

export const FORM_MAX_QUESTIONS = 50;
export const FORM_MAX_OPTIONS = 50;
const TITLE_MAX = 200;
const QUESTION_MAX = 300;
const DESCRIPTION_MAX = 2000;
const OPTION_MAX = 200;

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** AI가 준 설문 정의를 확인하고 다듬는다. 잘못된 곳은 몇 번째 질문인지 알려 준다. */
export function checkFormSpec(input: unknown): { ok: true; spec: FormSpec } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: '설문 정의가 객체여야 합니다.' };
  const v = input as Record<string, unknown>;
  const title = clean(v.title, TITLE_MAX);
  if (!title) return { ok: false, error: 'title(설문 제목)이 필요합니다.' };
  if (!Array.isArray(v.questions) || v.questions.length === 0) return { ok: false, error: 'questions(질문 목록)가 필요합니다.' };
  if (v.questions.length > FORM_MAX_QUESTIONS) return { ok: false, error: `질문은 ${FORM_MAX_QUESTIONS}개까지입니다.` };
  const questions: FormQuestion[] = [];
  for (let i = 0; i < v.questions.length; i++) {
    const raw = v.questions[i] as Record<string, unknown> | null;
    const where = `${i + 1}번째 질문`;
    if (!raw || typeof raw !== 'object') return { ok: false, error: `${where}이 객체가 아닙니다.` };
    const qTitle = clean(raw.title, QUESTION_MAX);
    if (!qTitle) return { ok: false, error: `${where}에 title이 필요합니다.` };
    const type = raw.type as FormQuestionType;
    if (!FORM_QUESTION_TYPES.includes(type)) return { ok: false, error: `${where}의 type은 ${FORM_QUESTION_TYPES.join(', ')} 중 하나입니다.` };
    const q: FormQuestion = { title: qTitle, type, required: raw.required === true };
    if (WITH_OPTIONS.includes(type)) {
      const options = Array.isArray(raw.options) ? [...new Set(raw.options.map((o) => clean(o, OPTION_MAX)).filter(Boolean))] : [];
      if (options.length === 0) return { ok: false, error: `${where}(${FORM_QUESTION_LABEL[type]})에는 options(보기)가 필요합니다.` };
      if (options.length > FORM_MAX_OPTIONS) return { ok: false, error: `${where}의 보기는 ${FORM_MAX_OPTIONS}개까지입니다.` };
      q.options = options;
    }
    if (type === 'scale') {
      const low = raw.low === 0 ? 0 : 1;
      const high = typeof raw.high === 'number' && Number.isInteger(raw.high) ? raw.high : 5;
      if (high < 2 || high > 10) return { ok: false, error: `${where}(점수)의 high는 2~10입니다.` };
      q.low = low;
      q.high = high;
    }
    questions.push(q);
  }
  return { ok: true, spec: { title, description: clean(v.description, DESCRIPTION_MAX), questions } };
}

/** 그 질문의 응답을 담을 표 열의 종류. */
export function formColumnType(type: FormQuestionType): ColumnType {
  return type === 'date' ? 'date' : type === 'scale' ? 'number' : 'text';
}
