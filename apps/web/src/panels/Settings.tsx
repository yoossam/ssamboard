import { useEffect, useState } from 'react';
import { LOCK_MINUTE_OPTIONS, PIN_LENGTH, type AuthStatus, type ConnectorDto, type SettingsDto } from '@jarvis/shared';
import { Icon } from '../components/Icon';
import { Button, ButtonRow, Empty, Field, IconButton, inputClass, monoInput, Notice, PinField, Sheet, Tabs, Tag } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { refresh, useConnectors, useSessions, useSettings } from '../lib/data';
import { ago, count, shortWhen, usd } from '../lib/format';
import { useApp, type SettingsTab } from '../lib/store';

// 설정(4.8). 일반 설정에는 시간대·비용 한도·모델만 두고,
// 잠금·PIN·API 키·연결 권한은 PIN을 다시 입력해야 바꿀 수 있다(ONE-10, USR-6).

function fail(e: unknown): void {
  useApp.getState().toast(errorMessage(e), 'error');
}
const pinReady = (pin: string) => pin.length === PIN_LENGTH;

const TIMEZONES = ['Asia/Seoul', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'];

function GeneralTab({ settings }: { settings: SettingsDto }) {
  const toast = useApp((s) => s.toast);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [budget, setBudget] = useState(String(settings.monthly_budget));
  const [model, setModel] = useState(settings.llm_model);
  const [key, setKey] = useState('');
  const [pin, setPin] = useState('');
  const [editKey, setEditKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const registered = settings.api_keys.find((k) => k.provider === settings.llm_provider);
  const spent = settings.month_cost;
  const ratio = settings.monthly_budget > 0 ? Math.min(1, spent / settings.monthly_budget) : 1;

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/settings', { timezone, monthly_budget: Number(budget), llm_model: model });
      useApp.getState().setStatus(await api.get<AuthStatus>('/auth/status'));
      await refresh();
      toast('저장했습니다');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const saveKey = async () => {
    setBusy(true);
    try {
      await api.put(`/settings/api-keys/${settings.llm_provider}`, { key: key.trim(), pin });
      await refresh('settings');
      setKey('');
      setPin('');
      setEditKey(false);
      toast('API 키를 저장했습니다');
    } catch (e) {
      fail(e);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Field label="시간대">
          <select className={inputClass} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {[...new Set([settings.timezone, ...TIMEZONES])].map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Field>
        <Field label="월 비용 한도 (달러)">
          <input className={inputClass} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ''))} />
        </Field>
        <Field label="AI 모델">
          <select className={inputClass} value={model} onChange={(e) => setModel(e.target.value)}>
            {settings.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · 입력 ${m.input} / 출력 ${m.output}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <Button icon="save" tone="primary" className="w-full" disabled={busy} onClick={save}>
            저장
          </Button>
        </div>
      </div>
      <p className="-mt-2 text-xs text-sub">모델 가격은 100만 토큰당 달러입니다. 한도의 80%에서 알리고 100%에서 AI 호출을 멈춥니다.</p>

      <div className="rounded-[10px] border p-3">
        <div className="flex items-center gap-2">
          <Icon name="key" className="text-accent" />
          <span className="min-w-0 flex-1 truncate text-sm font-bold">Claude API 키</span>
          {registered ? <Tag tone="accent">••••{registered.last4}</Tag> : <Tag tone="danger">등록 전</Tag>}
          <IconButton icon={editKey ? 'close' : 'edit'} label={editKey ? '닫기' : registered ? 'API 키 변경' : 'API 키 등록'} active={editKey} onClick={() => setEditKey(!editKey)} />
        </div>
        {editKey ? (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="새 API 키">
                <input className={inputClass} type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
              </Field>
              <PinField value={pin} onChange={setPin} />
            </div>
            <ButtonRow>
              <Button icon="close" disabled={busy} onClick={() => setEditKey(false)}>
                취소
              </Button>
              <Button icon="save" tone="primary" disabled={busy || key.trim().length < 20 || !pinReady(pin)} onClick={saveKey}>
                키 저장
              </Button>
            </ButtonRow>
          </div>
        ) : (
          <p className="mt-1 text-xs text-sub">키는 암호화해 서버에만 두고, 화면에는 끝 4자리만 보여 줍니다. AI 호출은 모두 서버를 거칩니다.</p>
        )}
      </div>

      <div className="rounded-[10px] border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold">이번 달 사용량</span>
          <span className="text-sm whitespace-nowrap tabular-nums">
            {usd(spent)} / {usd(settings.monthly_budget)}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-tag" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${ratio >= 0.8 ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${ratio * 100}%` }} />
        </div>
        {settings.usage.length > 0 && (
          <div className="mt-3 text-xs">
            <div className="grid h-8 grid-cols-4 items-center border-b border-rule font-medium text-sub">
              <span>월</span>
              <span className="text-right">입력 토큰</span>
              <span className="text-right">출력 토큰</span>
              <span className="text-right">예상 비용</span>
            </div>
            {settings.usage.slice(0, 6).map((u) => (
              <div key={u.month} className="grid h-8 grid-cols-4 items-center border-b border-rule tabular-nums last:border-b-0">
                <span>{u.month}</span>
                <span className="text-right">{count(u.input_tokens)}</span>
                <span className="text-right">{count(u.output_tokens)}</span>
                <span className="text-right">{usd(u.cost_usd)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SecurityTab({ settings }: { settings: SettingsDto }) {
  const toast = useApp((s) => s.toast);
  const [minutes, setMinutes] = useState(settings.lock_minutes);
  const [newPin, setNewPin] = useState('');
  const [again, setAgain] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const changingPin = newPin.length > 0 || again.length > 0;
  const mismatch = changingPin && (newPin.length !== PIN_LENGTH || newPin !== again);

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/settings/security', { pin, lock_minutes: minutes, ...(changingPin ? { new_pin: newPin } : {}) });
      useApp.getState().setStatus(await api.get<AuthStatus>('/auth/status'));
      await refresh('settings', 'sessions');
      setPin('');
      setNewPin('');
      setAgain('');
      toast(changingPin ? '저장했습니다 · 다른 기기는 모두 로그아웃했습니다' : '저장했습니다');
    } catch (e) {
      fail(e);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label="자동 잠금" hint="이 시간 동안 마우스·키보드·터치 입력이 없으면 화면을 잠급니다. 판정은 서버가 합니다.">
        <select className={inputClass} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {LOCK_MINUTE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? '끄기' : `${m}분`}
            </option>
          ))}
        </select>
      </Field>
      {minutes === 0 && <Notice tone="danger">자동 잠금을 끄면 자리를 비워도 보드가 열려 있습니다. "지금 잠그기"로 직접 잠가야 합니다.</Notice>}
      <div className="grid grid-cols-2 gap-2">
        <PinField label="새 PIN (변경할 때만)" value={newPin} onChange={setNewPin} />
        <PinField label="새 PIN 한 번 더" value={again} onChange={setAgain} />
      </div>
      {mismatch && again.length === PIN_LENGTH && <Notice tone="danger">두 번 입력한 새 PIN이 다릅니다.</Notice>}
      <div className="grid grid-cols-2 gap-2">
        <PinField label="현재 PIN 확인" value={pin} onChange={setPin} />
        <div className="flex items-end">
          <Button icon="save" tone="primary" className="w-full" disabled={busy || !pinReady(pin) || mismatch} onClick={save}>
            저장
          </Button>
        </div>
      </div>
      <p className="text-xs text-sub">PIN을 5번 틀리면 모든 기기에서 로그아웃하고 15분 동안 막습니다. PIN을 잊으면 서버 콘솔의 jarvis reset-pin 명령으로만 재설정할 수 있습니다.</p>
    </div>
  );
}

function ConnectorCard({ c, pin, onDone }: { c: ConnectorDto; pin: string; onDone: () => void }) {
  const { toast, open } = useApp.getState();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh('connectors', 'tables', 'notifications');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const isSheets = c.type === 'google_sheets';
  return (
    <article className={`min-w-0 rounded-[10px] border p-3 ${busy ? 'pointer-events-none opacity-70' : ''}`}>
      <div className="flex items-center gap-2">
        <Icon name={isSheets ? 'sheet' : 'webhook'} className="text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{c.name}</span>
        {c.last_error ? <Tag tone="danger">오류</Tag> : <Tag tone="accent">연결됨</Tag>}
      </div>
      <p className="mt-1.5 truncate text-xs text-sub">권한: {isSheets ? '고른 스프레드시트만 읽기 (drive.file)' : '알림 만들기'}</p>
      <p className="truncate text-xs text-sub">
        {isSheets ? '마지막 동기화' : '마지막 수신'}: {c.last_synced_at ? shortWhen(c.last_synced_at) : '아직 없음'}
      </p>
      {c.last_error && <p className="mt-1 line-clamp-2 text-xs text-danger">{c.last_error}</p>}
      <div className="mt-2">
        <ButtonRow>
          {isSheets ? (
            <Button icon="sheet" onClick={() => open({ kind: 'sheet', connectorId: c.id })}>
              시트 가져오기
            </Button>
          ) : (
            <Button icon="bell" onClick={() => open({ kind: 'notifications' })}>
              알림 보기
            </Button>
          )}
          <Button
            icon="trash"
            tone="danger"
            disabled={!pinReady(pin)}
            onClick={() =>
              run(async () => {
                await api.del(`/connectors/${c.id}`, { pin });
                toast('연결을 해제하고 토큰을 지웠습니다');
                onDone();
              })
            }
          >
            해제
          </Button>
        </ButtonRow>
        {isSheets && (
          <div className="mt-2">
            <ButtonRow>
              <Button
                icon="refresh"
                onClick={() =>
                  run(async () => {
                    const r = await api.post<{ synced: number; failed: number; structure_changed: number }>(`/connectors/${c.id}/sync`);
                    toast(`동기화 ${r.synced}개 · 실패 ${r.failed}개 · 구조 변경 ${r.structure_changed}개`, r.failed + r.structure_changed > 0 ? 'error' : 'ok');
                  })
                }
              >
                지금 동기화
              </Button>
              <Button
                icon="link"
                disabled={!pinReady(pin)}
                onClick={() =>
                  run(async () => {
                    const r = await api.post<{ url: string }>('/connectors', { type: 'google_sheets', pin });
                    window.location.assign(r.url);
                  })
                }
              >
                다시 연결
              </Button>
            </ButtonRow>
          </div>
        )}
      </div>
    </article>
  );
}

function ConnectTab() {
  const toast = useApp((s) => s.toast);
  const { data = [], isLoading } = useConnectors();
  const [pin, setPin] = useState('');
  const [hookName, setHookName] = useState('');
  const [created, setCreated] = useState<{ url: string; signing_secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const hasGoogle = data.some((c) => c.type === 'google_sheets');

  const add = async (type: 'google_sheets' | 'webhook') => {
    setBusy(true);
    try {
      if (type === 'google_sheets') {
        const r = await api.post<{ url: string }>('/connectors', { type, pin });
        window.location.assign(r.url);
        return;
      }
      const r = await api.post<{ url: string; signing_secret: string }>('/connectors', { type, pin, name: hookName.trim() || '웹훅' });
      setCreated(r);
      setHookName('');
      setPin('');
      await refresh('connectors');
    } catch (e) {
      fail(e);
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('복사했습니다');
    } catch {
      toast('복사하지 못했습니다. 직접 골라 복사하세요.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <PinField label="PIN 확인 (추가·해제할 때)" value={pin} onChange={setPin} />
        <Field label="웹훅 이름">
          <input className={inputClass} placeholder="예: 백업 서버" maxLength={40} value={hookName} onChange={(e) => setHookName(e.target.value)} />
        </Field>
      </div>
      <ButtonRow>
        <Button icon="sheet" disabled={busy || !pinReady(pin) || hasGoogle} onClick={() => add('google_sheets')}>
          Google 시트 연결
        </Button>
        <Button icon="webhook" disabled={busy || !pinReady(pin)} onClick={() => add('webhook')}>
          웹훅 추가
        </Button>
      </ButtonRow>
      <p className="-mt-2 text-xs text-sub">로그인과 도구 권한은 따로입니다. Google 은 연결할 때 "선택한 파일과 이 앱이 만든 파일만" 권한을 추가로 동의받습니다. 시트는 읽기만 하고, 설문지는 AI에게 시켰을 때 승인을 거쳐 새로 만듭니다.</p>

      {created && (
        <div className="space-y-2 rounded-[10px] border border-accent p-3">
          <Notice>웹훅 주소와 서명 키는 지금 한 번만 보여 줍니다. 닫기 전에 복사해 두세요.</Notice>
          {(
            [
              ['주소 (POST)', created.url],
              ['서명 키', created.signing_secret],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex items-end gap-1.5">
              <div className="min-w-0 flex-1">
                <Field label={label}>
                  <input className={monoInput} readOnly value={value} onFocus={(e) => e.target.select()} />
                </Field>
              </div>
              <IconButton icon="paste" label={`${label} 복사`} active onClick={() => copy(value)} />
            </div>
          ))}
          <p className="text-xs text-sub">
            보낼 때 헤더 X-Jarvis-Signature에 sha256=&lt;본문을 서명 키로 HMAC-SHA256한 16진수&gt;를 넣습니다. 본문은 JSON이고 title은 필수, body·priority(urgent·normal·info)·dedupe_key는 선택입니다.
          </p>
          <ButtonRow>
            <Button icon="paste" onClick={() => copy(`${created.url}\n${created.signing_secret}`)}>
              둘 다 복사
            </Button>
            <Button icon="check" tone="primary" onClick={() => setCreated(null)}>
              복사했습니다
            </Button>
          </ButtonRow>
        </div>
      )}

      {data.length === 0 ? (
        <Empty>{isLoading ? '불러오는 중입니다' : '연결한 툴이 없습니다'}</Empty>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {data.map((c) => (
            <ConnectorCard key={c.id} c={c} pin={pin} onDone={() => setPin('')} />
          ))}
        </div>
      )}
    </div>
  );
}

function DevicesTab() {
  const toast = useApp((s) => s.toast);
  const { data = [], isLoading } = useSessions();
  const revoke = async (id: string) => {
    try {
      await api.del(`/sessions/${id}`);
      await refresh('sessions');
      toast('그 기기에서 로그아웃했습니다');
    } catch (e) {
      fail(e);
    }
  };
  if (data.length === 0) return <Empty>{isLoading ? '불러오는 중입니다' : '기기가 없습니다'}</Empty>;
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {data.map((s) => (
        <div key={s.id} className="flex h-16 min-w-0 items-center gap-2.5 rounded-[10px] border pr-1 pl-3">
          <Icon name="device" className="text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{s.device_name}</span>
            <span className="block truncate text-xs text-sub">
              마지막 입력 {ago(s.last_active_at)} · {s.locked ? '잠김' : '열림'}
            </span>
          </span>
          {s.current ? <Tag tone="accent">이 기기</Tag> : <IconButton icon="logout" label="이 기기 로그아웃" onClick={() => revoke(s.id)} />}
        </div>
      ))}
    </div>
  );
}

export function SettingsPanel({ initialTab }: { initialTab?: SettingsTab }) {
  const close = useApp((s) => s.close);
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general');
  const { data: settings, error } = useSettings();

  // Google 동의 화면에서 돌아왔을 때의 결과를 알려 준다.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('connect');
    if (!result) return;
    window.history.replaceState(null, '', '/');
    if (result === 'ok') useApp.getState().toast('Google 시트를 연결했습니다');
    else useApp.getState().toast(result === 'denied' ? '선택한 파일 권한에 동의해야 연결됩니다' : 'Google 시트를 연결하지 못했습니다', 'error');
  }, []);

  return (
    <Sheet title="설정" icon="settings" onClose={close} width={720} tall>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'general', label: '일반', icon: 'settings' },
          { id: 'security', label: '보안', icon: 'lock' },
          { id: 'connect', label: '연결', icon: 'link' },
          { id: 'devices', label: '기기', icon: 'device' },
        ]}
      />
      <div className="mt-4">
        {error ? (
          <Empty>{errorMessage(error)}</Empty>
        ) : !settings ? (
          <Empty>불러오는 중입니다</Empty>
        ) : tab === 'general' ? (
          <GeneralTab settings={settings} />
        ) : tab === 'security' ? (
          <SecurityTab settings={settings} />
        ) : tab === 'connect' ? (
          <ConnectTab />
        ) : (
          <DevicesTab />
        )}
      </div>
    </Sheet>
  );
}
