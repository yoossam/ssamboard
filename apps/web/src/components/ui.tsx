import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { PIN_LENGTH } from '@jarvis/shared';
import { useApp } from '../lib/store';
import { Icon } from './Icon';

// 화면 전체가 같이 쓰는 부품. 규칙: 단추에는 아이콘을 붙이고, 글자는 줄바꿈하지 않으며,
// PC에서는 가운데 팝업, 휴대폰에서는 아래에서 올라오는 시트로 연다.

const phoneQuery = typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)') : null;
/** 768px 미만이면 휴대폰 배치(MOB-1). */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      phoneQuery?.addEventListener('change', notify);
      return () => phoneQuery?.removeEventListener('change', notify);
    },
    () => phoneQuery?.matches ?? false,
    () => false,
  );
}

type Tone = 'primary' | 'ghost' | 'danger';
const TONE: Record<Tone, string> = {
  primary: 'bg-accent text-white border-accent hover:brightness-110',
  ghost: 'bg-card text-ink border-field hover:bg-ground',
  danger: 'bg-card text-danger border-danger hover:bg-dangertint',
};

export function Button({
  icon,
  children,
  tone = 'ghost',
  onClick,
  disabled,
  type = 'button',
  className,
}: {
  icon: string;
  children: ReactNode;
  tone?: Tone;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-11 min-w-0 items-center justify-center gap-2 rounded-[10px] border px-4 text-sm font-medium whitespace-nowrap transition disabled:opacity-50 ${TONE[tone]} ${className ?? ''}`}
    >
      <Icon name={icon} size={18} />
      <span className="truncate">{children}</span>
    </button>
  );
}

/** 44px 정사각 아이콘 단추. active면 강조색으로 켜진 상태를 보여준다. */
export function IconButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  className,
  size = 44,
}: {
  icon: string;
  label: string;
  onClick?: (e: MouseEvent) => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-[10px] transition disabled:opacity-40 ${active ? 'bg-tint text-accent' : 'text-sub hover:bg-ground hover:text-ink'} ${className ?? ''}`}
    >
      <Icon name={icon} />
    </button>
  );
}

/** 창 아래의 단추 줄. 항상 한 줄에 두 개씩 놓는다. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

/**
 * 창. PC에서는 가운데 팝업(둥근 모서리 16), 휴대폰에서는 아래 시트(위쪽 모서리 20 + 손잡이).
 * 바깥을 누르거나 Esc를 누르면 닫힌다.
 */
export function Sheet({
  title,
  icon,
  onClose,
  children,
  footer,
  width = 520,
  tall,
  flush,
  huge,
}: {
  title: string;
  icon?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** 높이를 고정한 큰 창(안에서 줄 수를 계산하는 내용에 쓴다) */
  tall?: boolean;
  /** 안쪽 여백 없이 내용이 창을 꽉 채운다 */
  flush?: boolean;
  /** 화면 거의 전체(긴 글 읽기·고치기 — 담당 사업 진행 기록) */
  huge?: boolean;
}) {
  const phone = useIsPhone();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`anim-fade fixed inset-0 z-40 flex bg-scrim ${phone ? 'items-end' : 'items-center justify-center p-6'}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={phone ? undefined : { maxWidth: width }}
        className={`anim-rise flex w-full flex-col overflow-hidden bg-card shadow-xl ${phone ? `rounded-t-[20px] ${huge ? 'h-[94dvh]' : tall ? 'h-[88dvh]' : 'max-h-[88dvh]'} pb-[env(safe-area-inset-bottom)]` : `rounded-2xl ${huge ? 'h-[calc(100dvh-48px)]' : tall ? 'h-[min(680px,calc(100dvh-48px))]' : 'max-h-[calc(100dvh-48px)]'}`}`}
      >
        {phone && <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-field" />}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-rule pr-1.5 pl-4">
          {icon && <Icon name={icon} className="text-accent" />}
          <h2 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h2>
          <IconButton icon="close" label="닫기" onClick={onClose} />
        </header>
        <div className={`min-h-0 flex-1 ${flush ? 'flex flex-col overflow-hidden' : 'overflow-y-auto p-4'}`}>{children}</div>
        {footer && <footer className="shrink-0 border-t border-rule p-4">{footer}</footer>}
      </section>
    </div>
  );
}

/** 켜짐/꺼짐 단추. 항상 보이고, 켜지면 강조색·꺼지면 회색이다. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex h-11 w-full items-center justify-between gap-3 text-left disabled:opacity-50"
    >
      <span className="min-w-0 truncate text-sm">{label}</span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-field'}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block truncate text-xs font-medium text-sub">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-sub">{hint}</span>}
    </label>
  );
}

// 입력 칸. 같은 속성의 클래스를 겹쳐 쓰면 어느 쪽이 이길지 알 수 없으므로, 크기별로 따로 만들어 둔다.
const fieldBase = 'min-w-0 rounded-[10px] border border-field bg-card outline-none focus:border-accent disabled:bg-ground';
/** 기본 입력 칸(높이 44) */
export const inputClass = `${fieldBase} h-11 w-full px-3 text-sm`;
/** 미리보기 표처럼 좁은 곳에 쓰는 입력 칸(높이 36) */
export const compactInput = `${fieldBase} h-9 w-full px-2 text-sm`;
/** 한 줄에 여러 칸을 놓을 때 쓰는 입력 칸(높이 40). 너비는 쓰는 쪽에서 정한다. */
export const rowInput = `${fieldBase} h-10 px-2 text-sm`;
/** 복사용 값처럼 고정폭 글꼴로 보여 주는 칸 */
export const monoInput = `${fieldBase} h-11 w-full px-3 font-mono text-xs`;

/** PIN 한 줄 입력(설정 변경 때의 PIN 재입력용). */
export function PinField({ value, onChange, label = 'PIN 확인', autoFocus }: { value: string; onChange: (v: string) => void; label?: string; autoFocus?: boolean }) {
  return (
    <Field label={label}>
      <input
        className={`${inputClass} tracking-[0.4em]`}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={PIN_LENGTH}
        placeholder="숫자 6자리"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
      />
    </Field>
  );
}

/** 숫자 배지. 안 읽은 것은 빨강, 나머지는 회색. 점이 아니라 숫자로 보여준다. */
export function CountBadge({ n, alert }: { n: number; alert?: boolean }) {
  return (
    <span
      className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums ${alert && n > 0 ? 'bg-danger text-white' : 'bg-tag text-tagink'}`}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

export function Tag({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'danger'; className?: string }) {
  const color = tone === 'accent' ? 'bg-tint text-accent' : tone === 'danger' ? 'bg-dangertint text-danger' : 'bg-tag text-tagink';
  return <span className={`inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap tabular-nums ${color} ${className ?? ''}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="flex h-full min-h-11 items-center justify-center px-3 text-center text-sm text-sub">{children}</p>;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'danger' }) {
  return (
    <div className={`flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-sm ${tone === 'danger' ? 'bg-dangertint text-danger' : 'bg-tint text-accent'}`}>
      <Icon name="info" size={18} className="mt-px" />
      <p className="min-w-0 flex-1">{children}</p>
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const drop = useApp((s) => s.dropToast);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => drop(t.id)}
          className={`anim-rise pointer-events-auto flex max-w-full items-center gap-2 rounded-[10px] px-4 py-2.5 text-sm font-medium shadow-lg ${t.tone === 'error' ? 'bg-danger text-white' : 'bg-ink text-white'}`}
        >
          <Icon name={t.tone === 'error' ? 'info' : 'check'} size={18} />
          <span className="min-w-0 text-left">{t.text}</span>
        </button>
      ))}
    </div>
  );
}

/** 상자의 크기를 잰다. 블록이 몇 줄을 보여 줄 수 있는지 계산할 때 쓴다(안쪽 스크롤을 만들지 않기 위해). */
export function useSize<T extends HTMLElement>(): [RefObject<T>, { width: number; height: number }] {
  // useRef<T>(null)은 React 18 타입에서 RefObject<T>라서 <div ref>에 그대로 넣을 수 있다.
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

/** 같은 너비로 나눈 탭. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; icon: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="grid shrink-0 gap-1 rounded-[10px] bg-ground p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${value === t.id ? 'bg-card text-accent shadow-sm' : 'text-sub hover:text-ink'}`}
        >
          <Icon name={t.icon} size={16} />
          <span className="truncate">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
