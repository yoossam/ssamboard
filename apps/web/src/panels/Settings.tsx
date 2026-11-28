import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LOCK_MINUTE_OPTIONS, MEMORY_MAX, MEMORY_TEXT_MAX, PIN_LENGTH, type MemoryDto, type AuthStatus, type ConnectorDto, type SettingsDto, BOARD_KIND_LABEL } from '@jarvis/shared';
import { Icon } from '../components/Icon';
import { Button, ButtonRow, Empty, Field, IconButton, inputClass, monoInput, Notice, PinField, Sheet, Tabs, Tag } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { LOCAL_TRACK } from '../lib/edition';
import { DriveTab } from '../local-shell/DriveTab';
import { MenuRecommender, describeAction, runMenu } from '../menu/menu';
import { refresh, useConnectors, useMenus, useSessions, useSettings, useTables } from '../lib/data';
import { ago, count, shortWhen, usd } from '../lib/format';
import { useApp, type SettingsTab } from '../lib/store';

// 설정(4.8). 일반 설정에는 시간대·비용 한도·모델만 두고,
// 잠금·PIN·API 키·연결 권한은 PIN을 다시 입력해야 바꿀 수 있다(ONE-10, USR-6).

function fail(e: unknown): void {
  useApp.getState().toast(errorMessage(e), 'error');
}
// 구글 드라이브 트랙에는 PIN 이 없다(문은 구글 로그인과 기기 잠금) — PIN 칸을 숨기고 늘 준비된 것으로 본다.
const pinReady = (pin: string) => LOCAL_TRACK || pin.length === PIN_LENGTH;

const TIMEZONES = ['Asia/Seoul', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'];

/** 제공자 하나의 API 열쇠(Claude·GPT 각각). 지금 대화에 쓰는 제공자에는 '사용 중' 표시. */
function ApiKeyBox({ settings, provider, active }: { settings: SettingsDto; provider: SettingsDto['providers'][number]; active: boolean }) {
  const toast = useApp((s) => s.toast);
  const [key, setKey] = useState('');
  const [pin, setPin] = useState('');
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const registered = settings.api_keys.find((k) => k.provider === provider.id);
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/settings/api-keys/${provider.id}`, {
        key: key.trim(),
        pin,
      });
      await refresh('settings');
      setKey('');
      setPin('');
      setEdit(false);
      toast(`${provider.label} API 키를 저장했습니다`);
    } catch (e) {
      fail(e);
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-[10px] border p-3">
      <div className="flex items-center gap-2">
        <Icon name="key" className="text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-bold">
          {provider.label} API 키{active && <span className="ml-1 text-xs font-normal text-sub">· 대화에 사용 중</span>}
        </span>
        {registered ? <Tag tone="accent">••••{registered.last4}</Tag> : <Tag tone={active ? 'danger' : undefined}>등록 전</Tag>}
        <IconButton
          icon={edit ? 'close' : 'edit'}
          label={edit ? '닫기' : registered ? `${provider.label} API 키 변경` : `${provider.label} API 키 등록`}
          active={edit}
          onClick={() => setEdit(!edit)}
        />
      </div>
      {edit ? (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="새 API 키">
              <input className={inputClass} type="password" autoComplete="off" placeholder={provider.keyHint} value={key} onChange={(e) => setKey(e.target.value)} />
            </Field>
            {!LOCAL_TRACK && <PinField value={pin} onChange={setPin} />}
          </div>
          <ButtonRow>
            <Button icon="close" disabled={busy} onClick={() => setEdit(false)}>
              취소
            </Button>
            <Button icon="save" tone="primary" disabled={busy || key.trim().length < 20 || !pinReady(pin)} onClick={save}>
              키 저장
            </Button>
          </ButtonRow>
        </div>
      ) : (
        <p className="mt-1 text-xs text-sub">
          {LOCAL_TRACK
            ? `키는 이 브라우저에만 두고 드라이브에도 올리지 않습니다. 다른 기기에서는 다시 넣어야 합니다. AI 요청은 이 브라우저가 ${provider.label} 에 바로 보냅니다.`
            : '키는 암호화해 서버에만 두고, 화면에는 끝 4자리만 보여 줍니다. AI 호출은 모두 서버를 거칩니다.'}
        </p>
      )}
    </div>
  );
}

function GeneralTab({ settings }: { settings: SettingsDto }) {
  const toast = useApp((s) => s.toast);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [budget, setBudget] = useState(String(settings.monthly_budget));
  const [model, setModel] = useState(settings.llm_model);
  const [busy, setBusy] = useState(false);
  const chosen = settings.models.find((m) => m.id === model);
  const spent = settings.month_cost;
  const ratio = settings.monthly_budget > 0 ? Math.min(1, spent / settings.monthly_budget) : 1;

  const save = async () => {
    setBusy(true);
    try {
      const n = Number(budget);
      if (!budget.trim() || !Number.isFinite(n) || n < 0) throw new Error('월 비용 한도는 0 이상의 숫자로 적어 주세요.');
      await api.put('/settings', {
        timezone,
        monthly_budget: n,
        llm_model: model,
      });
      useApp.getState().setStatus(await api.get<AuthStatus>('/auth/status'));
      await refresh();
      toast('저장했습니다');
    } catch (e) {
      fail(e);
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
            {settings.providers.map((p) => (
              <optgroup key={p.id} label={p.label}>
                {settings.models
                  .filter((m) => m.provider === p.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · 입력 ${m.input} / 출력 ${m.output}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <Button icon="save" tone="primary" className="w-full" disabled={busy} onClick={save}>
            저장
          </Button>
        </div>
      </div>
      <p className="-mt-2 text-xs text-sub">
        모델 가격은 100만 토큰당 달러입니다. 한도의 80%에서 알리고 100%에서 AI 호출을 멈춥니다.
        {chosen &&
          !settings.api_keys.some((k) => k.provider === chosen.provider) &&
          ` 고른 모델은 ${settings.providers.find((p) => p.id === chosen.provider)?.label ?? chosen.provider} 열쇠가 있어야 합니다(아래).`}
      </p>

      {settings.providers.map((p) => (
        <ApiKeyBox key={p.id} settings={settings} provider={p} active={settings.llm_provider === p.id} />
      ))}

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
      await api.put('/settings/security', {
        pin,
        lock_minutes: minutes,
        ...(changingPin ? { new_pin: newPin } : {}),
      });
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
                    const r = await api.post<{
                      synced: number;
                      failed: number;
                      structure_changed: number;
                    }>(`/connectors/${c.id}/sync`);
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
                    const r = await api.post<{ url: string }>('/connectors', {
                      type: 'google_sheets',
                      pin,
                    });
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
  const [created, setCreated] = useState<{
    url: string;
    signing_secret: string;
  } | null>(null);
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
      {/* 구글 드라이브 트랙: PIN 이 없고, 웹훅은 받아 줄 서버가 없어 숨긴다 */}
      {!LOCAL_TRACK && (
        <div className="grid grid-cols-2 gap-2">
          <PinField label="PIN 확인 (추가·해제할 때)" value={pin} onChange={setPin} />
          <Field label="웹훅 이름">
            <input className={inputClass} placeholder="예: 백업 서버" maxLength={40} value={hookName} onChange={(e) => setHookName(e.target.value)} />
          </Field>
        </div>
      )}
      <ButtonRow>
        <Button icon="sheet" disabled={busy || !pinReady(pin) || hasGoogle} onClick={() => add('google_sheets')}>
          Google 시트 연결
        </Button>
        {!LOCAL_TRACK && (
          <Button icon="webhook" disabled={busy || !pinReady(pin)} onClick={() => add('webhook')}>
            웹훅 추가
          </Button>
        )}
      </ButtonRow>
      {LOCAL_TRACK && (
        <p className="-mt-2 text-xs text-sub">구글 드라이브 트랙에서는 시트를 쌤보드를 연 동안에만, 아래 "지금 동기화"를 누를 때 맞춥니다. 다른 기기에서는 그 기기에서 다시 연결하세요.</p>
      )}
      <p className="-mt-2 text-xs text-sub">
        로그인과 도구 권한은 따로입니다. Google 은 연결할 때 "선택한 파일과 이 앱이 만든 파일만" 권한을 추가로 동의받습니다. 시트는 읽기만 하고, 설문지는 AI에게 시켰을 때 승인을 거쳐 새로 만듭니다.
      </p>

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

/**
 * 자료 옮기기(서버 트랙): 보드 전체를 파일 하나로 받거나, 받아 둔 파일로 바꾼다. 구글 드라이브 트랙과 같은 파일 모양이라
 * 두 트랙 사이를 오갈 수 있다(docs/TWO_EDITIONS_PLAN.md). 가져오기는 보드를 통째로 바꾸므로 PIN 을 다시 넣는다.
 */
function DataTab() {
  const toast = useApp((s) => s.toast);
  const [pin, setPin] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const data = await api.get<unknown>('/data/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `ssamboard-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('JSON 파일이 아닙니다.');
      }
      await api.post('/data/import', { pin, data });
      await refresh();
      setFile(null);
      toast('파일의 자료로 보드를 바꿨습니다');
    } catch (e) {
      fail(e);
    } finally {
      setPin('');
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-[10px] border p-3">
        <span className="text-sm font-bold">내보내기</span>
        <p className="mt-1 text-xs text-sub">
          보드 전체(블록·할 일·일정·표·메모·알림·AI 대화)를 파일 하나로 받습니다. AI(Claude·GPT) 열쇠·로그인 정보는 담지 않습니다. 구글 드라이브 트랙에서도 그대로 가져올 수 있습니다.
        </p>
        <ButtonRow>
          <Button icon="archive" disabled={busy} onClick={download}>
            파일로 받기
          </Button>
        </ButtonRow>
      </div>
      <div className="rounded-[10px] border p-3">
        <span className="text-sm font-bold">가져오기</span>
        <p className="mt-1 text-xs text-sub">받아 둔 파일로 지금 보드를 통째로 바꿉니다. 지금 내용은 사라지니 먼저 내보내기를 해 두세요.</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="자료 파일">
            <input className={inputClass} type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <PinField value={pin} onChange={setPin} />
        </div>
        <ButtonRow>
          <Button icon="upload" tone="primary" disabled={busy || !file || !pinReady(pin)} onClick={upload}>
            이 파일로 바꾸기
          </Button>
        </ButtonRow>
      </div>
    </div>
  );
}

/** 내 메뉴(위쪽 바로가기 줄): 순서·이름·지우기, AI 추천으로 더하기, 처음 안내 다시 보기 */
function MenuTab({ settings }: { settings: SettingsDto }) {
  const toast = useApp((s) => s.toast);
  const boardKind = useApp((s) => s.boardKind);
  const { data: menus } = useMenus();
  const { data: tables } = useTables();
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const hasKey = settings.api_keys.some((k) => k.provider === settings.llm_provider);
  const list = menus ?? [];
  const [moving, setMoving] = useState(false);
  /** 성공하면 true — 실패하면 편집 칸을 닫지 않는다(고친 글이 사라지지 않게 — 제미나이 검토) */
  const run = async (fn: () => Promise<unknown>, done?: string): Promise<boolean> => {
    try {
      await fn();
      await refresh('menus');
      if (done) toast(done);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };
  const move = (i: number, d: -1 | 1) => {
    if (moving) return; // 빠르게 여러 번 눌러도 한 번씩(제미나이 검토)
    const ids = list.map((m) => m.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    setMoving(true);
    void run(() => api.put('/menus/order', { ids })).finally(() => setMoving(false));
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-sub">위쪽 줄(또는 '내 메뉴' 블록)의 바로가기입니다. 누르면 정해 둔 일을 합니다(AI 에게 시키기 · 표 열기 · 표에 한 줄 넣기 · 링크 · 앱 화면).</p>
      <Notice>
        지금 <b>{BOARD_KIND_LABEL[boardKind]} 보드</b>의 메뉴입니다. 메뉴는 보드마다 따로 있습니다 — 다른 보드의 메뉴는 위쪽 [업무 | 수업]으로 바꾼 뒤 고칩니다.
      </Notice>
      {list.length === 0 ? (
        <Empty>아직 메뉴가 없습니다. 아래에서 AI 에게 추천받으세요.</Empty>
      ) : (
        <div className="divide-y divide-rule rounded-[10px] border">
          {list.map((m, i) => (
            <div key={m.id} className="flex items-center gap-2 px-3 py-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-tint">
                <Icon name={m.icon} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                {editing?.id === m.id ? (
                  <input
                    className={`${inputClass} h-9`}
                    autoFocus
                    maxLength={16}
                    value={editing.label}
                    onChange={(e) => setEditing({ id: m.id, label: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter')
                        void run(
                          () =>
                            api.patch(`/menus/${m.id}`, {
                              label: editing.label,
                            }),
                          '이름을 바꿨습니다',
                        ).then((ok) => ok && setEditing(null));
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                ) : (
                  <button type="button" className="block max-w-full truncate text-left text-sm font-medium" title="눌러서 해 보기" onClick={() => runMenu(m.action, m.id)}>
                    {m.label}
                  </button>
                )}
                <p className="truncate text-xs text-sub">{describeAction(m.action as any, tables)}</p>
              </div>
              <IconButton icon="prev" label="앞으로" size={32} onClick={() => i > 0 && move(i, -1)} />
              <IconButton icon="next" label="뒤로" size={32} onClick={() => i < list.length - 1 && move(i, 1)} />
              <IconButton icon="edit" label="이름 바꾸기" size={32} onClick={() => setEditing(editing?.id === m.id ? null : { id: m.id, label: m.label })} />
              <IconButton
                icon="trash"
                label="지우기"
                size={32}
                onClick={() => confirm(`"${m.label}" 메뉴를 지울까요? (메뉴가 쓰던 표는 그대로 둡니다)`) && void run(() => api.del(`/menus/${m.id}`), '메뉴를 지웠습니다')}
              />
            </div>
          ))}
        </div>
      )}
      <div className="rounded-[10px] border p-3">
        <div className="flex items-center gap-2">
          <Icon name="sparkle" className="text-accent" />
          <span className="flex-1 text-sm font-bold">AI 에게 메뉴 추천받기</span>
          <IconButton icon={adding ? 'close' : 'plus'} label={adding ? '닫기' : '추천받기'} active={adding} onClick={() => setAdding(!adding)} />
        </div>
        {adding && (
          <div className="mt-3">{hasKey ? <MenuRecommender onCreated={() => setAdding(false)} /> : <Notice>설정 → 일반에서 AI 열쇠를 먼저 넣어 주세요. 추천은 내 열쇠로 합니다.</Notice>}</div>
        )}
      </div>
      <ButtonRow>
        <Button
          icon="refresh"
          onClick={() =>
            void run(() =>
              api
                .put('/settings', { onboarded: false })
                .then(() => refresh('settings'))
                .then(() => useApp.getState().closeAll()),
            )
          }
        >
          처음 안내 다시 보기
        </Button>
      </ButtonRow>
    </div>
  );
}

/** 기억(2026-11-28): AI 를 부를 때마다 함께 보내는 사실·선호. AI 에게 "기억해 둬"라고 해도 되고 여기서 직접 고친다. */
function MemoryTab() {
  const toast = useApp((s) => s.toast);
  const memories = useQuery({
    queryKey: ['memories'],
    queryFn: () => api.get<MemoryDto[]>('/memories'),
  });
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, done?: string): Promise<boolean> => {
    try {
      await fn();
      await memories.refetch();
      if (done) toast(done);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };
  const list = memories.data ?? [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-sub">
        AI 를 부를 때마다 함께 보내는 기억입니다(쌤보드가 보관하고 {LOCAL_TRACK ? '내 구글 드라이브에 함께 저장' : '서버에 저장'}). 대화에서 "이거 기억해 둬"라고 해도 되고, AI 가 먼저 기억해 둘지 물을
        때도 있습니다. 학생 개인정보는 넣지 마세요.
      </p>
      <div className="flex gap-2">
        <input className={inputClass} placeholder="예: 5학년 3반 담임 / 학부모 문자는 존댓말로 세 줄 이내" value={text} maxLength={MEMORY_TEXT_MAX} onChange={(e) => setText(e.target.value)} />
        <Button icon="plus" tone="primary" className="shrink-0" disabled={!text.trim()} onClick={() => void run(() => api.post('/memories', { text }).then(() => setText('')), '기억했습니다')}>
          더하기
        </Button>
      </div>
      {list.length === 0 ? (
        <Empty>아직 기억이 없습니다</Empty>
      ) : (
        <div className="divide-y divide-rule rounded-[10px] border">
          {list.map((m) => (
            <div key={m.id} className="flex items-center gap-2 px-3 py-2">
              {editing?.id === m.id ? (
                <input
                  className={`${inputClass} h-9`}
                  autoFocus
                  value={editing.text}
                  maxLength={MEMORY_TEXT_MAX}
                  onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')
                      void run(
                        () =>
                          api.patch(`/memories/${m.id}`, {
                            text: editing.text,
                          }),
                        '고쳤습니다',
                      ).then((ok) => ok && setEditing(null));
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <p className="min-w-0 flex-1 text-sm">{m.text}</p>
              )}
              <IconButton icon="edit" label="고치기" size={32} onClick={() => setEditing(editing?.id === m.id ? null : { id: m.id, text: m.text })} />
              <IconButton icon="trash" label="지우기" size={32} onClick={() => void run(() => api.del(`/memories/${m.id}`), '지웠습니다')} />
            </div>
          ))}
        </div>
      )}
      {list.length > 0 && (
        <ButtonRow>
          <Button icon="trash" tone="danger" onClick={() => confirm('기억을 모두 지울까요?') && void run(() => api.del('/memories'), '모두 지웠습니다')}>
            모두 지우기
          </Button>
        </ButtonRow>
      )}
      <p className="text-xs text-sub">
        기억 {list.length}/{MEMORY_MAX}개 · 기억이 많을수록 AI 를 부를 때 보내는 글이 늘어납니다(같은 앞부분은 할인).
      </p>
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
    // connect 만 지우고 다른 주소 조각은 남긴다
    const url = new URL(window.location.href);
    url.searchParams.delete('connect');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    if (result === 'ok') useApp.getState().toast('Google 시트를 연결했습니다');
    else useApp.getState().toast(result === 'denied' ? '선택한 파일 권한에 동의해야 연결됩니다' : 'Google 시트를 연결하지 못했습니다', 'error');
  }, []);

  return (
    <Sheet title="설정" icon="settings" onClose={close} width={720} tall>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={
          LOCAL_TRACK
            ? [
                { id: 'general', label: '일반', icon: 'settings' },
                { id: 'menu', label: '메뉴', icon: 'grid' },
                { id: 'memory', label: '기억', icon: 'memo' },
                { id: 'drive', label: '드라이브', icon: 'save' },
                { id: 'connect', label: '연결', icon: 'link' },
              ]
            : [
                { id: 'general', label: '일반', icon: 'settings' },
                { id: 'menu', label: '메뉴', icon: 'grid' },
                { id: 'memory', label: '기억', icon: 'memo' },
                { id: 'security', label: '보안', icon: 'lock' },
                { id: 'connect', label: '연결', icon: 'link' },
                { id: 'devices', label: '기기', icon: 'device' },
                { id: 'data', label: '자료', icon: 'archive' },
              ]
        }
      />
      <div className="mt-4">
        {error ? (
          <Empty>{errorMessage(error)}</Empty>
        ) : !settings ? (
          <Empty>불러오는 중입니다</Empty>
        ) : tab === 'menu' ? (
          <MenuTab settings={settings} />
        ) : tab === 'memory' ? (
          <MemoryTab />
        ) : tab === 'general' || (LOCAL_TRACK && tab !== 'drive' && tab !== 'connect') ? (
          <GeneralTab settings={settings} />
        ) : tab === 'drive' ? (
          <DriveTab />
        ) : tab === 'security' ? (
          <SecurityTab settings={settings} />
        ) : tab === 'connect' ? (
          <ConnectTab />
        ) : tab === 'data' ? (
          <DataTab />
        ) : (
          <DevicesTab />
        )}
      </div>
    </Sheet>
  );
}
