import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkLinkItems, checkQuizSpec, cleanAnswers, linkKindOf, linksSignature, scoreOf, studentUrl, tallyQuiz } from '@jarvis/shared';
import { config } from '../src/config';
import { renderQuizPage } from '../src/quizzes/quiz-page';
import { createGoogleQuiz, quizItem, setAcceptingResponses } from '../src/connectors/google-forms';
import { parseFindApps, TuildersService, type Fetch } from '../src/tuilders/tuilders.service';

describe('수업 자료 링크', () => {
  it('주소 모양으로 종류를 안다', () => {
    assert.equal(linkKindOf('https://www.canva.com/design/DAF1/abc/edit'), 'canva');
    assert.equal(linkKindOf('https://docs.google.com/presentation/d/1AbC/edit'), 'slides');
    assert.equal(linkKindOf('https://docs.google.com/spreadsheets/d/1AbC/edit'), 'sheets');
    assert.equal(linkKindOf('https://docs.google.com/document/d/1AbC/edit'), 'docs');
    assert.equal(linkKindOf('https://youtu.be/xyz'), 'youtube');
    assert.equal(linkKindOf('https://tuilders.com/apps/x'), 'tuilders');
    assert.equal(linkKindOf('https://padlet.com/t/abc'), 'padlet');
    assert.equal(linkKindOf('https://www.tkbell.co.kr/x'), 'thinkerbell');
    assert.equal(linkKindOf('https://example.com/x'), 'web');
    // 이름만 비슷한 가짜 주소는 그 종류로 보지 않는다
    assert.equal(linkKindOf('https://canva.com.evil.example/x'), 'web');
  });
  it('https 만 받고, 제목이 없으면 짓는다', () => {
    const ok = checkLinkItems([{ url: 'https://youtu.be/xyz' }, { url: 'https://docs.google.com/presentation/d/1AbC/edit', title: '도입 슬라이드', student: true }]);
    assert.ok(ok.ok);
    if (ok.ok) {
      assert.equal(ok.items[0]!.title, '유튜브 자료');
      assert.equal(ok.items[1]!.student, true);
      assert.notEqual(ok.items[0]!.id, ok.items[1]!.id);
    }
    for (const bad of ['javascript:alert(1)', 'http://example.com', 'data:text/html,x', 'https://user:pw@example.com', '']) assert.equal(checkLinkItems([{ url: bad }]).ok, false, bad);
    assert.equal(checkLinkItems(Array.from({ length: 31 }, () => ({ url: 'https://example.com' }))).ok, false);
  });
  it('학생에게는 보기 주소로', () => {
    assert.equal(studentUrl('https://docs.google.com/presentation/d/1AbC_-x/edit#slide=id.p'), 'https://docs.google.com/presentation/d/1AbC_-x/preview');
    assert.equal(studentUrl('https://www.canva.com/design/DAF1xyz/AbCd/edit?utm=1'), 'https://www.canva.com/design/DAF1xyz/AbCd/view');
    assert.equal(studentUrl('https://youtu.be/xyz'), 'https://youtu.be/xyz');
    // 검토에서 찾은 빈틈: 사용자 번호가 낀 주소, 설문 편집, 드라이브 파일, 캔바 짧은 경로
    assert.equal(studentUrl('https://docs.google.com/document/u/0/d/ABC/edit'), 'https://docs.google.com/document/d/ABC/preview');
    assert.equal(studentUrl('https://docs.google.com/forms/d/ABC/edit'), 'https://docs.google.com/forms/d/ABC/viewform');
    assert.equal(studentUrl('https://docs.google.com/forms/d/e/1FAIpQ/viewform'), 'https://docs.google.com/forms/d/e/1FAIpQ/viewform');
    assert.equal(studentUrl('https://drive.google.com/file/d/XYZ/edit?usp=sharing'), 'https://drive.google.com/file/d/XYZ/view');
    assert.equal(studentUrl('https://www.canva.com/design/DAF1/edit'), 'https://www.canva.com/design/DAF1/view');
    assert.equal(studentUrl('https://drive.google.com/file/d/XYZ/edit?resourcekey=0-abc'), 'https://drive.google.com/file/d/XYZ/view?resourcekey=0-abc');
  });
});

describe('수업 자료 동시 고침', () => {
  it('목록 서명은 키 차례와 상관없이 같고, 학생 보이기가 바뀌면 다르다', () => {
    const a = [{ id: 'l1', url: 'https://a.example/', title: 'A', kind: 'web', student: false }];
    const reordered = [{ student: false, kind: 'web', title: 'A', url: 'https://a.example/', id: 'l1' }];
    assert.equal(linksSignature(a), linksSignature(reordered));
    assert.notEqual(linksSignature(a), linksSignature([{ ...a[0], student: true }]));
    assert.equal(linksSignature(undefined), '');
  });
});

describe('틸더스 앱 추천', () => {
  const reply = (items: unknown[]) => ({
    result: {
      content: [
        { type: 'text', text: '추천 1개' },
        { type: 'text', text: JSON.stringify({ items }) },
      ],
    },
  });
  it('응답에서 아는 모양만 꺼낸다(https 아닌 주소는 버림)', () => {
    const apps = parseFindApps(
      reply([
        { slug: 'a', title: '수학 용사', tagline: '모험', url: 'https://mathhero.example', reasons: ['초5–6 수학 일치'], score: 63.4, health_status: 'up' },
        { slug: 'b', title: '나쁜 앱', url: 'javascript:alert(1)' },
        { slug: 'c', title: '쉬는 앱', url: 'https://down.example', health_status: 'down' },
      ]),
    );
    assert.deepEqual(
      apps.map((a) => [a.title, a.score, a.down]),
      [
        ['수학 용사', 63, false],
        ['쉬는 앱', 0, true],
      ],
    );
    assert.deepEqual(parseFindApps({ error: { code: -1 } }), []);
  });
  it('서버 판에서만, 시간이 지나면 알기 쉬운 말로', async () => {
    const svc = new TuildersService();
    const was = config.shareMode;
    try {
      config.shareMode = 'drive';
      await assert.rejects(svc.findApps('u1', { topic: '분수' }), /서버 판에서만/);
      config.shareMode = 'server';
      await assert.rejects(svc.findApps('u1', {}), /주제나 교과/);
      const slow: Fetch = async () => {
        throw new DOMException('timeout', 'TimeoutError');
      };
      await assert.rejects(svc.findApps('u1', { topic: '분수' }, slow), /연결하지 못했습니다/);
      let sent: any = null;
      const fake: Fetch = async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(reply([{ title: '두루마을', url: 'https://duru.example' }])), { status: 200 });
      };
      const apps = await svc.findApps('u2', { topic: '자석', grade: '3학년', subject: '과학' }, fake);
      assert.equal(apps[0]!.title, '두루마을');
      assert.equal(sent.params.name, 'find_apps_for_lesson');
      assert.deepEqual(sent.params.arguments, { limit: 6, topic: '자석', grade: '3학년', subject: '과학' });
    } finally {
      config.shareMode = was;
    }
  });
});

describe('즉석 퀴즈 규칙', () => {
  const spec = checkQuizSpec({
    title: '분수',
    questions: [
      { type: 'choice', text: '1/2+1/2', options: ['1', '2/4'], answer: '1' },
      { type: 'ox', text: '1/3>1/2', answer: 'x' },
      { type: 'short', text: '느낀 점' },
    ],
  });
  it('정답을 보기 글로 줘도 번호로, ox 는 대문자로', () => {
    assert.ok(spec.ok);
    if (!spec.ok) return;
    assert.equal(spec.spec.questions[0]!.answer, 0);
    assert.equal(spec.spec.questions[1]!.answer, 'X');
  });
  it('보기 밖 값은 버리고 채점·집계', () => {
    if (!spec.ok) return;
    const a = cleanAnswers(spec.spec, { q1: '0', q2: 'O', q3: '재밌다', q9: 'x' });
    assert.deepEqual(a, { q1: '0', q2: 'O', q3: '재밌다' });
    assert.equal(scoreOf(spec.spec, a), 1);
    assert.deepEqual(cleanAnswers(spec.spec, { q1: '5', q2: 'maybe' }), {});
    const t = tallyQuiz(spec.spec, [{ answers: a }, { answers: { q1: '1', q2: 'X' } }]);
    assert.deepEqual(t[0]!.counts, [1, 1]);
    assert.equal(t[1]!.correct, 1);
  });
  it('학생 페이지에 정답·해설이 없고, 글은 escape', () => {
    const page = renderQuizPage({
      title: '<b>퀴즈</b>',
      questions: [{ id: 'q1', type: 'choice', text: '<script>x</script>', options: ['"a"', 'b'], answer: 1, explanation: '해설비밀' }],
    });
    assert.doesNotMatch(page, /<script>x/);
    assert.match(page, /&lt;script&gt;/);
    assert.doesNotMatch(page, /해설비밀/);
    assert.doesNotMatch(page, /<script/);
  });
});

describe('구글 설문 퀴즈', () => {
  it('문항마다 정답·1점, O·X 는 보기 두 개, 단답은 채점 안 함', () => {
    const c = quizItem({ id: 'q1', type: 'choice', text: '1/2+1/2', options: ['1', '2/4'], answer: 0 }) as any;
    assert.equal(c.questionItem.question.choiceQuestion.type, 'RADIO');
    assert.deepEqual(c.questionItem.question.grading, { pointValue: 1, correctAnswers: { answers: [{ value: '1' }] } });
    const o = quizItem({ id: 'q2', type: 'ox', text: 'x', answer: 'X' }) as any;
    assert.deepEqual(o.questionItem.question.choiceQuestion.options, [{ value: 'O' }, { value: 'X' }]);
    assert.equal(o.questionItem.question.grading.correctAnswers.answers[0].value, 'X');
    const t = quizItem({ id: 'q3', type: 'short', text: '느낀 점' }) as any;
    assert.equal(t.questionItem.question.grading, undefined);
    assert.equal(t.questionItem.question.required, false);
  });
  it('퀴즈 모드 + 첫 문항 번호나 별명 + 누구나 응답', async () => {
    const calls: { url: string; body: any }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      if (url.endsWith('/v1/forms')) return new Response(JSON.stringify({ formId: 'F1', responderUri: 'https://docs.google.com/forms/d/e/R1/viewform' }));
      if (url.includes(':batchUpdate'))
        return new Response(
          JSON.stringify({
            form: {
              responderUri: 'https://docs.google.com/forms/d/e/R1/viewform',
              items: body.requests
                .filter((r: any) => r.createItem)
                .map((r: any, i: number) => ({ title: r.createItem.item.title, questionItem: { question: { questionId: `Q${i}`, ...r.createItem.item.questionItem.question } } })),
            },
          }),
        );
      return new Response('{}');
    }) as unknown as typeof fetch;
    const made = await createGoogleQuiz(
      'tok',
      {
        title: '분수',
        questions: [
          { id: 'q1', type: 'choice', text: 'a', options: ['1', '2'], answer: 0 },
          { id: 'q2', type: 'ox', text: 'b', answer: 'O' },
        ],
      },
      f,
    );
    const batch = calls.find((c) => c.url.includes(':batchUpdate'))!.body.requests;
    assert.deepEqual(batch[0], { updateSettings: { settings: { quizSettings: { isQuiz: true } }, updateMask: 'quizSettings.isQuiz' } });
    assert.equal(batch[1].createItem.item.title, '번호나 별명');
    assert.equal(made.name_qid, 'Q0');
    assert.deepEqual(made.qids, { q1: 'Q1', q2: 'Q2' });
    assert.equal(made.public_link, true);
    assert.ok(calls.some((c) => c.url.endsWith('/F1/permissions') && c.body.type === 'anyone'));
  });
  it('응답 받기 끄기에 실패하면 false', async () => {
    const no = (async () => new Response(JSON.stringify({ error: { message: 'x' } }), { status: 400 })) as unknown as typeof fetch;
    assert.equal(await setAcceptingResponses('tok', 'F1', false, no), false);
    const ok = (async () => new Response('{}')) as unknown as typeof fetch;
    assert.equal(await setAcceptingResponses('tok', 'F1', false, ok), true);
  });
});
