/*
 * 즉석 퀴즈(2026-11-28 수업 보드): 퀴즈 블록과 크게 보기(교실 TV) 창.
 * 막대는 앱이 직접 그린다(빠르고 숫자가 정확 — 세 모델 합의). AI 는 [AI 정리]로 해석만 한다.
 * TV 에는 개인별 답이 아니라 문항별 집계를 보인다. 응답 목록(번호·별명)은 교사가 펼칠 때만.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { answerLabel, type BlockDto, type QuizQuestionStat, type QuizStats } from '@jarvis/shared';
import { QrCode } from '../components/QrCode';
import { Button, ButtonRow, Empty, Notice, Sheet } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { queryClient } from '../lib/data';
import { useApp } from '../lib/store';

const quizKey = (id: string) => ['quiz', id] as const;

/** 열려 있는 동안 3초마다 새로 읽는다(화면이 안 보이면 멈춘다). 마감되면 그친다. */
export function useQuizStats(id: string | undefined) {
  return useQuery({
    queryKey: quizKey(id ?? ''),
    queryFn: () => api.get<QuizStats>(`/quizzes/${id}/stats`),
    enabled: !!id,
    // 쌤보드 퀴즈만 저절로 새로 읽는다. 구글 설문은 [결과 불러오기]로(구글 한도 — 세 모델 합의)
    refetchInterval: (q) => (q.state.data?.quiz.status === 'open' && q.state.data.quiz.source === 'board' ? 3000 : false),
  });
}

async function act(id: string, path: string, method: 'post' | 'del' = 'post', body?: unknown): Promise<void> {
  try {
    const out = await (method === 'post' ? api.post<{ note?: string; added?: number }>(`/quizzes/${id}/${path}`, body) : api.del(`/quizzes/${id}/${path}`));
    const r = (out ?? {}) as { note?: string; added?: number };
    if (r.note) useApp.getState().toast(r.note, 'error');
    if (path === 'sync') useApp.getState().toast(r.added ? `새 응답 ${r.added}개를 읽었습니다` : '새 응답이 없습니다');
    await queryClient.invalidateQueries({ queryKey: quizKey(id) });
  } catch (e) {
    useApp.getState().toast(errorMessage(e), 'error');
  }
}

function copy(url: string) {
  const toast = useApp.getState().toast;
  void navigator.clipboard?.writeText(url).then(
    () => toast('학생 주소를 복사했습니다'),
    () => window.prompt('이 주소를 복사하세요', url),
  );
}

export function askAiSummary(stats: QuizStats) {
  useApp.getState().openAi(`퀴즈 "${stats.quiz.title}" 결과를 정리해 줘(quiz_id: ${stats.quiz.id}). 많이 틀린 문항, 자주 고른 오답, 다시 설명할 점을 짧게.`);
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

/** 문항 하나의 막대: 보기마다 고른 수, 정답은 진하게 */
function QuestionBars({ s, index, big }: { s: QuizQuestionStat; index: number; big?: boolean }) {
  const max = Math.max(1, ...s.counts);
  const right = (i: number) => (s.type === 'choice' ? s.answer === i : s.type === 'ox' ? s.options[i] === s.answer : false);
  return (
    <div className={`rounded-xl border bg-card ${big ? 'p-4' : 'p-2.5'}`}>
      <div className="flex items-start gap-2">
        <p className={`min-w-0 flex-1 font-bold ${big ? 'text-lg' : 'text-sm'}`}>
          {index + 1}. {s.text}
        </p>
        {s.correct !== null && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 font-bold ${big ? 'text-base' : 'text-xs'} ${pct(s.correct, s.answered) < 50 ? 'bg-dangertint text-danger' : 'bg-tint text-accent'}`}>
            정답 {pct(s.correct, s.answered)}%
          </span>
        )}
      </div>
      {s.type === 'short' ? (
        <ul className={`mt-1.5 space-y-0.5 ${big ? 'text-base' : 'text-xs'}`}>
          {s.top.length === 0 && <li className="text-sub">아직 답이 없습니다</li>}
          {s.top.map((t) => (
            <li key={t.text} className="flex justify-between gap-2">
              <span className="truncate">{t.text}</span>
              <span className="shrink-0 text-sub">{t.n}명</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1.5 space-y-1">
          {s.options.map((o, i) => (
            <div key={i} className={`flex items-center gap-2 ${big ? 'text-base' : 'text-xs'}`}>
              <span className={`w-[38%] min-w-0 shrink-0 truncate ${right(i) ? 'font-bold text-accent' : ''}`} title={o}>
                {s.type === 'choice' ? `${i + 1}) ` : ''}
                {o}
                {right(i) ? ' ✓' : ''}
              </span>
              <span className={`relative flex-1 overflow-hidden rounded-full bg-ground ${big ? 'h-5' : 'h-3'}`}>
                <span className={`absolute inset-y-0 left-0 rounded-full ${right(i) ? 'bg-accent' : 'bg-field'}`} style={{ width: `${(s.counts[i]! / max) * 100}%` }} />
              </span>
              <span className="w-10 shrink-0 text-right text-sub">{s.counts[i]}명</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 몇 시 기준인지(2026-11-28 세 모델 토론 3번) — 쌤보드 퀴즈는 마지막으로 불러온 때 */
const hm = (t: string | number) => new Date(t).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });

function StatusLine({ stats, big, asOf }: { stats: QuizStats; big?: boolean; asOf?: number }) {
  const open = stats.quiz.status === 'open';
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${big ? 'text-lg' : 'text-sm'}`}>
      <span className={`rounded-full px-2.5 py-0.5 font-bold ${open ? 'bg-tint text-accent' : 'bg-ground text-sub'}`}>{open ? '받는 중' : '마감'}</span>
      <span className="font-bold">응답 {stats.total}명</span>
      {stats.quiz.source === 'google' && <span className={`text-sub ${big ? 'text-base' : 'text-xs'}`}>구글 설문 · {stats.quiz.synced_at ? `${hm(stats.quiz.synced_at)} 기준` : '아직 안 읽음'}</span>}
      {stats.quiz.source !== 'google' && asOf ? <span className={`text-sub ${big ? 'text-base' : 'text-xs'}`}>{hm(asOf)} 기준</span> : null}
      {stats.avg_score !== null && !open && (
        <span className="text-sub">
          평균 {stats.avg_score} / {stats.graded}
        </span>
      )}
    </div>
  );
}

/** 보드 위 퀴즈 블록 */
export function QuizBody({ block }: { block: BlockDto }) {
  const id = typeof block.config.quiz_id === 'string' ? block.config.quiz_id : undefined;
  const { data: stats, error, isLoading, dataUpdatedAt } = useQuizStats(id);
  const open = useApp((s) => s.open);
  if (!id) return <Empty>퀴즈가 없습니다</Empty>;
  if (isLoading) return <Empty>불러오는 중입니다</Empty>;
  if (!stats) return <Empty>{error ? errorMessage(error) : '퀴즈를 찾을 수 없습니다'}</Empty>;
  const live = stats.quiz.status === 'open';
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-rule p-2.5">
        <StatusLine stats={stats} asOf={dataUpdatedAt} />
        {live && (
          <button type="button" onClick={() => copy(stats.quiz.url)} className="block w-full truncate rounded-lg bg-ground px-2.5 py-1.5 text-left font-mono text-xs" title="눌러서 복사">
            {stats.quiz.url}
          </button>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button icon="expand" tone="primary" className="h-9! px-3!" onClick={() => open({ kind: 'quiz', quizId: id })}>
            크게 보기
          </Button>
          {stats.quiz.source === 'google' && (
            <Button icon="refresh" className="h-9! px-3!" onClick={() => void act(id, 'sync')}>
              결과 불러오기
            </Button>
          )}
          {live ? (
            <Button icon="lock" className="h-9! px-3!" onClick={() => void act(id, 'close')}>
              마감
            </Button>
          ) : (
            <Button icon="sparkle" className="h-9! px-3!" disabled={stats.total === 0} onClick={() => askAiSummary(stats)}>
              AI 정리
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2.5">
        <Results key={stats.quiz.status} stats={stats} />
      </div>
    </div>
  );
}

/**
 * 문항별 막대. 받는 중에는 감춘다 — 보드나 크게 보기가 교실 TV 에 떠 있으면 학생이 정답(✓·정답률)을 보고 고친다.
 * 교사가 [결과 미리 보기]를 누르면 이 화면에서만 잠깐 연다(마감하면 저절로 보인다).
 */
function Results({ stats, big }: { stats: QuizStats; big?: boolean }) {
  const [peek, setPeek] = useState(false);
  if (stats.quiz.status === 'open' && !peek)
    return (
      <div className={`rounded-xl border border-dashed p-3 text-center text-sub ${big ? 'text-base' : 'text-sm'}`}>
        <p>답을 받는 중이라 결과를 가려 두었습니다. 마감하면 보입니다.</p>
        <button type="button" className="mt-2 rounded-full border bg-card px-3 py-1 text-xs" onClick={() => setPeek(true)}>
          결과 미리 보기(TV 에 떠 있으면 학생도 봅니다)
        </button>
      </div>
    );
  return (
    <div className={big ? 'grid gap-3 md:grid-cols-2' : 'space-y-2'}>
      {stats.questions.map((s, i) => (
        <QuestionBars key={s.id} s={s} index={i} big={big} />
      ))}
    </div>
  );
}

/** 크게 보기 — 교실 TV 용. 위: 학생 주소, 아래: 문항별 막대. 교사 도구(링크 바꾸기·응답 숨기기·지우기)는 접어 둔다. */
export function QuizScreen({ quizId }: { quizId: string }) {
  const close = useApp((s) => s.close);
  const { data: stats, error, dataUpdatedAt } = useQuizStats(quizId);
  const [tools, setTools] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  if (!stats)
    return (
      <Sheet title="퀴즈" icon="tasks" onClose={close} width={960}>
        <Empty>{error ? errorMessage(error) : '불러오는 중입니다'}</Empty>
      </Sheet>
    );
  const live = stats.quiz.status === 'open';
  return (
    <Sheet title={stats.quiz.title} icon="tasks" onClose={close} width={1100}>
      <div className="space-y-4">
        {live && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-accent bg-tint p-4 text-center md:flex-row md:text-left">
            <QrCode text={stats.quiz.url} size={260} label="학생용 퀴즈 QR 코드" />
            <div className="min-w-0 flex-1">
              <p className="text-base text-sub">
                {stats.quiz.source === 'google' ? '구글 설문 퀴즈 — QR 을 찍거나, 주소를 복사해 학급 게시판에 붙이세요' : '휴대폰 카메라로 QR 을 찍거나 주소창에 입력하세요'}
              </p>
              <p className={`mt-1 font-mono font-bold break-all text-accent ${stats.quiz.source === 'google' ? 'text-base' : 'text-2xl sm:text-3xl'}`}>{stats.quiz.url.replace(/^https?:\/\//, '')}</p>
              {!stats.quiz.public_link && (
                <p className="mt-2 text-sm font-bold text-danger">링크만으로 응답하게 여는 데 실패했습니다(학교 계정 정책일 수 있음). 구글 설문지의 게시 설정에서 응답자를 확인하세요.</p>
              )}
              <div className="mt-3 max-w-md md:mx-0 mx-auto">
                <ButtonRow>
                  <Button icon="paste" onClick={() => copy(stats.quiz.url)}>
                    주소 복사
                  </Button>
                  <Button icon="lock" tone="primary" onClick={() => void act(quizId, 'close')}>
                    마감하고 결과 보기
                  </Button>
                </ButtonRow>
                {stats.quiz.source === 'google' && (
                  <div className="mt-2">
                    <Button icon="refresh" className="w-full" onClick={() => void act(quizId, 'sync')}>
                      결과 불러오기(마감 전 중간 확인)
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <StatusLine stats={stats} big asOf={dataUpdatedAt} />
        <Results key={stats.quiz.status} stats={stats} big />
        {!live && (
          <ButtonRow>
            <Button icon="sparkle" tone="primary" disabled={stats.total === 0} onClick={() => askAiSummary(stats)}>
              AI 정리
            </Button>
            <Button icon="refresh" onClick={() => void act(quizId, 'open')}>
              다시 받기
            </Button>
          </ButtonRow>
        )}
        {!live && stats.quiz.spec.questions.some((q) => q.explanation) && (
          <details className="rounded-xl border bg-card p-3">
            <summary className="cursor-pointer font-bold">정답·해설</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {stats.quiz.spec.questions.map((q) => (
                <li key={q.id}>
                  <b>{answerLabel(q)}</b>
                  {q.explanation ? ` — ${q.explanation}` : ''}
                </li>
              ))}
            </ol>
          </details>
        )}
        <details className="rounded-xl border bg-card p-3" open={tools} onToggle={(e) => setTools((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-sm font-bold">응답 관리(교사만)</summary>
          {tools && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-sub">
                장난 응답은 숨기면 집계에서 빠집니다. 링크를 바꾸면 옛 주소로는 더 들어오지 못합니다. 번호·별명도 반에서는 누구인지 알 수 있으니 화면에 띄울 때 조심하세요.
              </p>
              <ul className="max-h-60 divide-y divide-rule overflow-auto rounded-lg border text-sm">
                {stats.responses.length === 0 && <li className="p-2 text-sub">아직 응답이 없습니다</li>}
                {stats.responses.map((r) => (
                  <li key={r.id} className={`flex items-center gap-2 p-2 ${r.hidden ? 'opacity-50' : ''}`}>
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="text-sub">
                      {r.score}/{stats.graded}
                    </span>
                    <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => void act(quizId, `responses/${r.id}/hide`, 'post', { hidden: !r.hidden })}>
                      {r.hidden ? '다시 보이기' : '숨기기'}
                    </button>
                  </li>
                ))}
              </ul>
              {stats.quiz.source === 'google' ? (
                // 구글 설문의 응답은 구글에 있다 — 여기서 지워도 다시 읽으면 돌아온다. 숨기기만 쌤보드에 남는다.
                <div className="space-y-1.5">
                  <p className="text-xs text-sub">구글 설문 퀴즈의 원본 응답·링크는 구글 설문지(응답 탭)에서 관리합니다. 아래는 쌤보드에 읽어 온 사본만 지웁니다(다시 읽어도 돌아오지 않음).</p>
                  <Button icon="trash" tone="danger" className="w-full" onClick={() => (confirmClear ? (setConfirmClear(false), void act(quizId, 'responses', 'del')) : setConfirmClear(true))}>
                    {confirmClear ? '정말 쌤보드 사본 지우기' : '쌤보드 사본 지우기'}
                  </Button>
                </div>
              ) : (
                <ButtonRow>
                  <Button icon="refresh" onClick={() => void act(quizId, 'rotate')}>
                    링크 바꾸기
                  </Button>
                  <Button icon="trash" tone="danger" onClick={() => (confirmClear ? (setConfirmClear(false), void act(quizId, 'responses', 'del')) : setConfirmClear(true))}>
                    {confirmClear ? '정말 모두 지우기' : '응답 모두 지우기'}
                  </Button>
                </ButtonRow>
              )}
            </div>
          )}
        </details>
        {stats.quiz.status === 'open' && stats.total >= stats.quiz.max_responses && <Notice tone="danger">응답이 꽉 찼습니다({stats.quiz.max_responses}명).</Notice>}
      </div>
    </Sheet>
  );
}

/** 승인한 계획에서 방금 만든 퀴즈를 찾아 크게 연다(요청 → 미리보기 → [퀴즈 시작] 한 번 — 세 모델 합의) */
export function openCreatedQuiz(touched: { entity: string; id: string }[] | undefined): boolean {
  const id = touched?.find((t) => t.entity === 'quizzes')?.id;
  if (!id) return false;
  const app = useApp.getState();
  app.closeAi();
  app.open({ kind: 'quiz', quizId: id });
  return true;
}
