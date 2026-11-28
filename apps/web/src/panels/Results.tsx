import { openCreatedQuiz } from '../board/quiz';
/*
 * 처리 결과함(2026-11-28 세 모델 UX 토론 A) — "결과 처리 확인"을 한 곳에서.
 * AI 가 처리한 일을 최근 14일 동안 모아, 상태(승인 대기·마무리 중·완료·되돌림)와 할 수 있는 동작만 보인다.
 */
import { useState } from 'react';
import { followUps, type CommandDto } from '@jarvis/shared';
import { downloadFile, StepDetail } from '../ai/AiWindow';
import { Icon } from '../components/Icon';
import { Button, Empty, Notice, Sheet, Tag } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { refresh, useCommands } from '../lib/data';
import { ago, shortWhen } from '../lib/format';
import { showOnBoard } from '../lib/results';
import { useApp } from '../lib/store';

const STATE: Record<CommandDto['status'], { label: string; tone: 'neutral' | 'accent' | 'danger' }> = {
  proposed: { label: '승인 대기', tone: 'accent' },
  applying: { label: '마무리 중', tone: 'neutral' },
  applied: { label: '완료', tone: 'neutral' },
  undone: { label: '되돌림', tone: 'neutral' },
  cancelled: { label: '취소', tone: 'neutral' },
};

/** 되돌리기 범위 — 완전 원상복구로 오해하지 않게(두 모델이 짚은 위험) */
export const UNDO_SCOPE =
  '되돌리기는 보드 안의 변경(할 일·일정·블록·표·메뉴·기억)을 되돌리고 이 처리로 연 공유 링크를 끕니다. 내려받은 파일, 구글에 만든 설문·문서는 그대로 남습니다. 적용한 뒤 직접 고친 항목은 덮어쓰지 않고 건너뜁니다.';

async function copy(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    useApp.getState().toast('링크를 복사했습니다');
  } catch {
    // 복사가 막힌 브라우저 — 주소를 보여 주고 직접 복사하게
    window.prompt('이 링크를 복사하세요', url);
  }
}

const FOLLOW_ICON = { approve: 'check', download: 'download', snapshot: 'link', external: 'sheet', retry: 'sparkle' } as const;

/** 남은 일 줄 — 다시 시키기는 AI 창으로 */
function FollowUpList({ cmd }: { cmd: CommandDto }) {
  const openAi = useApp((s) => s.openAi);
  const close = useApp((s) => s.close);
  const items = followUps(cmd).filter((f) => f.kind !== 'approve');
  if (items.length === 0) return null;
  return (
    <div data-followups className="mt-2 rounded-lg border border-accent/40 bg-tint px-2.5 py-2">
      <p className="text-xs font-bold text-accent">남은 일</p>
      <ul className="mt-1 space-y-1">
        {items.map((f, i) => (
          <li key={i} className="flex items-start gap-1.5 text-sm">
            <Icon name={FOLLOW_ICON[f.kind]} size={14} className="mt-0.5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">{f.text}</span>
            {f.prompt && (
              <button
                type="button"
                className="shrink-0 text-xs font-bold text-accent hover:underline"
                onClick={() => {
                  close();
                  openAi(f.prompt);
                }}
              >
                다시 시키기 →
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultCard({ cmd }: { cmd: CommandDto }) {
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const state = STATE[cmd.status];
  const failed = cmd.skipped ?? [];
  const deletes = cmd.steps.filter((s) => s.tool === 'delete_block').length;
  const when = cmd.applied_at ?? cmd.created_at;

  const run = async (action: 'apply' | 'undo' | 'cancel') => {
    if (action === 'apply' && deletes > 0 && !confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try {
      const next = await api.post<CommandDto>(`/ai/commands/${cmd.id}/${action}`, action === 'apply' ? { edits: {} } : {});
      await refresh();
      if (action === 'apply' && openCreatedQuiz(next.touched)) return;
      if (action === 'apply') {
        const n = showOnBoard(next, false);
        toast(n > 0 ? `반영했습니다 · 바뀐 블록 ${n}개를 표시했습니다` : '반영했습니다');
      }
      if (action === 'undo') toast((next.skipped?.length ?? 0) > 0 ? `되돌렸습니다 · ${next.skipped!.length}건은 건너뜀` : '되돌렸습니다');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <article data-result={cmd.id} className={`rounded-xl border bg-card p-3 ${cmd.status === 'proposed' ? 'border-accent/50' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">
            {cmd.steps[0]?.title ?? '변경'}
            {cmd.steps.length > 1 ? ` 외 ${cmd.steps.length - 1}건` : ''}
          </p>
          <p className="mt-0.5 text-xs text-sub">{when ? `${ago(when)} · ${shortWhen(when)}` : ''}</p>
        </div>
        <Tag tone={failed.length > 0 && cmd.status !== 'undone' ? 'danger' : state.tone} className="shrink-0">
          {failed.length > 0 && cmd.status === 'applied' ? '완료 · 일부 못 함' : state.label}
        </Tag>
      </div>
      {cmd.status === 'proposed' ? (
        // 승인 전에는 단계마다 무엇을 바꾸는지 모두 보인다(공유할 블록·칸·기간 등 — 코덱스 재검토). 표 미리 보기 고치기는 AI 창에서.
        <div className="mt-2 space-y-1.5">
          {cmd.steps.map((s) => (
            <div key={s.index} className="rounded-lg bg-ground px-2.5 py-1.5">
              <p className="text-sm font-bold">{s.title}</p>
              <StepDetail detail={s.detail} />
              {s.preview && <p className="text-xs text-sub">표 미리 보기(이름·칸)를 고치려면 AI 창의 같은 계획에서 고친 뒤 승인하세요.</p>}
            </div>
          ))}
        </div>
      ) : (
        cmd.steps.length > 1 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
            {cmd.steps.map((s) => (
              <li key={s.index}>{s.title}</li>
            ))}
          </ul>
        )
      )}
      {failed.length > 0 && cmd.status !== 'proposed' && (
        <div className="mt-2">
          <Notice tone={cmd.status === 'undone' ? 'info' : 'danger'}>
            {cmd.status === 'undone' ? '건너뛴 것' : '하지 못한 것'}: {failed.join(', ')}
          </Notice>
        </div>
      )}
      {/* 완료 뒤 남은 일(2026-11-28 세 모델 토론 1번) — 앱에서 끝난 것과 업무가 끝난 것이 다른 곳 */}
      <FollowUpList cmd={cmd} />
      {/* 결과물 — 파일·공유 링크 */}
      {cmd.status !== 'proposed' && (cmd.files?.length ?? 0) + (cmd.shares?.length ?? 0) > 0 && (
        <div className="mt-2 space-y-1.5">
          {cmd.files?.map((f) => (
            <div key={f.id} className="flex min-h-11 items-center gap-2 rounded-lg bg-ground px-2">
              <Icon name="download" size={18} className="shrink-0 text-sub" />
              <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
              {f.gone || cmd.status !== 'applied' ? (
                <span className="shrink-0 text-xs text-sub">{cmd.status !== 'applied' ? '되돌림' : '받을 기간 지남'}</span>
              ) : (
                <Button icon="download" tone={f.downloaded ? undefined : 'primary'} onClick={() => void downloadFile(f.id).then(() => refresh('commands'))}>
                  {f.downloaded ? '다시 받기' : '받기'}
                  {f.expires_at ? ` · ${shortWhen(f.expires_at)}까지` : ''}
                </Button>
              )}
            </div>
          ))}
          {cmd.shares?.map((s) => (
            <div key={s.id} className="flex min-h-11 items-center gap-2 rounded-lg bg-ground px-2">
              <Icon name="link" size={18} className="shrink-0 text-sub" />
              <span className="min-w-0 flex-1 truncate text-sm">
                {s.title}
                {s.snapshot && <span className="ml-1 text-xs text-sub">· 만든 때 사본</span>}
              </span>
              {s.revoked ? (
                <span className="shrink-0 text-xs text-sub">링크 꺼짐</span>
              ) : (
                <Button icon="link" onClick={() => void copy(s.url)}>
                  링크 복사
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {confirmDelete && (
        <div className="mt-2">
          <Notice tone="danger">삭제 {deletes}건이 들어 있습니다. 승인하면 휴지통으로 보내고, 30일 안에 복구할 수 있습니다.</Notice>
        </div>
      )}
      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        {cmd.status === 'proposed' && (
          <>
            <Button icon="close" disabled={busy} onClick={() => void run('cancel')}>
              취소
            </Button>
            <Button icon={confirmDelete ? 'trash' : 'check'} tone={confirmDelete ? 'danger' : 'primary'} disabled={busy} onClick={() => void run('apply')}>
              {confirmDelete ? '삭제 포함 승인' : '승인'}
            </Button>
          </>
        )}
        {(cmd.status === 'applied' || cmd.status === 'applying') && (cmd.touched?.length ?? 0) > 0 && (
          <Button
            icon="grid"
            onClick={() => {
              if (showOnBoard(cmd) === 0) toast('보드에 보이는 블록이 없습니다(표·메뉴 목록에서 확인하세요)', 'error');
            }}
          >
            보드에서 보기
          </Button>
        )}
        {cmd.undoable && (
          <Button icon="undo" disabled={busy} onClick={() => void run('undo')}>
            되돌리기
          </Button>
        )}
      </div>
    </article>
  );
}

export function ResultsPanel() {
  const close = useApp((s) => s.close);
  const { data, isLoading, error } = useCommands();
  const list = data ?? [];
  const waiting = list.filter((c) => c.status === 'proposed').length;
  const pending = list.filter((c) => c.status !== 'proposed' && followUps(c).length > 0).length;
  const [onlyPending, setOnlyPending] = useState(false);
  const shown = onlyPending ? list.filter((c) => followUps(c).length > 0) : list;
  return (
    <Sheet title="처리 결과" icon="archive" onClose={close} tall>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-sm text-sub">
            AI 에게 맡긴 일의 결과를 최근 14일 동안 모았습니다.{waiting > 0 ? ` 승인을 기다리는 것이 ${waiting}건 있습니다.` : ''}
            {pending > 0 ? ` 끝낸 일 가운데 ${pending}건에 남은 일이 있어요.` : ''}
          </p>
          {(pending > 0 || waiting > 0) && (
            <Button icon={onlyPending ? 'close' : 'check'} onClick={() => setOnlyPending((v) => !v)}>
              {onlyPending ? '전부 보기' : '남은 일만'}
            </Button>
          )}
        </div>
        {error ? (
          <Notice tone="danger">{errorMessage(error)}</Notice>
        ) : list.length === 0 ? (
          <Empty>{isLoading ? '불러오는 중입니다' : '아직 처리한 일이 없습니다. 아래 입력줄에 할 일을 적어 보세요.'}</Empty>
        ) : (
          shown.map((c) => <ResultCard key={c.id} cmd={c} />)
        )}
        {list.some((c) => c.undoable) && <p className="text-xs leading-relaxed text-sub">{UNDO_SCOPE} 되돌리기는 가장 최근에 처리한 것부터 차례로 됩니다.</p>}
      </div>
    </Sheet>
  );
}
