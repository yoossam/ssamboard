/*
 * 처음 접속 안내(2026-11-28 세 모델 토론 6번 — "꾸미기 전에 내 업무 결과 하나를 본다"):
 * ① 무엇부터 해 볼지 고르기(실제 업무) → ② AI 열쇠가 없으면 그때 넣기 → ③ 바로 그 일(파일 고르기 또는 AI 입력줄에 말 채우기).
 * 꾸미기·메뉴 추천은 뒤로 — 위쪽 도움말·설정 → 메뉴에서. 마치거나 건너뛰면 users.onboarded_at 이 채워져 다시 뜨지 않는다.
 */
import { useRef, useState } from 'react';
import { PIN_LENGTH, type SettingsDto } from '@jarvis/shared';
import { NOTICE_PROMPT } from '../lib/prompts';
import { Icon } from '../components/Icon';
import { Button, Field, Notice, PinField, inputClass } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { refresh, useSettings } from '../lib/data';
import { LOCAL_TRACK } from '../lib/edition';
import { useApp } from '../lib/store';

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

/** 처음 해 볼 일 — 파일이 필요한 것은 안내 창 안에서 바로 고른다(브라우저는 누른 그 자리에서만 파일 창을 연다) */
interface FirstJob {
  id: string;
  icon: string;
  title: string;
  desc: string;
  /** AI 입력줄에 채울 말 */
  text?: string;
  /** 파일을 받아 이 말과 함께 보낸다 */
  file?: { accept: string; prompt: string; label: string };
}
const JOBS: FirstJob[] = [
  {
    id: 'notice',
    icon: 'calendar',
    title: '가정통신문 → 일정',
    desc: '사진·PDF·한글 파일을 고르면 날짜를 찾아 일정·할 일로 넣어요.',
    file: { accept: 'image/*,.pdf,.hwpx,.docx', prompt: NOTICE_PROMPT, label: '가정통신문 파일 고르기' },
  },
  { id: 'task', icon: 'tasks', title: '할 일 넣기', desc: '말 한 줄로 할 일과 마감을 넣어요.', text: '다음 주 금요일까지 현장체험학습 동의서 걷기 할 일로 넣어 줘' },
  { id: 'form', icon: 'sheet', title: '구글 설문 만들기', desc: '주제를 적으면 설문과 응답 표를 함께 만들어요(구글 연결 필요).', text: '구글 설문 만들어 줘 — 주제: ' },
  { id: 'quiz', icon: 'check', title: '수업 퀴즈 만들기', desc: '주제를 적으면 퀴즈와 학생용 QR 을 만들어요(수업 보드).', text: '퀴즈 5문제 만들어 줘 — 주제: ' },
];

export function Onboarding() {
  const { data: settings } = useSettings();
  if (!settings || settings.onboarded) return null;
  return <Steps settings={settings} />;
}

function Steps({ settings }: { settings: SettingsDto }) {
  const [job, setJob] = useState<FirstJob | null>(null);
  const [step, setStep] = useState<'pick' | 'key' | 'go'>('pick');
  const hasKey = settings.api_keys.some((k) => k.provider === settings.llm_provider);
  const titles = { pick: '무엇부터 해 볼까요?', key: 'AI 열쇠 넣기', go: '시작해요' };
  const order: ('pick' | 'key' | 'go')[] = hasKey && step !== 'key' ? ['pick', 'go'] : ['pick', 'key', 'go'];
  const skip = () => void finish();

  /** 고른 일을 AI 입력줄로 넘기고 안내를 닫는다 */
  const start = (picked: FirstJob, files?: File[]) => {
    const app = useApp.getState();
    if (picked.id === 'quiz' && app.boardKind !== 'class') app.setBoardKind('class');
    app.setFirstTask(files?.length ? { files, prompt: picked.file?.prompt } : { text: picked.text });
    void finish();
  };
  const choose = (picked: FirstJob) => {
    setJob(picked);
    if (!hasKey) return setStep('key');
    if (picked.file) return setStep('go');
    start(picked);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-scrim p-3" role="dialog" aria-modal="true" aria-labelledby="onb-title" data-onboarding>
      <div className="flex max-h-[92dvh] w-full max-w-[600px] flex-col rounded-3xl border bg-card">
        <header className="flex items-center gap-3 border-b border-rule px-6 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-sub">
              처음 시작하기 · {order.indexOf(step) + 1} / {order.length}
            </p>
            <h2 id="onb-title" className="text-lg font-bold">
              {titles[step]}
            </h2>
          </div>
          <div className="flex gap-1" aria-hidden="true">
            {order.map((s, i) => (
              <span key={s} className={`h-1.5 w-6 rounded-full ${i <= order.indexOf(step) ? 'bg-accent' : 'bg-tag'}`} />
            ))}
          </div>
          <button type="button" className="text-sm text-sub underline" onClick={skip}>
            건너뛰기
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 'pick' && <PickStep onPick={choose} onLook={skip} />}
          {step === 'key' && <KeyStep settings={settings} onNext={() => (job?.file ? setStep('go') : job ? start(job) : skip())} />}
          {step === 'go' && job?.file && <FileStep job={job} onFiles={(files) => start(job, files)} onBack={() => setStep('pick')} />}
        </div>
      </div>
    </div>
  );
}

function PickStep({ onPick, onLook }: { onPick: (job: FirstJob) => void; onLook: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-base leading-relaxed">
        쌤보드는 아래 입력줄에 <b>말로 시키면</b> 계획을 보여 주고, 승인하면 처리해요. 오늘 할 일 하나로 바로 해 볼까요?
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {JOBS.map((j) => (
          <button key={j.id} type="button" data-first-job={j.id} onClick={() => onPick(j)} className="flex gap-3 rounded-xl border p-3 text-left transition hover:border-accent hover:bg-tint">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-tint text-accent">
              <Icon name={j.icon} size={20} />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-bold">{j.title}</span>
              <span className="mt-0.5 block text-sm leading-relaxed text-sub">{j.desc}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="text-sm text-sub">
        꾸미기·내 메뉴·할 수 있는 일은 나중에 위쪽 <b>도움말</b>에서 볼 수 있어요.
      </p>
      <div className="flex justify-end">
        <Button icon="grid" onClick={onLook}>
          그냥 둘러보기
        </Button>
      </div>
    </div>
  );
}

function FileStep({ job, onFiles, onBack }: { job: FirstJob; onFiles: (files: File[]) => void; onBack: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-4">
      <p className="text-base leading-relaxed">{job.desc} 파일은 AI 가 읽기만 하고, 바꾸는 일은 계획을 보여 준 뒤 승인해야 반영돼요.</p>
      <input
        ref={input}
        type="file"
        accept={job.file!.accept}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <div className="flex justify-end gap-2">
        <Button icon="prev" onClick={onBack}>
          다른 일 고르기
        </Button>
        <Button icon="upload" tone="primary" onClick={() => input.current?.click()}>
          {job.file!.label}
        </Button>
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
