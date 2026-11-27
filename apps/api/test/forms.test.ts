import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkFormSpec, type FormSpec } from '@jarvis/shared';
import { answerText, createGoogleForm, getFormQuestions, googleErrorMessage, listFormResponses, questionItem, responseRows, type Fetch, type FormResponse } from '../src/connectors/google-forms';

const SPEC: FormSpec = {
  title: '현장체험학습 참가 신청',
  description: '11월 30일까지 내 주세요.',
  questions: [
    { title: '학생 이름', type: 'short', required: true },
    { title: '참가 여부', type: 'choice', required: true, options: ['참가', '불참'] },
    { title: '알레르기', type: 'checkbox', required: false, options: ['없음', '견과류', '유제품'] },
    { title: '만족도', type: 'scale', required: false, low: 1, high: 5 },
    { title: '하고 싶은 말', type: 'long', required: false },
  ],
};

/** 가짜 Google: 부른 요청을 적어 두고, 정해 둔 답을 차례로 돌려준다. */
function fake(replies: { status?: number; body: unknown }[]): { f: Fetch; calls: { url: string; method: string; body: any; auth: string }[] } {
  const calls: { url: string; method: string; body: any; auth: string }[] = [];
  const f = (async (url: any, init: any) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined, auth: init?.headers?.Authorization });
    const reply = replies.shift() ?? { status: 500, body: {} };
    return { ok: (reply.status ?? 200) < 400, status: reply.status ?? 200, json: async () => reply.body } as Response;
  }) as Fetch;
  return { f, calls };
}
const formWith = (ids: string[]) => ({
  formId: 'FORM1',
  responderUri: 'https://docs.google.com/forms/d/e/abc/viewform',
  items: SPEC.questions.map((q, i) => ({ title: q.title, questionItem: { question: { questionId: ids[i], ...questionItem(q).questionItem!['question' as never] } } })),
});

describe('설문 정의 확인', () => {
  it('제목·질문을 다듬고, 보기와 점수 범위를 확인한다', () => {
    const ok = checkFormSpec({ title: '  설문  ', questions: [{ title: ' 이름 ', type: 'short' }, { title: '반', type: 'dropdown', options: ['1반', '1반', ' 2반 ', ''] }, { title: '점수', type: 'scale', low: 0, high: 10 }] });
    assert.ok(ok.ok);
    assert.deepEqual(ok.ok && ok.spec, {
      title: '설문',
      description: '',
      questions: [
        { title: '이름', type: 'short', required: false },
        { title: '반', type: 'dropdown', required: false, options: ['1반', '2반'] },
        { title: '점수', type: 'scale', required: false, low: 0, high: 10 },
      ],
    });
  });
  it('모자란 정의는 어디가 문제인지 말한다', () => {
    const err = (v: unknown) => { const r = checkFormSpec(v); return r.ok ? '' : r.error; };
    assert.match(err({ questions: [{ title: 'a', type: 'short' }] }), /title/);
    assert.match(err({ title: 't', questions: [] }), /questions/);
    assert.match(err({ title: 't', questions: [{ title: 'a', type: 'radio' }] }), /1번째 질문의 type/);
    assert.match(err({ title: 't', questions: [{ title: 'a', type: 'short' }, { title: 'b', type: 'choice' }] }), /2번째 질문.*options/);
    assert.match(err({ title: 't', questions: [{ title: 'a', type: 'scale', high: 11 }] }), /high/);
    assert.match(err({ title: 't', questions: Array.from({ length: 51 }, () => ({ title: 'q', type: 'short' })) }), /50개/);
  });
});

describe('Google 설문지 부르기', () => {
  it('빈 설문 → 질문 넣기 → 링크 공개 순서로 부르고, 질문 번호를 돌려준다', async () => {
    const ids = ['q1', 'q2', 'q3', 'q4', 'q5'];
    const { f, calls } = fake([{ body: { formId: 'FORM1', responderUri: 'https://docs.google.com/forms/d/e/abc/viewform' } }, { body: { form: formWith(ids) } }, { body: { id: 'perm' } }]);
    const made = await createGoogleForm('TOKEN', SPEC, f);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
      'POST https://forms.googleapis.com/v1/forms',
      'POST https://forms.googleapis.com/v1/forms/FORM1:batchUpdate',
      'POST https://www.googleapis.com/drive/v3/files/FORM1/permissions',
    ]);
    assert.ok(calls.every((c) => c.auth === 'Bearer TOKEN'));
    // 만들 때는 제목만 보낼 수 있다(설명과 질문은 그다음 요청에서 넣는다).
    assert.deepEqual(calls[0].body, { info: { title: SPEC.title, documentTitle: SPEC.title } });
    const requests = calls[1].body.requests;
    assert.equal(calls[1].body.includeFormInResponse, true);
    assert.deepEqual(requests[0], { updateFormInfo: { info: { description: SPEC.description }, updateMask: 'description' } });
    assert.deepEqual(requests[1], { createItem: { item: { title: '학생 이름', questionItem: { question: { required: true, textQuestion: { paragraph: false } } } }, location: { index: 0 } } });
    assert.deepEqual(requests[2].createItem.item.questionItem.question.choiceQuestion, { type: 'RADIO', options: [{ value: '참가' }, { value: '불참' }] });
    assert.equal(requests[3].createItem.item.questionItem.question.choiceQuestion.type, 'CHECKBOX');
    assert.deepEqual(requests[4].createItem.item.questionItem.question.scaleQuestion, { low: 1, high: 5 });
    assert.deepEqual(requests[5].createItem.item.questionItem.question.textQuestion, { paragraph: true });
    assert.deepEqual(requests.slice(1).map((r: any) => r.createItem.location.index), [0, 1, 2, 3, 4]);
    assert.deepEqual(calls[2].body, { type: 'anyone', role: 'reader', view: 'published' });
    assert.equal(made.form_id, 'FORM1');
    assert.equal(made.responder_uri, 'https://docs.google.com/forms/d/e/abc/viewform');
    assert.equal(made.public_link, true);
    assert.deepEqual(made.questions.map((q) => `${q.question_id}:${q.type}`), ['q1:short', 'q2:choice', 'q3:checkbox', 'q4:scale', 'q5:long']);
  });

  it('링크 공개가 막혀도 설문은 그대로 두고 그 사실만 알린다', async () => {
    const { f } = fake([{ body: { formId: 'FORM1', responderUri: 'u' } }, { body: { form: formWith(['a', 'b', 'c', 'd', 'e']) } }, { status: 403, body: { error: { message: 'sharing restricted' } } }]);
    const made = await createGoogleForm('T', SPEC, f);
    assert.equal(made.public_link, false);
    assert.equal(made.questions.length, 5);
  });

  it('API 가 꺼져 있으면 켜는 법을 알려 준다', async () => {
    const { f } = fake([{ status: 403, body: { error: { message: 'Google Forms API has not been used in project 123 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED' }] } } }]);
    await assert.rejects(createGoogleForm('T', SPEC, f), /Google Forms API"를 켜야 합니다/);
    assert.match(googleErrorMessage(403, { error: { message: 'Request had insufficient authentication scopes.' } }), /다시 연결/);
    assert.match(googleErrorMessage(401, null), /만료/);
    assert.match(googleErrorMessage(404, null), /찾을 수 없습니다/);
    assert.match(googleErrorMessage(500, null), /오류\(500\)/);
  });

  it('응답은 쪽을 넘겨 가며 모두 읽고 낸 시각 순으로 돌려준다', async () => {
    const r = (id: string, at: string): FormResponse => ({ responseId: id, lastSubmittedTime: at });
    const { f, calls } = fake([{ body: { responses: [r('b', '2026-11-27T02:00:00Z')], nextPageToken: 'NEXT 1' } }, { body: { responses: [r('a', '2026-11-27T01:00:00Z')] } }]);
    const all = await listFormResponses('T', 'FORM1', f);
    assert.deepEqual(all.map((x) => x.responseId), ['a', 'b']);
    assert.equal(calls[0].url, 'https://forms.googleapis.com/v1/forms/FORM1/responses?pageSize=5000');
    assert.equal(calls[1].url, 'https://forms.googleapis.com/v1/forms/FORM1/responses?pageSize=5000&pageToken=NEXT%201');
  });

  it('지금 설문지의 질문을 읽는다(질문이 아닌 항목은 건너뛴다)', async () => {
    const { f } = fake([{ body: { items: [{ title: '안내', textItem: {} }, { title: '이름', questionItem: { question: { questionId: 'q1', textQuestion: {} } } }, { title: '날짜', questionItem: { question: { questionId: 'q2', dateQuestion: {} } } }] } }]);
    assert.deepEqual(await getFormQuestions('T', 'FORM1', f), [{ question_id: 'q1', title: '이름', type: 'short' }, { question_id: 'q2', title: '날짜', type: 'date' }]);
  });

  it('응답을 표의 열 차례에 맞춘 행으로 바꾼다', () => {
    const response: FormResponse = {
      responseId: 'r1',
      createTime: '2026-11-27T00:00:00Z',
      lastSubmittedTime: '2026-11-27T01:23:45Z',
      answers: { q1: { textAnswers: { answers: [{ value: '김하늘' }] } }, q3: { textAnswers: { answers: [{ value: '견과류' }, { value: '유제품' }] } }, q9: { fileUploadAnswers: { answers: [{ fileName: '동의서.pdf' }] } } },
    };
    assert.equal(answerText(response, 'q3'), '견과류, 유제품');
    assert.equal(answerText(response, 'q9'), '동의서.pdf');
    assert.equal(answerText(response, 'nope'), '');
    const ref = { time_col_id: 'c_1', questions: [{ question_id: 'q1', title: '이름', col_id: 'c_2' }, { question_id: 'q3', title: '알레르기', col_id: 'c_4' }] };
    // c_3 은 설문지에서 없어진 질문의 열, c_5 는 사용자가 모르는 열이다. 둘 다 빈 칸으로 둔다.
    assert.deepEqual(responseRows(ref, ['c_1', 'c_2', 'c_3', 'c_4', 'c_5'], [response]), [['2026-11-27T01:23:45Z', '김하늘', '', '견과류, 유제품', '']]);
  });
});
