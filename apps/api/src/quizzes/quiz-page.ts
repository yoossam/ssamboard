import { QUIZ_NAME_MAX, QUIZ_SHORT_MAX, type QuizSpec } from '@jarvis/shared';

/*
 * 학생이 여는 퀴즈 페이지(/q/<열쇠>). 스크립트 없는 HTML 폼 하나 — 휴대폰·태블릿에서 크게 누르기 쉽게.
 * 정답·해설은 보내지 않는다. 모든 글은 escape 한다(AI·교사가 쓴 글이 HTML 로 해석되지 않게).
 * 응답 정책(CSP)은 quizzes.controller.ts 가 건다: 스크립트 없음, 폼은 같은 주소로만.
 */

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STYLE = `
*{box-sizing:border-box}
body{margin:0;background:#f0f0e0;color:#3e481d;font-family:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;line-height:1.6;word-break:keep-all;overflow-wrap:anywhere;font-size:18px}
main{max-width:640px;margin:0 auto;padding:16px 14px 40px}
h1{font-size:1.35rem;margin:6px 0 14px}
.card{background:#fff;border:1px solid #dcdcc4;border-radius:16px;padding:16px;margin:0 0 14px}
.q{font-weight:700;margin:0 0 10px}
.num{display:inline-block;min-width:1.8em;color:#6d5bd0}
label.opt{display:flex;align-items:center;gap:12px;min-height:52px;padding:10px 12px;margin:6px 0;border:2px solid #e3e3cf;border-radius:12px;cursor:pointer}
label.opt:has(input:checked){border-color:#6d5bd0;background:#f2efff}
input[type=radio]{width:24px;height:24px;flex:none;accent-color:#6d5bd0}
input[type=text]{width:100%;min-height:52px;font-size:18px;padding:10px 12px;border:2px solid #dcdcc4;border-radius:12px}
.ox{display:flex;gap:10px}.ox label.opt{flex:1;justify-content:center;font-size:1.6rem;font-weight:800}
button{width:100%;min-height:58px;font-size:1.15rem;font-weight:800;color:#fff;background:#6d5bd0;border:0;border-radius:14px;cursor:pointer}
.meta{color:#77805a;font-size:.9rem}
.warn{background:#fff6d6;border-color:#f0d78a}
.err{background:#ffe9e6;border-color:#f1b2a8}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.big{font-size:3rem;text-align:center;margin:8px 0}
`;

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;

export function renderQuizPage(spec: QuizSpec, opts: { already?: boolean; error?: string; name?: string; answers?: Record<string, string> } = {}): string {
  const qs = spec.questions
    .map((q, i) => {
      // 문항 id 는 우리가 매기지만(q1…) 가져온 자료에서 올 수도 있어 속성에도 escape(코덱스 검토)
      const id = esc(q.id);
      const was = opts.answers?.[q.id];
      const on = (v: string) => (was === v ? ' checked' : '');
      const head = `<p class="q"><span class="num">${i + 1}.</span>${esc(q.text)}</p>`;
      if (q.type === 'choice')
        return `<div class="card">${head}${(q.options ?? [])
          .map((o, j) => `<label class="opt"><input type="radio" name="${id}" value="${j}"${on(String(j))}><span>${j + 1}) ${esc(o)}</span></label>`)
          .join('')}</div>`;
      if (q.type === 'ox')
        return `<div class="card">${head}<div class="ox"><label class="opt"><input type="radio" name="${id}" value="O"${on('O')}><span>O</span></label><label class="opt"><input type="radio" name="${id}" value="X"${on('X')}><span>X</span></label></div></div>`;
      return `<div class="card">${head}<input type="text" name="${id}" maxlength="${QUIZ_SHORT_MAX}" autocomplete="off" value="${esc(was ?? '')}"></div>`;
    })
    .join('');
  return page(
    spec.title,
    `<h1>${esc(spec.title)}</h1>` +
      (opts.error ? `<div class="card err">${esc(opts.error)}</div>` : '') +
      (opts.already ? `<div class="card warn">이 기기에서 이미 한 번 냈어요. 다른 친구라면 그대로 풀어서 내면 됩니다.</div>` : '') +
      `<form method="post" autocomplete="off">` +
      `<div class="card"><p class="q">번호나 별명</p><input type="text" name="name" maxlength="${QUIZ_NAME_MAX}" required value="${esc(opts.name ?? '')}" placeholder="예: 12번"><p class="meta">이름 대신 번호나 별명을 적어요.</p></div>` +
      `<div class="hp" aria-hidden="true"><input type="text" name="homepage" tabindex="-1"></div>` +
      qs +
      `<button type="submit">제출하기</button></form>`,
  );
}

export function renderQuizDone(title: string): string {
  return page(title, `<div class="card"><p class="big">✓</p><h1 style="text-align:center">제출했어요</h1><p class="meta" style="text-align:center">선생님 화면을 보세요.</p></div>`);
}

export function renderQuizMessage(title: string, message: string): string {
  return page(title, `<div class="card"><h1>${esc(title)}</h1><p>${esc(message)}</p></div>`);
}
