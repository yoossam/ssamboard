/*
 * 설정 → 드라이브(구글 드라이브 트랙). 저장 상태·지금 저장·백업 되살리기·내보내기/가져오기·로그아웃.
 * 되살리기·가져오기는 이 보드를 통째로 바꾸므로 화면 안에서 한 번 더 확인한다.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, ButtonRow, Empty, Notice, Tag } from '../components/ui';
import { localHandle } from '../lib/edition';
import { useApp } from '../lib/store';
import type { SyncState } from './contract';

const STATE_LABEL: Record<SyncState, string> = { idle: '대기', saving: '저장 중', saved: '저장됨', offline: '연결 안 됨', conflict: '충돌 — 골라야 함', error: '저장 실패' };

export function DriveTab() {
  const h = localHandle();
  const toast = useApp((s) => s.toast);
  const [state, setState] = useState<SyncState>(h?.syncState() ?? 'idle');
  const [backups, setBackups] = useState<{ id: string; name: string }[] | null>(null);
  const [confirm, setConfirm] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => h?.onSyncState((s) => setState(s)), [h]);
  if (!h) return <Empty>이 화면은 구글 드라이브 트랙에서만 씁니다.</Empty>;
  const drive = h.track === 'drive';

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      toast((e as Error).message || '하지 못했습니다', 'error');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const download = async () => {
    const text = await h.exportJson();
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ssamboard-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[10px] border p-3">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{drive ? '구글 드라이브에 저장' : '이 기기에만 저장'}</span>
          {drive ? <Tag tone={state === 'saved' || state === 'idle' ? 'accent' : 'danger'}>{h.googleConnected() ? STATE_LABEL[state] : '구글 연결 끝남'}</Tag> : <Tag>드라이브 안 씀</Tag>}
        </div>
        <p className="mt-1 text-xs text-sub">
          {drive
            ? `${h.identity.email} 의 구글 드라이브 숨은 앱 폴더에 저장합니다. 바뀐 뒤 10초 조용하면 올리고, 하루 한 번 백업을 남깁니다(14개까지). AI(Claude·GPT) 열쇠는 올리지 않습니다.`
            : '이 브라우저에만 있습니다. 브라우저 기록을 지우거나 다른 기기에서는 볼 수 없습니다.'}
        </p>
        <ButtonRow>
          {drive ? (
            <>
              {!h.googleConnected() && (
                <Button icon="key" tone="primary" disabled={busy} onClick={() => void run(() => h.connectDrive(), '구글에 다시 연결했습니다')}>
                  구글 다시 연결
                </Button>
              )}
              <Button icon="save" disabled={busy || !h.googleConnected()} onClick={() => void run(() => h.saveNow(), '드라이브에 저장했습니다')}>
                지금 저장
              </Button>
            </>
          ) : (
            <Button icon="key" tone="primary" disabled={busy} onClick={() => void run(() => h.connectDrive())}>
              구글 드라이브로 옮기기
            </Button>
          )}
        </ButtonRow>
      </div>

      {drive && (
        <div className="rounded-[10px] border p-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm font-bold">하루 백업</span>
            <Button icon="refresh" disabled={busy || !h.googleConnected()} onClick={() => void run(async () => setBackups(await h.backups()))}>
              목록 보기
            </Button>
          </div>
          {backups && backups.length === 0 && <p className="mt-2 text-xs text-sub">아직 백업이 없습니다.</p>}
          {backups && backups.length > 0 && (
            <ul className="mt-2 divide-y">
              {backups.map((b) => (
                <li key={b.id} className="flex items-center gap-2 py-1.5 text-sm">
                  <span className="flex-1 tabular-nums">{b.name.replace(/^backup-|\.json$/g, '')}</span>
                  <button type="button" className="text-xs text-accent underline" disabled={busy} onClick={() => setConfirm({ label: `${b.name.replace(/^backup-|\.json$/g, '')} 백업으로 되살리기`, run: () => h.restore(b.id) })}>
                    되살리기
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="rounded-[10px] border p-3">
        <span className="text-sm font-bold">파일로 옮기기</span>
        <p className="mt-1 text-xs text-sub">보드 전체를 파일 하나로 받아 두거나, 받아 둔 파일로 이 보드를 바꿉니다(AI 열쇠는 담지 않습니다).</p>
        <ButtonRow>
          <Button icon="archive" disabled={busy} onClick={() => void run(download)}>
            내보내기
          </Button>
          <Button icon="upload" disabled={busy} onClick={() => fileRef.current?.click()}>
            가져오기
          </Button>
        </ButtonRow>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) setConfirm({ label: `${f.name} 로 이 보드 바꾸기`, run: async () => h.importJson(await f.text()) });
          }}
        />
      </div>

      {confirm && (
        <Notice tone="danger">
          <span className="block">{confirm.label} — 지금 보드의 내용이 모두 바뀝니다.</span>
          <span className="mt-2 flex gap-2">
            <Button icon="check" tone="primary" disabled={busy} onClick={() => void run(confirm.run)}>
              바꾸기
            </Button>
            <Button icon="close" disabled={busy} onClick={() => setConfirm(null)}>
              취소
            </Button>
          </span>
        </Notice>
      )}
    </div>
  );
}
