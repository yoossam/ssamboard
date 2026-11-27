import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PASSWORD_MIN_LENGTH, PIN_LENGTH, PIN_LOCKOUT_MINUTES, type AuthStatus } from '@jarvis/shared';
import { Icon } from '../components/Icon';
import { Button, ButtonRow, Field, inputClass, Notice, useIsPhone } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { timeLabel } from '../lib/format';
import { useApp } from '../lib/store';

// 보드에 들어가기 전의 화면: 로그인 → (처음이면) PIN 등록 → 잠금 해제.
// 잠금 판정은 서버가 한다. 이 화면은 가리는 역할만 한다(AUTH-5).

async function refreshStatus(): Promise<void> {
  useApp.getState().setStatus(await api.get<AuthStatus>('/auth/status'));
}

async function logout(): Promise<void> {
  await api.post('/auth/logout').catch(() => undefined);
  useApp.getState().markSignedOut();
}

function Frame({ icon, title, sub, children }: { icon: string; title: string; sub: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground p-4">
      <div className="w-full max-w-[400px] rounded-2xl border bg-card px-6 py-8 text-center md:px-8">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-tint text-accent">
          <Icon name={icon} size={26} />
        </div>
        <h1 className="mt-4 text-xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-sub">{sub}</p>
        {children}
      </div>
    </main>
  );
}

export function LoginScreen() {
  const status = useApp((s) => s.status);
  if (status?.login_mode === 'password') return status.setup_needed ? <SetupForm /> : <PasswordLogin />;
  return <GoogleLogin />;
}

function GoogleLogin() {
  const params = new URLSearchParams(window.location.search);
  const failed = params.get('login');
  return (
    <Frame icon="sparkle" title="쌤보드" sub="한 페이지 교무업무 보드와 AI">
      {failed && (
        <div className="mt-5 text-left">
          <Notice tone="danger">{failed === 'denied' ? '허용 목록에 없는 계정입니다.' : '로그인하지 못했습니다. 다시 시도하세요.'}</Notice>
        </div>
      )}
      <div className="mt-6 flex justify-center">
        <Button icon="key" tone="primary" className="min-w-40" onClick={() => window.location.assign('/api/auth/google')}>
          Google 계정으로 로그인
        </Button>
      </div>
      <p className="mt-4 text-xs text-sub">로그인한 뒤에도 PIN을 입력해야 보드가 열립니다.</p>
    </Frame>
  );
}

/** 이메일·암호 로그인(배포판 기본). 맞으면 서버가 잠긴 세션을 만들고, 이어서 PIN 화면이 뜬다. */
function PasswordLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { email, password });
      await refreshStatus();
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame icon="sparkle" title="쌤보드" sub="한 페이지 교무업무 보드와 AI">
      <form onSubmit={submit} className="mt-6 space-y-3 text-left">
        <Field label="이메일">
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field label="암호">
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" tone="primary" icon="key" className="w-full" disabled={busy || !email || !password}>
          로그인
        </Button>
      </form>
      <p className="mt-4 text-xs text-sub">로그인한 뒤에도 PIN을 입력해야 보드가 열립니다. 암호를 잊었으면 서버에서 <code>jarvis set-password</code>로 바꿉니다.</p>
    </Frame>
  );
}

/** 처음 설치: 설치 코드(서버의 SETUP_CODE, install.sh 가 마지막에 보여 줌)로 주인 계정을 만든다. */
function SetupForm() {
  const [form, setForm] = useState({ code: '', name: '', email: '', password: '', again: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.again) return setError('두 암호가 다릅니다.');
    if ([...form.password].length < PASSWORD_MIN_LENGTH) return setError(`암호는 ${PASSWORD_MIN_LENGTH}자 이상으로 정해 주세요.`);
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/setup', { code: form.code, name: form.name, email: form.email, password: form.password });
      await refreshStatus();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame icon="sparkle" title="쌤보드 시작하기" sub="이 서버의 주인 계정을 만듭니다. 한 번만 하면 됩니다.">
      <form onSubmit={submit} className="mt-6 space-y-3 text-left">
        <Field label="설치 코드" hint="설치를 마칠 때 화면에 나온 코드입니다. 서버의 .env 파일 SETUP_CODE 에도 있습니다.">
          <input autoComplete="off" required value={form.code} onChange={set('code')} className={inputClass} />
        </Field>
        <Field label="이름">
          <input autoComplete="name" value={form.name} onChange={set('name')} className={inputClass} placeholder="예: 김쌤" />
        </Field>
        <Field label="이메일" hint="로그인할 때 씁니다. 메일을 보내지는 않습니다.">
          <input type="email" autoComplete="username" required value={form.email} onChange={set('email')} className={inputClass} />
        </Field>
        <Field label={`암호 (${PASSWORD_MIN_LENGTH}자 이상)`}>
          <input type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} className={inputClass} />
        </Field>
        <Field label="암호 한 번 더">
          <input type="password" autoComplete="new-password" required value={form.again} onChange={set('again')} className={inputClass} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" tone="primary" icon="check" className="w-full" disabled={busy}>
          계정 만들기
        </Button>
      </form>
      <p className="mt-4 text-xs text-sub">다음 화면에서 보드를 여는 PIN 6자리를 정합니다.</p>
    </Frame>
  );
}

/**
 * PIN 입력. PC는 상자 6칸에 키보드로, 휴대폰은 점 6개와 숫자판으로 넣는다.
 * 6자리가 차면 onComplete를 부른다.
 */
function PinPad({ value, onChange, onComplete, disabled, onLogout }: { value: string; onChange: (v: string) => void; onComplete: (pin: string) => void; disabled?: boolean; onLogout?: () => void }) {
  const phone = useIsPhone();
  const input = useRef<HTMLInputElement>(null);
  const push = (next: string) => {
    if (disabled) return;
    const pin = next.replace(/\D/g, '').slice(0, PIN_LENGTH);
    onChange(pin);
    if (pin.length === PIN_LENGTH) onComplete(pin);
  };
  useEffect(() => {
    if (!phone && !disabled) input.current?.focus();
  }, [phone, disabled, value]);

  if (phone) {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'logout', '0', 'back'];
    return (
      <div className="mt-6">
        <div className="flex justify-center gap-3.5" aria-label={`PIN ${value.length}자리 입력됨`}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span key={i} className={`size-3.5 rounded-full border-2 ${i < value.length ? 'border-accent bg-accent' : 'border-field'}`} />
          ))}
        </div>
        <div className="mx-auto mt-6 grid max-w-[288px] grid-cols-3 gap-2">
          {keys.map((k) =>
            k === 'logout' ? (
              <button key={k} type="button" onClick={onLogout} disabled={!onLogout} className="flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl text-xs text-sub hover:bg-ground disabled:invisible">
                <Icon name="logout" size={20} />
                로그아웃
              </button>
            ) : k === 'back' ? (
              <button key={k} type="button" onClick={() => push(value.slice(0, -1))} disabled={disabled} className="flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl text-xs text-sub hover:bg-ground disabled:opacity-40">
                <Icon name="backspace" size={20} />
                지우기
              </button>
            ) : (
              <button key={k} type="button" onClick={() => push(value + k)} disabled={disabled} className="h-16 rounded-xl border bg-card text-2xl font-medium tabular-nums active:bg-tint disabled:opacity-40">
                {k}
              </button>
            ),
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="relative mt-6" onClick={() => input.current?.focus()}>
      <input
        ref={input}
        className="absolute inset-0 opacity-0"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label="PIN 6자리"
        maxLength={PIN_LENGTH}
        disabled={disabled}
        value={value}
        onChange={(e) => push(e.target.value)}
      />
      <div className="pointer-events-none flex justify-center gap-2">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={`flex h-14 w-12 items-center justify-center rounded-[10px] border-2 text-2xl ${i === value.length && !disabled ? 'border-accent' : 'border-field'} ${disabled ? 'bg-ground' : 'bg-card'}`}>
            {i < value.length ? '•' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 최초 로그인 때 PIN을 등록한다(AUTH-3). 두 번 입력해 확인한다. */
export function PinSetupScreen() {
  const phone = useIsPhone();
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const complete = async (value: string) => {
    if (first === null) {
      setFirst(value);
      setPin('');
      setError('');
      return;
    }
    if (value !== first) {
      setFirst(null);
      setPin('');
      setError('두 번 입력한 PIN이 다릅니다. 처음부터 다시 입력하세요.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/pin/setup', { pin: value });
      await refreshStatus();
    } catch (e) {
      setError(errorMessage(e));
      setFirst(null);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame icon="lock" title={first === null ? 'PIN을 등록하세요' : '한 번 더 입력하세요'} sub="자리를 비우면 화면이 잠기고, 이 PIN으로 풉니다">
      <PinPad value={pin} onChange={setPin} onComplete={complete} disabled={busy} onLogout={logout} />
      <p className={`mt-4 text-sm ${error ? 'text-danger' : 'text-sub'}`}>{error || 'PIN 6자리 · 숫자만'}</p>
      {!phone && (
        <div className="mt-5">
          <ButtonRow>
            <Button icon="logout" onClick={logout}>
              로그아웃
            </Button>
            <Button icon="undo" onClick={() => (setFirst(null), setPin(''), setError(''))} disabled={first === null && pin === ''}>
              다시 입력
            </Button>
          </ButtonRow>
        </div>
      )}
      <p className="mt-4 text-xs text-sub">PIN을 잊으면 서버 콘솔에서만 재설정할 수 있습니다.</p>
    </Frame>
  );
}

export function LockScreen() {
  const status = useApp((s) => s.status);
  const reason = useApp((s) => s.lockReason);
  const phone = useIsPhone();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(status?.attempts_left ?? 5);
  const [blockedUntil, setBlockedUntil] = useState<string | null>(status?.pin_locked_until ?? null);

  // 막힌 시간이 지나면 다시 입력할 수 있게 한다.
  useEffect(() => {
    if (!blockedUntil) return;
    const wait = new Date(blockedUntil).getTime() - Date.now();
    const timer = setTimeout(() => (setBlockedUntil(null), setError('')), Math.max(0, wait) + 500);
    return () => clearTimeout(timer);
  }, [blockedUntil]);

  const unlock = async (value: string) => {
    if (busy || value.length !== PIN_LENGTH) return;
    setBusy(true);
    try {
      await api.post('/auth/unlock', { pin: value });
      await refreshStatus();
    } catch (e) {
      setPin('');
      if (e instanceof ApiError) {
        if (typeof e.data.attempts_left === 'number') setAttempts(e.data.attempts_left);
        if (e.data.pin_locked_until) setBlockedUntil(e.data.pin_locked_until);
        if (e.status === 401) useApp.getState().toast(e.message, 'error');
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const minutes = status?.lock_minutes ?? 0;
  const sub = reason === 'idle' && minutes > 0 ? `${minutes}분 동안 입력이 없었습니다` : reason === 'manual' ? '직접 잠갔습니다' : 'PIN을 입력해 잠금을 푸세요';
  const hint = blockedUntil
    ? `PIN을 여러 번 틀려 ${PIN_LOCKOUT_MINUTES}분 동안 막혔습니다 · ${timeLabel(blockedUntil)} 이후 다시 시도`
    : `${error || 'PIN 6자리'} · 남은 시도 ${attempts}회`;

  return (
    <Frame icon="lock" title="쌤보드가 잠겼습니다" sub={sub}>
      <PinPad value={pin} onChange={setPin} onComplete={unlock} disabled={busy || !!blockedUntil} onLogout={logout} />
      <p className={`mt-4 text-sm ${blockedUntil || error ? 'text-danger' : 'text-sub'}`}>{hint}</p>
      {!phone && (
        <div className="mt-5">
          <ButtonRow>
            <Button icon="logout" onClick={logout}>
              로그아웃
            </Button>
            <Button icon="unlock" tone="primary" onClick={() => unlock(pin)} disabled={busy || !!blockedUntil || pin.length !== PIN_LENGTH}>
              잠금 해제
            </Button>
          </ButtonRow>
        </div>
      )}
      <p className="mt-4 text-xs text-sub">PIN을 잊었다면 서버 콘솔에서 재설정합니다</p>
    </Frame>
  );
}

export function OfflineScreen() {
  return (
    <Frame icon="info" title="오프라인입니다" sub="연결되면 보드를 다시 불러옵니다">
      <p className="mt-5 text-xs text-sub">보드 내용은 이 기기에 저장하지 않습니다.</p>
      <div className="mt-5 flex justify-center">
        <Button icon="refresh" className="min-w-40" onClick={() => window.location.reload()}>
          다시 시도
        </Button>
      </div>
    </Frame>
  );
}
