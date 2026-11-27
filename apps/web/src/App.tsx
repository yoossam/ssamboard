import { useEffect } from 'react';
import type { AuthStatus } from '@jarvis/shared';
import { AiWindow, useAi } from './ai/AiWindow';
import { Board } from './board/Board';
import { Icon } from './components/Icon';
import { Toasts } from './components/ui';
import { api, ApiError } from './lib/api';
import { queryClient } from './lib/data';
import { setTimezone } from './lib/format';
import { useApp } from './lib/store';
import { PanelHost } from './panels/Panels';
import { LockScreen, LoginScreen, OfflineScreen, PinSetupScreen } from './screens/Gate';

/** 활동 신호를 보내는 가장 짧은 간격(AUTH-5: 30초에 한 번 이내). */
const ACTIVITY_GAP = 30_000;

async function loadStatus(): Promise<void> {
  const app = useApp.getState();
  try {
    const status = await api.get<AuthStatus>('/auth/status');
    setTimezone(status.user?.timezone);
    app.setStatus(status);
    app.setOffline(false);
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) app.setOffline(true);
  }
}

/** 처음에 한 번, 그 뒤로 30초마다 잠금 상태를 서버에 묻는다. 이 요청은 활동으로 치지 않는다. */
function useStatus(): void {
  useEffect(() => {
    void loadStatus();
    const timer = setInterval(() => void loadStatus(), 30_000);
    const onVisible = () => document.visibilityState === 'visible' && void loadStatus();
    const onOffline = () => useApp.getState().setOffline(true);
    window.addEventListener('online', loadStatus);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', loadStatus);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}

/**
 * 활동 신호와 화면 타이머(AUTH-4·5).
 * 마우스·키보드·터치 입력이 있었을 때만, 30초에 한 번 이내로 서버에 알린다.
 * 잠금 판정은 서버가 하고, 여기 타이머는 시간이 되면 화면을 먼저 가리는 용도다.
 */
function useActivity(active: boolean, lockMinutes: number): void {
  useEffect(() => {
    if (!active) return;
    let lastInput = Date.now();
    let lastSent = Date.now();
    let pending: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      pending = undefined;
      lastSent = Date.now();
      api.post('/auth/activity').catch(() => undefined);
    };
    const onInput = () => {
      lastInput = Date.now();
      const wait = ACTIVITY_GAP - (lastInput - lastSent);
      if (wait <= 0) send();
      else if (pending === undefined) pending = setTimeout(send, wait);
    };
    const check = () => {
      if (lockMinutes > 0 && Date.now() - lastInput >= lockMinutes * 60_000) {
        api.post('/auth/lock').catch(() => undefined);
        useApp.getState().markLocked('idle');
      }
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    for (const name of events) window.addEventListener(name, onInput, { passive: true, capture: true });
    const timer = setInterval(check, 5_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      for (const name of events) window.removeEventListener(name, onInput, { capture: true });
      clearInterval(timer);
      clearTimeout(pending);
      document.removeEventListener('visibilitychange', check);
    };
  }, [active, lockMinutes]);
}

function Splash() {
  return (
    <main className="flex min-h-dvh items-center justify-center text-accent">
      <Icon name="sparkle" size={36} />
    </main>
  );
}

export function App() {
  const status = useApp((s) => s.status);
  const offline = useApp((s) => s.offline);
  const aiOpen = useApp((s) => s.aiOpen);
  const open = status?.authenticated === true && status.pin_set === true && status.locked === false;
  useStatus();
  useActivity(open && !offline, status?.lock_minutes ?? 0);

  // 잠기거나 로그아웃되면 불러 둔 보드 데이터와 대화를 메모리에서도 지운다.
  useEffect(() => {
    if (!open) {
      queryClient.clear();
      useAi.getState().reset();
    }
  }, [open]);

  // Google 동의 화면에서 돌아왔으면 연결 탭을 연다.
  useEffect(() => {
    if (open && new URLSearchParams(window.location.search).has('connect')) useApp.getState().open({ kind: 'settings', tab: 'connect' });
  }, [open]);

  let screen;
  if (offline) screen = <OfflineScreen />;
  else if (!status) screen = <Splash />;
  else if (!status.authenticated) screen = <LoginScreen />;
  else if (!status.pin_set) screen = <PinSetupScreen />;
  else if (status.locked) screen = <LockScreen />;
  else
    screen = (
      <>
        <Board />
        {aiOpen && <AiWindow />}
        <PanelHost />
      </>
    );
  return (
    <>
      {screen}
      <Toasts />
    </>
  );
}
