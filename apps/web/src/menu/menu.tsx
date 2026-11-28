/*
 * 내 메뉴(2026-11-28): 위쪽 바로가기 줄, 메뉴 누르기, AI 추천 화면.
 * 메뉴의 틀(동작 다섯 가지)은 @jarvis/shared menu.ts, 서버 검사는 apps/api/src/menus/menus.service.ts.
 */
import { useEffect, useState } from 'react';
import { MENU_ACTION_LABEL, MENU_PANEL_LABEL, type MenuAction, type MenuDraft, type MenuItemDto, type MenuRecommendation, type TableDto } from '@jarvis/shared';
import { Icon } from '../components/Icon';
import { Button, ButtonRow, Notice, Tag, inputClass, useIsPhone } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { refresh, useBoard, useMenuInfo, useMenus, useTables } from '../lib/data';
import { useApp } from '../lib/store';
import { trackUse } from '../lib/usage';

/** '언제 정리했나' 를 사람 말로 */
function arrangedWhen(iso: string | null): string {
  if (!iso) return '아직 정리 전';
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  const hm = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  return days <= 0 ? `오늘 ${hm} 정리` : days === 1 ? `어제 ${hm} 정리` : `${d.getMonth() + 1}월 ${d.getDate()}일 정리`;
}

/**
 * 자동 정리 알림(2026-11-28 선생님 "자동 최신화된다는 걸 메뉴에서 알려 주면"): 자주 쓰는 순으로 하루 한 번 저절로 바뀐다는 것과 마지막으로 정리한 때.
 * compact 는 블록 위쪽 한 줄용.
 */
export function MenuAutoNote({ compact = false }: { compact?: boolean }) {
  const { data: info } = useMenuInfo();
  const when = arrangedWhen(info?.arranged_at ?? null);
  const autos = info?.auto_count ? ` · 자동 ${info.auto_count}개` : '';
  if (compact)
    return (
      <p data-menu-auto-note className="mb-1.5 flex items-center gap-1.5 truncate text-xs text-sub" title="쓴 만큼 하루 한 번 저절로 순서가 바뀌고, 자주 쓰는 기능은 '자동'으로 들어와요">
        <Icon name="refresh" size={12} className="shrink-0 text-accent" />
        <span className="truncate">
          자주 쓰는 순 자동 정리 · {when}
          {autos}
        </span>
      </p>
    );
  return (
    <div data-menu-auto-note className="mx-3 mt-3 flex shrink-0 gap-2.5 rounded-xl bg-tint px-3 py-2.5">
      <Icon name="refresh" size={18} className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0 text-xs leading-relaxed">
        <p className="font-bold text-accent">
          자동으로 최신화돼요 · {when}
          {autos}
        </p>
        <p className="mt-0.5 text-sub">
          하루 한 번 쓴 만큼 정리해서 자주 쓰는 메뉴는 위로, 안 쓰는 메뉴는 아래로 가요. 자주 쓰는 화면·표는 <b>자동</b> 표시를 달고 저절로 들어와요. 📌 를 누르면 맨 위에 고정돼 자리가 바뀌지 않고
          위쪽 줄에도 보여요.
        </p>
      </div>
    </div>
  );
}

/** 메뉴를 눌렀을 때 */
export function runMenu(action: MenuAction, menuId?: string): void {
  const app = useApp.getState();
  if (menuId) trackUse(`menu:${menuId}`);
  switch (action.type) {
    case 'ask_ai':
      app.openAi(action.prompt);
      break;
    case 'open_table':
      app.open({ kind: 'table', tableId: action.table_id });
      break;
    case 'add_row':
      app.open({ kind: 'table', tableId: action.table_id, addRow: true });
      break;
    case 'link':
      // 서버가 검사하지만, 가져온 자료 등으로 들어온 이상한 주소는 화면에서도 열지 않는다(제미나이 검토)
      if (/^https:\/\//i.test(action.url)) window.open(action.url, '_blank', 'noopener,noreferrer');
      else app.toast('https 주소만 열 수 있습니다', 'error');
      break;
    case 'open_panel':
      app.open(action.panel === 'settings' ? { kind: 'settings' } : { kind: action.panel });
      break;
  }
}

/** 동작을 사람 말로(표 이름까지) */
export function describeAction(
  a: {
    type: MenuAction['type'];
    prompt?: string | null;
    url?: string | null;
    panel?: string | null;
    table_id?: string | null;
  },
  tables: TableDto[] | undefined,
  newTable?: MenuDraft['new_table'],
): string {
  const label = MENU_ACTION_LABEL[a.type];
  if (a.type === 'ask_ai') return `${label} — "${a.prompt ?? ''}"`;
  if (a.type === 'link') return `${label} — ${a.url ?? ''}`;
  if (a.type === 'open_panel') return `${label} — ${MENU_PANEL_LABEL[a.panel as keyof typeof MENU_PANEL_LABEL] ?? a.panel}`;
  const name = newTable ? `새 표 "${newTable.name}"` : `"${tables?.find((t) => t.id === a.table_id)?.name ?? '지운 표'}"`;
  return `${label} — ${name}`;
}

/** 보드에 '내 메뉴' 블록이 있나 — 있으면 위쪽 줄은 숨겨 메뉴를 한 곳에만 둔다(2026-11-28 세 모델 합의). */
export function useMenuOnBoard(): boolean {
  const { data: board } = useBoard();
  return !!board?.blocks.some((b) => b.type === 'menu');
}

/**
 * '내 메뉴' 블록: 메뉴 이름만 작은 단추로 모은다(2026-11-28 선생님 제안). 블록 폭에 맞춰 여러 칸으로 늘어서고,
 * 누르면 위쪽 줄과 같은 동작(runMenu). AI 동작은 계획 → 승인을 거치고, 결과는 [처리 결과]에서 본다.
 */
export function MenuBlockBody() {
  const { data: menus, isLoading } = useMenus();
  const open = useApp((s) => s.open);
  const items = menus ?? [];
  return (
    <div className="h-full overflow-auto p-2">
      <MenuAutoNote compact />
      <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr))]">
        {items.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.description || m.label}
            onClick={() => runMenu(m.action, m.id)}
            className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border bg-card px-2.5 text-left text-sm font-medium transition hover:bg-tint active:scale-[0.98]"
          >
            <Icon name={m.icon} size={16} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">{m.label}</span>
            {m.pinned && <Icon name="pin" size={12} className="shrink-0 text-accent" />}
            {m.auto && <span className="shrink-0 rounded-full bg-tint px-1.5 text-[11px] text-accent">자동</span>}
            {m.action.type === 'ask_ai' && <Icon name="sparkle" size={12} className="shrink-0 text-sub" />}
          </button>
        ))}
        <button
          type="button"
          onClick={() => open({ kind: 'settings', tab: 'menu' })}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-dashed px-2.5 text-sm text-sub transition hover:bg-tint"
        >
          <Icon name="plus" size={16} className="shrink-0" />
          {isLoading ? '불러오는 중…' : items.length === 0 ? '내 메뉴 만들기' : '메뉴 고치기'}
        </button>
      </div>
    </div>
  );
}

/**
 * 내 메뉴 세로 서랍(2026-11-28 선생님 "스티커로 접고 누르면 우측에 세로로"): 오른쪽 가장자리에 자주 쓰는 순으로 세로로.
 * 누르면 그 일을 하고 닫힌다. 순서는 서버가 하루 한 번 쓴 만큼 다시 정하고(자주 쓰는 것 위로), 자주 쓰는 기능은 '자동'으로 들어온다.
 */
export function MenuDrawer() {
  const { data: menus, isLoading } = useMenus();
  const close = useApp((s) => s.close);
  const replace = useApp((s) => s.replace);
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  const items = menus ?? [];
  const togglePin = async (m: MenuItemDto) => {
    try {
      await api.patch(`/menus/${m.id}`, { pinned: !m.pinned });
      await refresh('menus');
      toast(m.pinned ? '고정을 풀었어요' : '맨 위에 고정했어요 · 위쪽 줄에도 보여요');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const rearrange = async () => {
    setBusy(true);
    try {
      await api.post('/menus/arrange', {});
      await refresh('menus');
      toast('자주 쓰는 순으로 다시 정리했어요');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="anim-fade fixed inset-0 z-40 bg-scrim/40" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside role="dialog" aria-modal="true" aria-label="내 메뉴" data-menu-drawer className="absolute top-0 right-0 flex h-full w-[min(320px,86vw)] flex-col border-l bg-card shadow-xl">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-rule pr-1.5 pl-4">
          <Icon name="grid" className="text-accent" />
          <h2 className="min-w-0 flex-1 truncate text-base font-bold">내 메뉴</h2>
          <button type="button" aria-label="닫기" onClick={close} className="flex size-10 items-center justify-center rounded-[10px] text-sub hover:bg-ground">
            <Icon name="close" />
          </button>
        </header>
        <MenuAutoNote />
        <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
          {isLoading && <p className="p-2 text-sm text-sub">불러오는 중…</p>}
          {!isLoading && items.length === 0 && <p className="p-2 text-sm text-sub">아직 메뉴가 없어요. 쌤보드를 쓰다 보면 자주 쓰는 기능이 여기 들어와요.</p>}
          {items.map((m) => (
            <div key={m.id} className="flex items-center gap-1">
              <button
                type="button"
                title={m.description || m.label}
                onClick={() => {
                  close();
                  runMenu(m.action, m.id);
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl border bg-card px-3 text-left transition hover:border-accent hover:bg-tint active:scale-[0.99]"
              >
                <Icon name={m.icon} size={20} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{m.label}</span>
                {m.auto && <span className="shrink-0 rounded-full bg-tint px-2 py-0.5 text-xs text-accent">자동</span>}
                {m.action.type === 'ask_ai' && <Icon name="sparkle" size={12} className="shrink-0 text-sub" />}
              </button>
              <button
                type="button"
                aria-pressed={!!m.pinned}
                aria-label={m.pinned ? `${m.label} 고정 풀기` : `${m.label} 맨 위에 고정`}
                title={m.pinned ? '고정 풀기(다시 자주 쓰는 순으로)' : '맨 위에 고정 — 자동 정렬에서 빼고 위쪽 줄에도 보여요'}
                onClick={() => void togglePin(m)}
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${m.pinned ? 'bg-accent text-white' : 'text-sub hover:bg-tint hover:text-accent'}`}
              >
                <Icon name="pin" size={16} />
              </button>
            </div>
          ))}
        </nav>
        <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-rule p-3">
          <Button icon="refresh" disabled={busy} onClick={() => void rearrange()}>
            {busy ? '정리 중…' : '다시 정리'}
          </Button>
          <Button icon="settings" onClick={() => replace({ kind: 'settings', tab: 'menu' })}>
            메뉴 고치기
          </Button>
        </footer>
      </aside>
    </div>
  );
}

/** 위쪽 줄의 메뉴 단추들. 휴대폰은 머리줄 아래 한 줄을 좌우로 넘긴다. 보드에 '내 메뉴' 블록이 있으면 그리지 않는다. */
export function MenuBar() {
  const { data: menus } = useMenus();
  const phone = useIsPhone();
  const open = useApp((s) => s.open);
  const onBoard = useMenuOnBoard();
  // 보드에 내 메뉴 블록이 있으면(늘 있다) 위쪽 줄에는 고정한 메뉴만(2026-11-28 세 모델 토론 5번)
  const items = onBoard ? (menus ?? []).filter((m) => m.pinned) : (menus ?? []);
  if (onBoard && items.length === 0) return phone ? null : <span className="flex-1" />;
  const chips = (
    <>
      {items.map((m) => (
        <button
          key={m.id}
          type="button"
          title={m.description || m.label}
          onClick={() => runMenu(m.action, m.id)}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 text-sm whitespace-nowrap transition hover:bg-tint active:scale-[0.98]"
        >
          <Icon name={m.icon} size={16} className="text-sub" />
          {m.label}
        </button>
      ))}
      {items.length === 0 && !onBoard && (
        <button
          type="button"
          onClick={() => open({ kind: 'settings', tab: 'menu' })}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed px-3 text-sm whitespace-nowrap text-sub transition hover:bg-tint"
        >
          <Icon name="plus" size={16} />내 메뉴 만들기
        </button>
      )}
    </>
  );
  if (phone) return <div className="flex h-11 items-center gap-1.5 overflow-x-auto border-t border-rule px-2 [scrollbar-width:none]">{chips}</div>;
  return <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-2 [scrollbar-width:none]">{chips}</div>;
}

const EXAMPLES = ['상담 기록', '출결·결석계', '가정통신문 일정 넣기', '설문·제출 현황', '수업 준비물', '회의록', '학부모 연락', '행사 준비'];

/**
 * 관리하고 싶은 것을 적으면 사용자의 AI 열쇠로 추천받고, 고른 것만 만든다.
 * 추천은 쌤보드가 준 틀(동작·아이콘·표 칸) 안에서 AI 가 짠 것이고, 만들 때 서버가 다시 검사한다.
 */
export function MenuRecommender({ onCreated }: { onCreated?: (made: MenuItemDto[]) => void }) {
  const toast = useApp((s) => s.toast);
  const { data: tables } = useTables();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'recommend' | 'create' | null>(null);
  const [rec, setRec] = useState<MenuRecommendation | null>(null);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [labels, setLabels] = useState<string[]>([]);

  const recommend = async () => {
    setBusy('recommend');
    try {
      const r = await api.post<MenuRecommendation>('/menus/recommend', {
        text,
      });
      setRec(r);
      setPicked(r.menus.map(() => true));
      setLabels(r.menus.map((m) => m.label));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const create = async () => {
    if (!rec) return;
    setBusy('create');
    try {
      const chosen = rec.menus.map((m, i) => ({ ...m, label: labels[i]?.trim() || m.label })).filter((_, i) => picked[i]);
      const made = await api.post<MenuItemDto[]>('/menus', { menus: chosen });
      await refresh('menus', 'tables');
      toast(`메뉴 ${chosen.length}개를 만들었습니다`);
      setRec(null);
      setText('');
      onCreated?.(made);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (rec) {
    const count = picked.filter(Boolean).length;
    return (
      <div className="space-y-3">
        {rec.summary && <Notice>{rec.summary}</Notice>}
        <p className="text-sm text-sub">만들 메뉴를 고르세요. 이름은 눌러서 바꿀 수 있습니다.</p>
        <div className="space-y-2">
          {rec.menus.map((m, i) => (
            <label key={i} className={`flex gap-3 rounded-xl border p-3 transition ${picked[i] ? 'bg-card' : 'bg-ground opacity-60'}`}>
              <input
                type="checkbox"
                className="mt-1.5 size-4 shrink-0 accent-[var(--color-accent)]"
                checked={picked[i] ?? false}
                onChange={(e) => setPicked(picked.map((p, j) => (j === i ? e.target.checked : p)))}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-tint">
                    <Icon name={m.icon} size={16} />
                  </span>
                  <input
                    className="h-9 min-w-0 flex-1 rounded-md border-transparent bg-transparent px-1 text-base font-medium hover:border-line focus:border-field"
                    value={labels[i] ?? ''}
                    maxLength={16}
                    onChange={(e) => setLabels(labels.map((l, j) => (j === i ? e.target.value : l)))}
                  />
                </div>
                {m.description && <p className="mt-1 text-sm">{m.description}</p>}
                <p className="mt-1 text-xs text-sub">
                  {describeAction(
                    {
                      type: m.action_type,
                      prompt: m.prompt,
                      url: m.url,
                      panel: m.panel,
                      table_id: m.table_id,
                    },
                    tables,
                    m.new_table,
                  )}
                </p>
                {m.new_table && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.new_table.columns.map((c) => (
                      <Tag key={c.name}>{c.name}</Tag>
                    ))}
                  </div>
                )}
                {m.reason && <p className="mt-1.5 text-xs text-sub">추천 까닭: {m.reason}</p>}
              </div>
            </label>
          ))}
        </div>
        <ButtonRow>
          <Button icon="undo" disabled={busy !== null} onClick={() => setRec(null)}>
            다시 적기
          </Button>
          <Button icon="check" tone="primary" disabled={busy !== null || count === 0} onClick={create}>
            {busy === 'create' ? '만드는 중…' : `고른 ${count}개 만들기`}
          </Button>
        </ButtonRow>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <textarea
        className={`${inputClass} h-28 resize-none py-2 leading-relaxed`}
        placeholder="예: 학생 상담 기록을 날짜별로 남기고 싶고, 가정통신문이 오면 일정에 넣고, 체험학습 신청서 제출 현황을 보고 싶어요."
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="h-8 rounded-full border px-3 text-sm text-sub transition hover:bg-tint"
            onClick={() => setText((t) => (t.trim() ? `${t.trim()}, ${ex}` : ex).slice(0, 2000))}
          >
            + {ex}
          </button>
        ))}
      </div>
      <ButtonRow>
        <Button icon="sparkle" tone="primary" disabled={busy !== null || !text.trim()} onClick={recommend}>
          {busy === 'recommend' ? 'AI 가 정리하는 중…' : 'AI 에게 메뉴 추천받기'}
        </Button>
      </ButtonRow>
      <p className="text-xs text-sub">내 AI 열쇠로 추천받습니다. 추천을 보고 고른 것만 만들어지며, 필요한 표도 함께 만들어집니다.</p>
    </div>
  );
}
