/*
 * 구글 드라이브 트랙의 첫 화면과 맞춤 표시(docs/TWO_EDITIONS_PLAN.md §0).
 * 트랙을 고르고(구글 드라이브 / 이 기기에만), 브라우저 안 작은 서버를 띄운 뒤 그 fetch 를 화면에 끼우고 보드를 연다.
 * 서버 트랙 빌드에는 묶이지 않는다(main.tsx 가 LOCAL_TRACK 일 때만 부른다).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { Button, Notice } from '../components/ui';
import { setFetcher } from '../lib/api';
import { setLocalHandle } from '../lib/edition';
import type { LocalApi, LocalHandle, SyncState, Track } from './contract';

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';
const SERVER_TRACK_URL = (import.meta.env.VITE_SERVER_TRACK_URL as string | undefined) ?? '';

let apiPromise: Promise<LocalApi> | null = null;
const loadApi = () => (apiPromise ??= import('@jarvis/local') as Promise<LocalApi>);

type Phase =
  | { kind: 'loading'; text: string }
  | { kind: 'choose' }
  | { kind: 'signin' }
  | { kind: 'mismatch'; saved: string; signedIn: string }
  | { kind: 'error'; message: string; track: Track | null }
  | { kind: 'ready'; handle: LocalHandle };

function Frame({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground p-4">
      <div className={`w-full ${wide ? 'max-w-[640px]' : 'max-w-[420px]'} rounded-3xl border bg-card px-6 py-8 md:px-8`}>{children}</div>
    </main>
  );
}

function Title({ sub }: { sub: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-tint text-accent">
        <Icon name="sparkle" size={26} />
      </div>
      <h1 className="mt-4 text-xl font-bold">쌤보드</h1>
      <p className="mt-1 text-sm text-sub">{sub}</p>
    </div>
  );
}

export function LocalBoot({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', text: '보드를 여는 중입니다' });

  const start = async (track: Track, interactive: boolean, replaceLocal = false) => {
    setPhase({ kind: 'loading', text: interactive && track === 'drive' ? '구글 창에서 계정을 고르세요' : '보드를 여는 중입니다' });
    const api = await loadApi();
    try {
      const handle = await api.startLocal({ track, clientId: CLIENT_ID, interactive, replaceLocal });
      setFetcher(handle.fetch);
      setLocalHandle(handle);
      setPhase({ kind: 'ready', handle });
    } catch (e) {
      if (e instanceof api.NeedSignInError) setPhase({ kind: 'signin' });
      else if (e instanceof api.AccountMismatchError) setPhase({ kind: 'mismatch', saved: e.saved, signedIn: e.signedIn });
      else setPhase({ kind: 'error', message: (e as Error).message || '보드를 열지 못했습니다.', track });
    }
  };

  useEffect(() => {
    void loadApi()
      .then((api) => {
        const t = api.savedTrack();
        if (t) void start(t, false);
        else setPhase({ kind: 'choose' });
      })
      .catch(() => setPhase({ kind: 'error', message: '앱 파일을 불러오지 못했습니다. 새로 고쳐 보세요.', track: null }));
  }, []);

  if (phase.kind === 'ready')
    return (
      <>
        {children}
        <SyncOverlay handle={phase.handle} />
      </>
    );
  if (phase.kind === 'loading')
    return (
      <Frame>
        <Title sub={phase.text} />
        <p className="mt-6 text-center text-xs text-sub">처음 여는 기기는 데이터베이스 파일(약 4MB)을 한 번 내려받습니다.</p>
      </Frame>
    );
  if (phase.kind === 'signin')
    return (
      <Frame>
        <Title sub="구글 드라이브에 저장하는 보드입니다" />
        <div className="mt-6 flex flex-col gap-2">
          <Button icon="key" tone="primary" onClick={() => void start('drive', true)}>
            구글 계정으로 계속
          </Button>
        </div>
      </Frame>
    );
  if (phase.kind === 'mismatch')
    return (
      <Frame>
        <Title sub="다른 계정의 보드가 이 브라우저에 있습니다" />
        <div className="mt-5 space-y-3 text-sm">
          <Notice>
            이 브라우저에는 <b>{phase.saved}</b> 의 보드가 있고, 지금 고른 계정은 <b>{phase.signedIn}</b> 입니다.
          </Notice>
          <Button icon="refresh" tone="primary" className="w-full" onClick={() => void start('drive', true, true)}>
            이 브라우저 자료를 지우고 {phase.signedIn} 로 열기
          </Button>
          <p className="text-xs text-sub">{phase.saved} 의 자료는 그 계정의 구글 드라이브에 남아 있습니다(마지막으로 저장한 데까지). 그 계정으로 다시 로그인하면 돌아옵니다.</p>
        </div>
      </Frame>
    );
  if (phase.kind === 'error')
    return (
      <Frame>
        <Title sub="보드를 열지 못했습니다" />
        <div className="mt-5 space-y-3">
          <Notice tone="danger">{phase.message}</Notice>
          <Button icon="refresh" className="w-full" onClick={() => (phase.track ? void start(phase.track, true) : location.reload())}>
            다시 시도
          </Button>
          <button type="button" className="w-full text-xs text-sub underline" onClick={() => setPhase({ kind: 'choose' })}>
            처음 화면으로
          </button>
        </div>
      </Frame>
    );
  return (
    <Frame wide>
      <Title sub="할 일·일정·표·메모를 한 화면에 두고, 말로 시키면 AI 가 정리해 주는 보드" />
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <section className="flex flex-col rounded-2xl border p-4">
          <h2 className="font-bold">구글 드라이브에 저장하며 쓰기</h2>
          <p className="mt-1 flex-1 text-sm text-sub">다른 컴퓨터·휴대폰에서 같은 계정으로 열면 같은 보드가 나옵니다. 자료는 내 구글 드라이브의 숨은 앱 폴더에 저장되고, 하루 한 번 백업을 남깁니다.</p>
          <Button icon="key" tone="primary" className="mt-3" disabled={!CLIENT_ID} onClick={() => void start('drive', true)}>
            구글 계정으로 시작
          </Button>
          {!CLIENT_ID && <p className="mt-2 text-xs text-danger">이 주소에는 구글 연결 설정이 없습니다(VITE_GOOGLE_CLIENT_ID).</p>}
        </section>
        <section className="flex flex-col rounded-2xl border p-4">
          <h2 className="font-bold">이 기기에서만 써 보기</h2>
          <p className="mt-1 flex-1 text-sm text-sub">구글 로그인 없이 이 브라우저에만 저장합니다. 브라우저 기록을 지우면 사라지니, 계속 쓰려면 나중에 설정 → 드라이브에서 옮기세요.</p>
          <Button icon="device" className="mt-3" onClick={() => void start('device', true)}>
            이 기기에서 시작
          </Button>
        </section>
      </div>
      <ul className="mt-5 space-y-1 text-xs text-sub">
        <li>· 쌤보드를 만든 사람을 포함해 누구도 여러분의 보드를 볼 수 없습니다. 서버가 없고, 자료는 이 브라우저와 내 드라이브에만 있습니다.</li>
        <li>· AI 를 쓰려면 Claude 또는 GPT(OpenAI) API 열쇠가 필요합니다(설정 → 일반). 열쇠는 이 브라우저에만 두고, AI 요청은 브라우저가 Claude·OpenAI 에 바로 보냅니다.</li>
        {SERVER_TRACK_URL && (
          <li>
            · 학교 서버에 직접 설치해 쓰려면{' '}
            <a className="underline" href={SERVER_TRACK_URL} target="_blank" rel="noreferrer">
              서버 트랙 안내
            </a>
            를 보세요.
          </li>
        )}
      </ul>
      <p className="mt-4 text-center text-xs text-sub">
        <a className="underline" href="./guide.html">
          사용 안내
        </a>
        {' · '}
        <a className="underline" href="./privacy.html">
          개인정보처리방침
        </a>
      </p>
    </Frame>
  );
}

const STATE_TEXT: Record<SyncState, string> = {
  idle: '',
  saving: '드라이브에 저장 중…',
  saved: '',
  offline: '드라이브에 연결되지 않았습니다',
  conflict: '다른 기기에서 바뀐 자료가 있습니다',
  error: '드라이브에 저장하지 못했습니다',
};

/** 맞춤 상태: 문제가 있을 때만 위쪽 가운데에 작게. 충돌이면 고르는 창. */
function SyncOverlay({ handle }: { handle: LocalHandle }) {
  const [state, setState] = useState<SyncState>(handle.syncState());
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(
    () =>
      handle.onSyncState((s, d) => {
        setState(s);
        setDetail(d ?? '');
      }),
    [handle],
  );
  if (handle.track !== 'drive') return null;
  const notConnected = !handle.googleConnected();
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setDetail((e as Error).message);
      setState('error');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'conflict')
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-4" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <div className="w-full max-w-[440px] rounded-3xl border bg-card p-6">
          <h2 id="conflict-title" className="text-lg font-bold">
            다른 기기에서 바뀐 자료가 있습니다
          </h2>
          <p className="mt-2 text-sm text-sub">이 기기에서 고친 것을 드라이브에 올리기 전에, 다른 기기가 먼저 드라이브의 보드를 바꿨습니다. 어느 쪽을 남길까요? 남기지 않은 쪽도 오늘 날짜 백업(설정 → 드라이브)에는 남아 있을 수 있습니다.</p>
          <div className="mt-4 grid gap-2">
            <Button icon="refresh" tone="primary" disabled={busy} onClick={() => void run(() => handle.keepRemote())}>
              드라이브 것 받기(이 기기 변경은 버림)
            </Button>
            <Button icon="upload" disabled={busy} onClick={() => void run(() => handle.keepLocal())}>
              이 기기 것 올리기(다른 기기 변경은 버림)
            </Button>
          </div>
        </div>
      </div>
    );
  const text = notConnected ? '구글 연결이 끝났습니다 — 저장은 이 기기에만 됩니다' : STATE_TEXT[state];
  if (!text) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-12 z-50 flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs shadow-sm" role="status" title={detail}>
        <Icon name={state === 'saving' ? 'refresh' : 'info'} size={14} className={state === 'saving' ? 'text-sub' : 'text-danger'} />
        <span className="truncate">{text}</span>
        {(notConnected || state === 'offline' || state === 'error') && (
          <button type="button" className="shrink-0 font-medium text-accent underline disabled:opacity-50" disabled={busy} onClick={() => void run(() => handle.connectDrive())}>
            구글 다시 연결
          </button>
        )}
      </div>
    </div>
  );
}
