/*
 * 처음 접속 안내(2026-11-28 선생님): ① AI 열쇠 넣기 → ② 쌤보드 고치는 법 → ③ 내 메뉴 추천(내 AI 열쇠로).
 * 마치거나 건너뛰면 users.onboarded_at 이 채워져 다시 뜨지 않는다. 설정 → 메뉴에서 다시 볼 수 있다.
 */
import { useState, type ReactNode } from 'react';
import { PIN_LENGTH, type SettingsDto } from '@jarvis/shared';
import { Icon } from '../components/Icon';
import { Button, Field, Notice, PinField, Tag, inputClass } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { refresh, useSettings } from '../lib/data';
import { LOCAL_TRACK } from '../lib/edition';
import { useApp } from '../lib/store';
import { MenuRecommender } from './menu';

const KEY_PAGES: Record<string, { url: string; how: string }> = {
  anthropic: {
    url: 'https://console.anthropic.com/settings/keys',
    how: 'Claude 콘솔 → API Keys → Create Key',
  },
  openai: {
    url: 'https://platform.openai.com/api-keys',
    how: 'OpenAI 플랫폼 → API keys → Create new secret key',
  },
};

async function finish(): Promise<void> {
  try {
    await api.put('/settings', { onboarded: true });
  } catch (e) {
    useApp.getState().toast(`안내를 마치지 못했습니다: ${errorMessage(e)}`, 'error');
  } finally {
    await refresh('settings');
  }
}

export function Onboarding() {
  const { data: settings } = useSettings();
  if (!settings || settings.onboarded) return null;
  return <Steps settings={settings} />;
}

function Steps({ settings }: { settings: SettingsDto }) {
  const [step, setStep] = useState(0);
  const hasKey = settings.api_keys.some((k) => k.provider === settings.llm_provider);
  const titles = ['AI 열쇠 넣기', '쌤보드 고치는 법', '내 메뉴 만들기'];
  const skip = () => void finish();
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-scrim p-3" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <div className="flex max-h-[92dvh] w-full max-w-[600px] flex-col rounded-3xl border bg-card">
        <header className="flex items-center gap-3 border-b border-rule px-6 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-sub">처음 시작하기 · {step + 1} / 3</p>
            <h2 id="onb-title" className="text-lg font-bold">
              {titles[step]}
            </h2>
          </div>
          <div className="flex gap-1" aria-hidden="true">
            {titles.map((_, i) => (
              <span key={i} className={`h-1.5 w-6 rounded-full ${i <= step ? 'bg-accent' : 'bg-tag'}`} />
            ))}
          </div>
          <button type="button" className="text-sm text-sub underline" onClick={skip}>
            건너뛰기
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 0 && <KeyStep settings={settings} onNext={() => setStep(1)} />}
          {step === 1 && <HowStep onNext={() => setStep(2)} />}
          {step === 2 && (hasKey ? <MenuStep /> : <NoKeyStep onBack={() => setStep(0)} />)}
        </div>
      </div>
    </div>
  );
}

function KeyStep({ settings, onNext }: { settings: SettingsDto; onNext: () => void }) {
  const toast = useApp((s) => s.toast);
  const [provider, setProvider] = useState(settings.llm_provider);
  const [key, setKey] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const registered = settings.api_keys.find((k) => k.provider === provider);
  const meta = settings.providers.find((p) => p.id === provider);
  const page = KEY_PAGES[provider];
  // 제공자를 바꾸면 그 회사의 '균형' 모델(없으면 첫 모델)로 맞춘다
  const modelFor = (p: string) => settings.models.find((m) => m.provider === p && /균형/.test(m.label))?.id ?? settings.models.find((m) => m.provider === p)?.id;
  const useProvider = async () => {
    if (provider !== settings.llm_provider) await api.put('/settings', { llm_model: modelFor(provider) });
  };
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/settings/api-keys/${provider}`, { key: key.trim(), pin });
      await useProvider();
      await refresh('settings');
      toast(`${meta?.label ?? ''} 열쇠를 저장했습니다`);
      onNext();
    } catch (e) {
      toast(errorMessage(e), 'error');
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  const next = async () => {
    setBusy(true);
    try {
      await useProvider();
      await refresh('settings');
      onNext();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-base leading-relaxed">
        쌤보드는 <b>내 AI 열쇠(API 키)</b>로 일을 정리하고, 수합하고, 그림을 그립니다. 열쇠는 {LOCAL_TRACK ? '이 브라우저에만' : '서버에 암호화해'} 두고 화면에는 끝 4자리만 보입니다.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {settings.providers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setProvider(p.id)}
            className={`rounded-xl border p-3 text-left transition ${provider === p.id ? 'border-accent bg-tint' : 'hover:bg-ground'}`}
            aria-pressed={provider === p.id}
          >
            <span className="block text-base font-bold">{p.label}</span>
            <span className="text-xs text-sub">{settings.api_keys.some((k) => k.provider === p.id) ? '열쇠 있음' : '열쇠 없음'}</span>
          </button>
        ))}
      </div>
      {registered ? (
        <Notice>
          {meta?.label} 열쇠가 이미 있습니다(••••{registered.last4}). 바꾸려면 설정 → 일반에서 바꿀 수 있습니다.
        </Notice>
      ) : (
        <>
          {page && (
            <p className="text-sm text-sub">
              열쇠 받는 곳:{' '}
              <a className="text-accent underline" href={page.url} target="_blank" rel="noreferrer">
                {page.how}
              </a>
              . 쓴 만큼 요금이 나가며, 설정 → 일반에서 한 달 한도를 정할 수 있습니다.
            </p>
          )}
          <div className={`grid gap-2 ${LOCAL_TRACK ? '' : 'grid-cols-2'}`}>
            <Field label={`${meta?.label ?? ''} API 키`}>
              <input className={inputClass} type="password" autoComplete="off" placeholder={meta?.keyHint} value={key} onChange={(e) => setKey(e.target.value)} />
            </Field>
            {!LOCAL_TRACK && <PinField value={pin} onChange={setPin} />}
          </div>
        </>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {!registered && (
          <Button icon="next" disabled={busy} onClick={onNext}>
            나중에 넣기
          </Button>
        )}
        {registered ? (
          <Button icon="next" tone="primary" disabled={busy} onClick={next}>
            다음
          </Button>
        ) : (
          <Button icon="save" tone="primary" disabled={busy || key.trim().length < 20 || (!LOCAL_TRACK && pin.length !== PIN_LENGTH)} onClick={save}>
            저장하고 다음
          </Button>
        )}
      </div>
    </div>
  );
}

function Tip({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-tint">
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-base font-bold">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-sub">{children}</p>
      </div>
    </div>
  );
}

function HowStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-2.5">
      <Tip icon="sparkle" title="말로 시키기">
        아래 입력줄에 "다음 주 금요일까지 동의서 걷기 넣어 줘"처럼 말합니다. 바꾸는 일은 <b>계획을 먼저 보여 주고, 승인해야</b> 반영되며 되돌릴 수 있습니다.
      </Tip>
      <Tip icon="grid" title="배치 바꾸기">
        오른쪽 위 <b>더보기 → 배치 편집</b>에서 블록 머리줄을 끌어 옮기고 모서리로 크기를 바꿉니다. 블록 추가도 더보기에 있습니다.
      </Tip>
      <Tip icon="palette" title="꾸미기">
        위쪽 오른쪽의 <b>색 동그라미 단추</b>로 보드 바탕색을, 블록 편집에서 블록 색을 바꿉니다.
      </Tip>
      <Tip icon="pin" title="내 메뉴">
        위쪽 줄의 바로가기입니다. 다음 단계에서 AI 가 추천해 주고, 나중에 <b>설정 → 메뉴</b>에서 더하거나 지울 수 있습니다.
      </Tip>
      <div className="flex justify-end pt-1">
        <Button icon="next" tone="primary" onClick={onNext}>
          다음
        </Button>
      </div>
    </div>
  );
}

function MenuStep() {
  return (
    <div className="space-y-3">
      <p className="text-base leading-relaxed">
        쌤보드에서 <b>관리하고 싶은 것</b>을 편하게 적어 주세요. AI 가 내용을 정리해 위쪽 줄에 놓을 메뉴와 그 형식(필요한 표의 칸, 누르면 하는 일)을 추천합니다.
      </p>
      <MenuRecommender onCreated={() => void finish()} />
    </div>
  );
}

function NoKeyStep({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <Notice>메뉴 추천은 내 AI 열쇠로 합니다. 열쇠를 넣으면 바로 추천받을 수 있어요.</Notice>
      <p className="text-sm text-sub">
        지금은 건너뛰고 나중에 <Tag>설정 → 메뉴</Tag> 에서 추천받아도 됩니다.
      </p>
      <div className="flex justify-end gap-2">
        <Button icon="prev" onClick={onBack}>
          열쇠 넣으러 가기
        </Button>
        <Button icon="check" tone="primary" onClick={() => void finish()}>
          시작하기
        </Button>
      </div>
    </div>
  );
}
