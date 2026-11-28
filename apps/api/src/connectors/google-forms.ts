import type { FormQuestion, FormQuestionType, FormSpec, QuizSpec } from '@jarvis/shared';

// Google 설문지(Forms API v1)를 부르는 곳. 설문을 만들고, 질문과 응답을 읽는다.
// 권한은 시트 연결과 같은 drive.file(이 앱이 만든 파일만) 하나로 된다 — forms.create·batchUpdate·get·responses.list 모두 그 범위를 받는다.
// Google Cloud 프로젝트에서 "Google Forms API"가 켜져 있어야 한다(꺼져 있으면 403 이고, 그때는 켜는 법을 알려 준다).
// fetch 는 바꿔 끼울 수 있게 받는다(시험에서 가짜를 쓴다).

const FORMS = 'https://forms.googleapis.com/v1/forms';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
/** 한 설문에서 읽는 응답의 한도(표 하나의 행 한도보다 작게 둔다). */
export const FORM_MAX_RESPONSES = 20_000;

export type Fetch = typeof fetch;

/** 표의 sheet_ref 자리에 넣어 두는 설문 연결 정보. */
export interface FormRef {
  kind: 'form';
  form_id: string;
  title: string;
  /** 바깥에 보내는 응답 주소 */
  responder_uri: string;
  /** 링크만 있으면 누구나 응답할 수 있게 여는 데 성공했는지 */
  public_link: boolean;
  /** 응답 시각을 담는 열 */
  time_col_id: string;
  /** 질문 → 표의 열. 설문에서 질문이 없어져도 열은 남긴다. */
  questions: { question_id: string; title: string; col_id: string }[];
}

export interface FormQuestionInfo {
  question_id: string;
  title: string;
  type: FormQuestionType;
}
export interface FormResponse {
  responseId: string;
  createTime?: string;
  lastSubmittedTime?: string;
  answers?: Record<string, { textAnswers?: { answers?: { value?: string }[] }; fileUploadAnswers?: { answers?: { fileName?: string }[] } }>;
}

/** Google 이 돌려준 오류를 사용자가 할 일로 바꿔 말한다. */
export function googleErrorMessage(status: number, body: any, api: 'Google Forms API' | 'Google Drive API' = 'Google Forms API'): string {
  const message = String(body?.error?.message ?? '');
  const reasons = JSON.stringify(body?.error?.details ?? []);
  if (status === 403 && (/has not been used|is disabled/i.test(message) || /SERVICE_DISABLED/.test(reasons)))
    return `Google Cloud 콘솔에서 "${api}"를 켜야 합니다(API 및 서비스 → 라이브러리에서 ${api} 검색 → 사용). 켠 뒤 몇 분 지나 다시 해 보세요.`;
  if (status === 403 && (/insufficient/i.test(message) || /ACCESS_TOKEN_SCOPE_INSUFFICIENT/.test(reasons))) return 'Google 권한이 부족합니다. 설정 → 연결에서 Google 연결을 끊고 다시 연결하세요.';
  if (status === 401) return 'Google 권한이 만료됐거나 취소됐습니다. 설정 → 연결에서 다시 연결하세요.';
  if (status === 403) return 'Google 이 이 요청을 허락하지 않았습니다. 학교 계정이면 관리자가 설문지나 바깥 공유를 막아 두었을 수 있습니다.';
  if (status === 404) return '설문지를 찾을 수 없습니다. 드라이브에서 지워졌을 수 있습니다.';
  if (status === 429) return 'Google 이 잠시 요청을 막았습니다(너무 자주 불렀습니다). 조금 뒤 다시 해 보세요.';
  return `Google 응답 오류(${status})`;
}

async function call<T>(f: Fetch, token: string, method: 'GET' | 'POST', url: string, body?: unknown, api: 'Google Forms API' | 'Google Drive API' = 'Google Forms API'): Promise<T> {
  const res = await f(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(googleErrorMessage(res.status, await res.json().catch(() => null), api));
  return (await res.json()) as T;
}

/**
 * 응답을 받게 연다: 게시(새로 만든 설문지는 게시 안 된 채로 생길 수 있다 — 코덱스·제미나이 검토) + 링크가 있는 누구나 응답.
 * 학교 계정 정책 등으로 막혀도 설문은 그대로 두고 false 만 돌려준다.
 */
export async function openToResponders(token: string, formId: string, f: Fetch = fetch): Promise<boolean> {
  let ok = true;
  try {
    await call(f, token, 'POST', `${FORMS}/${formId}:setPublishSettings`, { publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } }, updateMask: '*' });
  } catch {
    // 옛 방식 설문지는 처음부터 게시된 상태라 이 요청이 없어도 된다 — 아래 권한이 되면 받는다
  }
  try {
    await call(f, token, 'POST', `${DRIVE}/${formId}/permissions`, { type: 'anyone', role: 'reader', view: 'published' }, 'Google Drive API');
  } catch {
    ok = false;
  }
  return ok;
}

/** 질문 하나를 설문지의 항목으로 바꾼다. */
export function questionItem(q: FormQuestion): Record<string, unknown> {
  const kind: Record<string, unknown> =
    q.type === 'short'
      ? { textQuestion: { paragraph: false } }
      : q.type === 'long'
        ? { textQuestion: { paragraph: true } }
        : q.type === 'date'
          ? { dateQuestion: { includeTime: false, includeYear: true } }
          : q.type === 'scale'
            ? { scaleQuestion: { low: q.low ?? 1, high: q.high ?? 5 } }
            : { choiceQuestion: { type: q.type === 'choice' ? 'RADIO' : q.type === 'checkbox' ? 'CHECKBOX' : 'DROP_DOWN', options: (q.options ?? []).map((value) => ({ value })) } };
  return { title: q.title, questionItem: { question: { required: q.required, ...kind } } };
}

/** 설문지가 알려 준 질문 종류를 우리 종류로 읽는다. 모르는 종류는 짧은 글로 본다. */
function typeOf(question: any): FormQuestionType {
  if (question?.choiceQuestion) return question.choiceQuestion.type === 'CHECKBOX' ? 'checkbox' : question.choiceQuestion.type === 'DROP_DOWN' ? 'dropdown' : 'choice';
  if (question?.textQuestion) return question.textQuestion.paragraph ? 'long' : 'short';
  if (question?.dateQuestion) return 'date';
  if (question?.scaleQuestion || question?.ratingQuestion) return 'scale';
  return 'short';
}

function questionsOf(form: any): FormQuestionInfo[] {
  const out: FormQuestionInfo[] = [];
  for (const item of form?.items ?? []) {
    const q = item?.questionItem?.question;
    if (q?.questionId) out.push({ question_id: String(q.questionId), title: String(item.title ?? ''), type: typeOf(q) });
  }
  return out;
}

/**
 * 설문지를 만든다: 빈 설문(제목만) → 설명과 질문 넣기 → 링크만 있으면 누구나 응답할 수 있게 열기.
 * 마지막 단계는 학교 계정 정책 등으로 막힐 수 있어서, 실패해도 설문은 그대로 두고 그 사실만 돌려준다.
 */
export async function createGoogleForm(token: string, spec: FormSpec, f: Fetch = fetch): Promise<{ form_id: string; responder_uri: string; questions: FormQuestionInfo[]; public_link: boolean }> {
  const created = await call<{ formId: string; responderUri?: string }>(f, token, 'POST', FORMS, { info: { title: spec.title, documentTitle: spec.title } });
  const requests: Record<string, unknown>[] = spec.questions.map((q, index) => ({ createItem: { item: questionItem(q), location: { index } } }));
  if (spec.description) requests.unshift({ updateFormInfo: { info: { description: spec.description }, updateMask: 'description' } });
  const updated = await call<{ form?: any }>(f, token, 'POST', `${FORMS}/${created.formId}:batchUpdate`, { includeFormInResponse: true, requests });
  const questions = questionsOf(updated.form);
  if (questions.length !== spec.questions.length) throw new Error('설문지에 질문을 넣었지만 질문 번호를 돌려받지 못했습니다. 드라이브에 만들어진 설문지를 확인하세요.');
  const publicLink = await openToResponders(token, created.formId, f);
  return { form_id: created.formId, responder_uri: String(updated.form?.responderUri ?? created.responderUri ?? ''), questions, public_link: publicLink };
}

/** 지금 설문지에 있는 질문들(설문을 Google 에서 고쳤을 때 새 질문을 알아내는 데 쓴다). */
export async function getFormQuestions(token: string, formId: string, f: Fetch = fetch): Promise<FormQuestionInfo[]> {
  return questionsOf(await call<any>(f, token, 'GET', `${FORMS}/${formId}`));
}

/** 응답을 모두 읽는다(쪽을 넘겨 가며). 낸 시각 순으로 돌려준다. */
export async function listFormResponses(token: string, formId: string, f: Fetch = fetch): Promise<FormResponse[]> {
  const out: FormResponse[] = [];
  let pageToken: string | undefined;
  do {
    const page = await call<{ responses?: FormResponse[]; nextPageToken?: string }>(
      f,
      token,
      'GET',
      `${FORMS}/${formId}/responses?pageSize=5000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
    );
    out.push(...(page.responses ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && out.length < FORM_MAX_RESPONSES);
  const when = (r: FormResponse) => r.lastSubmittedTime ?? r.createTime ?? '';
  return out.slice(0, FORM_MAX_RESPONSES).sort((a, b) => when(a).localeCompare(when(b)));
}

/** 응답 하나에서 그 질문의 답을 글자로 꺼낸다. 여러 개 고른 답은 쉼표로 잇는다. */
export function answerText(response: FormResponse, questionId: string): string {
  const a = response.answers?.[questionId];
  if (!a) return '';
  if (a.textAnswers?.answers)
    return a.textAnswers.answers
      .map((x) => String(x.value ?? ''))
      .filter(Boolean)
      .join(', ');
  if (a.fileUploadAnswers?.answers)
    return a.fileUploadAnswers.answers
      .map((x) => String(x.fileName ?? ''))
      .filter(Boolean)
      .join(', ');
  return '';
}

/** 응답들을 표의 열 차례에 맞춘 행으로 바꾼다. columnIds 에 없는 질문의 답은 버린다. */
export function responseRows(ref: Pick<FormRef, 'time_col_id' | 'questions'>, columnIds: string[], responses: FormResponse[]): string[][] {
  const byCol = new Map(ref.questions.map((q) => [q.col_id, q.question_id]));
  return responses.map((r) => columnIds.map((col) => (col === ref.time_col_id ? (r.lastSubmittedTime ?? r.createTime ?? '') : byCol.has(col) ? answerText(r, byCol.get(col)!) : '')));
}

// ── 즉석 퀴즈(구글 설문 퀴즈 모드, 2026-11-28 수업 보드) ─────────────────────────────

/** 퀴즈 문항 → 설문 항목(정답·1점). O·X 는 보기 두 개, 단답은 채점하지 않는다. */
export function quizItem(q: QuizSpec['questions'][number]): Record<string, unknown> {
  const options = q.type === 'choice' ? (q.options ?? []) : q.type === 'ox' ? ['O', 'X'] : [];
  const right = q.type === 'choice' && typeof q.answer === 'number' ? options[q.answer] : q.type === 'ox' ? String(q.answer) : null;
  const question: Record<string, unknown> =
    q.type === 'short' ? { required: false, textQuestion: { paragraph: false } } : { required: true, choiceQuestion: { type: 'RADIO', options: options.map((value) => ({ value })) } };
  if (right) question.grading = { pointValue: 1, correctAnswers: { answers: [{ value: right }] } };
  return { title: q.text, questionItem: { question } };
}

export const QUIZ_NAME_TITLE = '번호나 별명';

/**
 * 구글 설문 퀴즈를 만든다: 빈 설문 → 퀴즈 모드 + 첫 문항 '번호나 별명'(이름·이메일은 받지 않는다) + 문항들 → 링크만 있으면 누구나 응답.
 * 돌려주는 questions 는 [번호나 별명, q1, q2 …] 차례의 설문 질문 id.
 */
export async function createGoogleQuiz(
  token: string,
  spec: QuizSpec,
  f: Fetch = fetch,
): Promise<{ form_id: string; responder_uri: string; name_qid: string; qids: Record<string, string>; public_link: boolean }> {
  const created = await call<{ formId: string; responderUri?: string }>(f, token, 'POST', FORMS, { info: { title: spec.title, documentTitle: spec.title } });
  const requests: Record<string, unknown>[] = [
    { updateSettings: { settings: { quizSettings: { isQuiz: true } }, updateMask: 'quizSettings.isQuiz' } },
    { createItem: { item: { title: QUIZ_NAME_TITLE, questionItem: { question: { required: true, textQuestion: { paragraph: false } } } }, location: { index: 0 } } },
    ...spec.questions.map((q, i) => ({ createItem: { item: quizItem(q), location: { index: i + 1 } } })),
  ];
  const updated = await call<{ form?: any }>(f, token, 'POST', `${FORMS}/${created.formId}:batchUpdate`, { includeFormInResponse: true, requests });
  const got = questionsOf(updated.form);
  if (got.length !== spec.questions.length + 1) throw new Error('설문 퀴즈에 문항을 넣었지만 문항 번호를 돌려받지 못했습니다. 드라이브에 만들어진 설문지를 확인하세요.');
  const publicLink = await openToResponders(token, created.formId, f);
  return {
    form_id: created.formId,
    responder_uri: String(updated.form?.responderUri ?? created.responderUri ?? ''),
    name_qid: got[0]!.question_id,
    qids: Object.fromEntries(spec.questions.map((q, i) => [q.id, got[i + 1]!.question_id])),
    public_link: publicLink,
  };
}

/** 응답 받기 켜기·끄기. 옛 설문지 등으로 안 되면 false(교사가 설문지에서 직접 끄도록 알린다). */
export async function setAcceptingResponses(token: string, formId: string, accepting: boolean, f: Fetch = fetch): Promise<boolean> {
  try {
    await call(f, token, 'POST', `${FORMS}/${formId}:setPublishSettings`, {
      publishSettings: { publishState: { isPublished: true, isAcceptingResponses: accepting } },
      updateMask: 'publishState.isAcceptingResponses',
    });
    return true;
  } catch {
    return false;
  }
}
