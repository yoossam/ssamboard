/*
 * 공유 링크 창(2026-11-28): 블록 하나를 로그인 없이 보는 읽기 전용 링크로. 서버 트랙은 늘 지금 내용(/s/…),
 * 구글 드라이브 트랙은 구글 문서(만든 때 내용, '다시 올리기'). 서버 쪽은 apps/api/src/shares.
 */
import { useEffect, useState } from 'react';
import { SHARE_DAYS, SHAREABLE_BLOCKS, type ShareDto } from '@jarvis/shared';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../components/Icon';
import { Button, ButtonRow, Empty, Field, Notice, Sheet, Tag, inputClass } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useBoard, useTable } from '../lib/data';
import { LOCAL_TRACK } from '../lib/edition';
import { shortWhen } from '../lib/format';
import { useApp } from '../lib/store';

const DAY_LABEL: Record<number, string> = {
  7: '7일',
  30: '30일',
  90: '90일',
  0: '기간 없음',
};

export function SharePanel({ blockId }: { blockId: string }) {
  const { close, toast } = useApp.getState();
  const { data: board } = useBoard();
  const block = board?.blocks.find((b) => b.id === blockId);
  const { table } = useTable(block?.type === 'table' ? block.source_table_id : null);
  const shares = useQuery({
    queryKey: ['shares', blockId],
    queryFn: () => api.get<ShareDto[]>(`/shares?block_id=${blockId}`),
  });
  const [title, setTitle] = useState('');
  const [days, setDays] = useState<number>(30);
  const [hidden, setHidden] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<ShareDto | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // 제목·기간·숨길 칸을 바꾸면 이전 미리 보기는 맞지 않으니 지운다(코덱스 재확인)
  useEffect(() => setPreview(null), [title, days, hidden]);

  if (!block) return null;
  const shareable = SHAREABLE_BLOCKS.includes(block.type);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await shares.refetch();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const copy = (url: string) => void navigator.clipboard.writeText(url).then(() => toast('링크를 복사했습니다'));
  const create = () =>
    run(async () => {
      const s = await api.post<ShareDto>('/shares', {
        block_id: block.id,
        title: title.trim() || block.title,
        days: LOCAL_TRACK ? 0 : days,
        options: hidden.length ? { hide_columns: hidden } : {},
      });
      setMade(s);
      copy(s.url);
    });
  const showPreview = () =>
    run(async () => {
      const r = await api.post<{ html: string }>('/shares/preview', {
        block_id: block.id,
        title: title.trim() || block.title,
        days: LOCAL_TRACK ? 0 : days,
        options: hidden.length ? { hide_columns: hidden } : {},
      });
      setPreview(r.html);
    });
  const list = shares.data ?? [];

  return (
    <Sheet title={`공유 링크 · ${block.title}`} icon="link" onClose={close} width={640}>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-sub">
          {LOCAL_TRACK
            ? '내 구글 드라이브에 구글 문서로 만들고 "링크가 있는 사람 보기"로 엽니다. 만든 때의 내용이 보이고, 바뀐 내용은 "다시 올리기"로 반영합니다. (설정 → 연결에서 구글 연결이 필요합니다)'
            : '링크를 아는 사람은 로그인 없이 이 블록을 볼 수 있습니다(읽기만). 볼 때마다 지금 내용이 보입니다.'}
        </p>

        {!shareable ? (
          <Notice tone="danger">이 블록은 공유할 수 없습니다. 할 일·일정·표·메모·AI 결과 블록만 공유됩니다.</Notice>
        ) : made ? (
          <div className="space-y-2 rounded-xl border border-accent bg-tint p-3">
            <p className="text-sm font-bold">링크를 만들고 복사했습니다</p>
            <div className="flex items-center gap-2">
              <input className={`${inputClass} h-10 font-mono text-xs`} readOnly value={made.url} onFocus={(e) => e.target.select()} />
              <Button icon="paste" className="shrink-0" onClick={() => copy(made.url)}>
                복사
              </Button>
            </div>
            <ButtonRow>
              <Button icon="next" onClick={() => window.open(made.url, '_blank', 'noopener,noreferrer')}>
                열어 보기
              </Button>
              <Button icon="plus" onClick={() => setMade(null)}>
                링크 하나 더
              </Button>
            </ButtonRow>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border p-3">
            <div className={`grid gap-2 ${LOCAL_TRACK ? '' : 'grid-cols-[1fr_auto]'}`}>
              <Field label="받는 사람에게 보일 제목">
                <input className={inputClass} placeholder={block.title} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              {!LOCAL_TRACK && (
                <Field label="기간">
                  <select className={inputClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    {SHARE_DAYS.map((d) => (
                      <option key={d} value={d}>
                        {DAY_LABEL[d]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            {table && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-sub">숨길 칸 — 전화번호·주소 같은 개인정보 칸은 숨기세요</p>
                <div className="flex flex-wrap gap-1.5">
                  {table.schema.columns.map((c) => {
                    const on = hidden.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setHidden(on ? hidden.filter((x) => x !== c.id) : [...hidden, c.id])}
                        className={`h-8 rounded-full border px-3 text-sm transition ${on ? 'border-danger bg-dangertint text-danger line-through' : 'hover:bg-tint'}`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {table && <p className="-mt-1 text-xs text-sub">지금 보이는 칸만 공유됩니다. 나중에 표에 더한 칸은 이 링크에 나오지 않습니다.</p>}
            {block.type === 'ai_result' && <p className="-mt-1 text-xs text-sub">AI 결과는 글과 결과표가 그대로 공개됩니다. 미리 보기로 확인하세요.</p>}
            <Notice>
              학생 이름 같은 개인정보가 들어 있으면 받는 사람이 봐도 되는지 확인하세요. 주민등록번호·카드번호 모양은 자동으로 가립니다.
              {LOCAL_TRACK && ' 구글 문서 링크에는 기간을 둘 수 없어, 그만 보이려면 끄기를 누르세요.'}
            </Notice>
            {preview && (
              <div className="overflow-hidden rounded-xl border">
                <div className="flex items-center justify-between border-b border-rule bg-ground px-3 py-1.5 text-xs text-sub">
                  <span>받는 사람이 보는 화면</span>
                  <button type="button" className="underline" onClick={() => setPreview(null)}>
                    닫기
                  </button>
                </div>
                <iframe title="공유 미리 보기" sandbox="" srcDoc={preview} className="h-80 w-full bg-ground" />
              </div>
            )}
            <ButtonRow>
              <Button icon="info" disabled={busy} onClick={showPreview}>
                미리 보기
              </Button>
              <Button icon="link" tone="primary" disabled={busy} onClick={create}>
                {busy ? '만드는 중…' : '링크 만들기'}
              </Button>
            </ButtonRow>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-sm font-bold">만든 링크</p>
          {list.length === 0 ? (
            <Empty>아직 없습니다</Empty>
          ) : (
            <div className="divide-y divide-rule rounded-[10px] border">
              {list.map((s) => {
                const expired = s.expires_at !== null && new Date(s.expires_at).getTime() < Date.now();
                const off = Boolean(s.revoked_at) || expired;
                return (
                  <div key={s.id} className={`flex items-center gap-2 px-3 py-2 ${off ? 'opacity-60' : ''}`}>
                    <Icon name={s.mode === 'drive' ? 'sheet' : 'link'} size={18} className="shrink-0 text-sub" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.title}</p>
                      <p className="truncate text-xs text-sub">
                        {s.revoked_at ? '끈 링크' : expired ? '기간 지남' : s.expires_at ? `${shortWhen(s.expires_at)}까지` : '기간 없음'}
                        {s.mode === 'server' ? ` · 열어 본 횟수 ${s.view_count}` : ` · 구글 문서 · ${shortWhen(s.updated_at)} 내용`}
                      </p>
                    </div>
                    {off ? (
                      <Tag>{s.revoked_at ? '꺼짐' : '지남'}</Tag>
                    ) : (
                      <>
                        <Button icon="paste" onClick={() => copy(s.url)}>
                          복사
                        </Button>
                        {s.mode === 'drive' && (
                          <Button icon="refresh" disabled={busy} onClick={() => run(() => api.post(`/shares/${s.id}/refresh`).then(() => toast('지금 내용으로 다시 올렸습니다')))}>
                            다시 올리기
                          </Button>
                        )}
                        <Button
                          icon="close"
                          disabled={busy}
                          onClick={() =>
                            confirm('이 링크를 끌까요? 받은 사람은 더 볼 수 없습니다.') &&
                            run(() => api.del<{ ok: true; warning?: string }>(`/shares/${s.id}`).then((r) => toast(r?.warning ?? '링크를 껐습니다', r?.warning ? 'error' : 'ok')))
                          }
                        >
                          끄기
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
