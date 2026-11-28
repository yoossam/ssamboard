/*
 * '수업 자료' 블록(2026-11-28 수업 보드 2단계): 수업에 쓸 링크를 모아 두고 큰 단추로 하나씩 연다.
 * 붙여 넣기 → 제목 자동 → 바로 열기(조작 수 줄이기 — 세 모델 합의). 한 번에 여러 개를 열지 않는다(팝업 차단).
 * 학생에게 보이기를 켠 것만 공유 링크(학생용)에 보기 주소로 나간다. 원본 권한은 그 도구에서 열어야 한다.
 */
import { useEffect, useState } from 'react';
import { checkLinkItems, cleanUrl, linksSignature, LINK_KIND_LABEL, LINKS_MAX, type BlockDto, type BoardDto, type LinkItem, type LinkKind, type TuildersApp } from '@jarvis/shared';
import { Icon } from '../components/Icon';
import { Button, Empty, Notice, Sheet, inputClass } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { boardKey, queryClient, refresh, useBoard } from '../lib/data';
import { useApp } from '../lib/store';
import { LOCAL_TRACK } from '../lib/edition';

const KIND_ICON: Record<LinkKind, string> = {
  canva: 'palette',
  slides: 'chart',
  docs: 'memo',
  sheets: 'sheet',
  forms: 'check',
  drive: 'archive',
  youtube: 'image',
  tuilders: 'grid',
  padlet: 'memo',
  thinkerbell: 'check',
  kahoot: 'check',
  edunet: 'link',
  iscream: 'link',
  web: 'link',
};

const itemsOf = (block: BlockDto): LinkItem[] => {
  const r = checkLinkItems(block.config.items ?? []);
  return r.ok ? r.items : [];
};

/** 블록의 자료 목록을 저장한다(먼저 화면에 반영하고, 실패하면 다시 읽는다) */
async function saveItems(block: BlockDto, items: LinkItem[]): Promise<boolean> {
  const key = boardKey();
  // 읽었던 목록 — 서버가 지금 목록과 견주어 다른 기기가 먼저 고쳤으면 409 로 막는다(덮어쓰지 않게)
  const base = linksSignature(block.config.items ?? []);
  queryClient.setQueryData<BoardDto>(key, (b) => b && { ...b, blocks: b.blocks.map((x) => (x.id === block.id ? { ...x, config: { ...x.config, items } } : x)) });
  try {
    await api.patch(`/blocks/${block.id}`, { config: { items }, items_base: base });
    return true;
  } catch (e) {
    useApp.getState().toast(errorMessage(e), 'error');
    void refresh('board');
    return false;
  }
}

function open(url: string) {
  // 새 탭으로 — 쌤보드 화면은 그대로 남는다
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function LinksBody({ block }: { block: BlockDto }) {
  const items = itemsOf(block);
  const toast = useApp((s) => s.toast);
  const openPanel = useApp((s) => s.open);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  // 자료 메뉴는 바깥을 누르거나 Esc 로 닫는다
  useEffect(() => {
    if (!menu) return;
    const shut = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as HTMLElement | null)?.closest('[data-link-menu]')) setMenu(null);
    };
    window.addEventListener('pointerdown', shut);
    window.addEventListener('keydown', shut);
    return () => {
      window.removeEventListener('pointerdown', shut);
      window.removeEventListener('keydown', shut);
    };
  }, [menu]);

  const add = async () => {
    const url = cleanUrl(text.trim());
    if (!url) return toast('https 로 시작하는 주소를 붙여 넣으세요', 'error');
    if (items.length >= LINKS_MAX) return toast(`한 블록에 ${LINKS_MAX}개까지입니다`, 'error');
    if (items.some((i) => i.url === url)) return toast('이미 담긴 주소입니다', 'error');
    const r = checkLinkItems([...items, { url }]);
    if (!r.ok) return toast(r.error, 'error');
    if (await saveItems(block, r.items)) setText('');
  };
  const patch = (id: string, change: Partial<LinkItem> | null) => {
    const next = change === null ? items.filter((i) => i.id !== id) : items.map((i) => (i.id === id ? { ...i, ...change } : i));
    setMenu(null);
    void saveItems(block, next);
  };
  const up = (id: string) => {
    const i = items.findIndex((x) => x.id === id);
    if (i <= 0) return;
    const next = [...items];
    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
    setMenu(null);
    void saveItems(block, next);
  };
  const rename = (item: LinkItem) => {
    const t = window.prompt('자료 이름', item.title);
    if (t !== null && t.trim()) patch(item.id, { title: t.trim().slice(0, 80) });
  };
  const anyStudent = items.some((i) => i.student);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
        {items.length === 0 && <Empty>캔바·구글 슬라이드·유튜브 주소를 아래에 붙여 넣으세요</Empty>}
        {items.map((it) => (
          <div key={it.id} className="relative flex items-stretch gap-1">
            <button
              type="button"
              onClick={() => open(it.url)}
              title={it.url}
              className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl border bg-card px-3 text-left transition hover:border-accent active:scale-[0.99]"
            >
              <Icon name={KIND_ICON[it.kind]} size={20} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-bold">{it.title}</span>
                <span className="block truncate text-xs text-sub">
                  {LINK_KIND_LABEL[it.kind]}
                  {it.note ? ` · ${it.note}` : ''}
                </span>
              </span>
              {it.student && <span className="shrink-0 rounded-full bg-tint px-2 py-0.5 text-xs font-bold text-accent">학생</span>}
            </button>
            <button
              type="button"
              data-link-menu
              aria-label="자료 메뉴"
              onClick={() => setMenu(menu === it.id ? null : it.id)}
              className="flex w-9 shrink-0 items-center justify-center rounded-xl text-sub hover:bg-ground"
            >
              <Icon name="more" size={18} />
            </button>
            {menu === it.id && (
              <div data-link-menu className="absolute top-full right-0 z-10 mt-1 flex w-48 flex-col rounded-xl border bg-card p-1 text-sm shadow-lg">
                <button type="button" className="rounded-lg px-3 py-2 text-left hover:bg-ground" onClick={() => patch(it.id, { student: !it.student })}>
                  {it.student ? '학생에게 숨기기' : '학생에게 보이기'}
                </button>
                <button type="button" className="rounded-lg px-3 py-2 text-left hover:bg-ground" onClick={() => rename(it)}>
                  이름 바꾸기
                </button>
                <button type="button" className="rounded-lg px-3 py-2 text-left hover:bg-ground" onClick={() => up(it.id)}>
                  위로 올리기
                </button>
                <button type="button" className="rounded-lg px-3 py-2 text-left text-danger hover:bg-dangertint" onClick={() => patch(it.id, null)}>
                  빼기
                </button>
              </div>
            )}
          </div>
        ))}
        {anyStudent && (
          <p className="px-1 pt-1 text-xs leading-relaxed text-sub">
            '학생'이 붙은 자료만 학생용 링크에 보기 주소로 나갑니다. 원본(캔바·구글)은 그 도구에서 '링크가 있는 사람 보기'로 열어 두어야 학생이 열 수 있습니다.{' '}
            <button type="button" className="font-bold text-accent underline" onClick={() => openPanel({ kind: 'share', blockId: block.id })}>
              학생용 링크 만들기
            </button>
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 border-t border-rule p-2">
        <input
          className={`${inputClass} h-10 min-w-0 flex-1 text-sm`}
          placeholder="주소 붙여 넣기 (https://…)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void add()}
          aria-label="자료 주소 붙여 넣기"
        />
        <Button icon="plus" className="h-10! px-3!" onClick={() => void add()}>
          담기
        </Button>
        {/* 드라이브 판은 서버가 없어 틸더스에 물을 수 없다(브라우저에서 바로는 막힘) — 주소를 붙여 넣으면 된다 */}
        {!LOCAL_TRACK && (
          <Button icon="grid" className="h-10! px-3!" onClick={() => openPanel({ kind: 'tuilders', blockId: block.id })}>
            틸더스
          </Button>
        )}
      </div>
    </div>
  );
}

/** 틸더스에서 수업 주제로 앱 찾기 → 고른 것만 이 블록에 담기(읽기는 승인 없이, 담기는 내가 누른 것만 — 세 모델 합의) */
export function TuildersPanel({ blockId }: { blockId: string }) {
  const close = useApp((s) => s.close);
  const toast = useApp((s) => s.toast);
  const { data: board } = useBoard();
  const block = board?.blocks.find((b) => b.id === blockId);
  const [topic, setTopic] = useState('');
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [level, setLevel] = useState('초');
  const [busy, setBusy] = useState(false);
  const [apps, setApps] = useState<TuildersApp[] | null>(null);
  const search = async () => {
    setBusy(true);
    try {
      const q = new URLSearchParams({ topic: topic.trim(), grade, subject: subject.trim(), level, limit: '8' });
      setApps(await api.get<TuildersApp[]>(`/tuilders/apps?${q}`));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const have = new Set(block ? itemsOf(block).map((i) => i.url) : []);
  const take = async (a: TuildersApp) => {
    if (!block) return;
    const r = checkLinkItems([...itemsOf(block), { url: a.url, title: a.title, note: a.tagline.slice(0, 120) }]);
    if (!r.ok) return toast(r.error, 'error');
    if (await saveItems(block, r.items)) toast(`"${a.title}"을 담았습니다`);
  };
  return (
    <Sheet title="틸더스에서 수업 앱 찾기" icon="grid" onClose={close} width={640}>
      {!block ? (
        <Empty>수업 자료 블록을 찾을 수 없습니다</Empty>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1.5">
            <input
              className={`${inputClass} h-11`}
              placeholder="주제 (예: 분수의 덧셈, 자석의 성질)"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void search()}
            />
            <select className={`${inputClass} h-11`} value={level} onChange={(e) => setLevel(e.target.value)} aria-label="학교급">
              <option value="초">초</option>
              <option value="중">중</option>
            </select>
            <select className={`${inputClass} h-11`} value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="학년">
              <option value="">학년</option>
              {[1, 2, 3, 4, 5, 6].map((g) => (
                <option key={g} value={`${g}학년`}>
                  {g}학년
                </option>
              ))}
            </select>
            <input className={`${inputClass} h-11 w-24`} placeholder="교과" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <Button icon="grid" tone="primary" className="w-full" disabled={busy || (!topic.trim() && !subject.trim())} onClick={() => void search()}>
            {busy ? '찾는 중…' : '추천받기'}
          </Button>
          {apps && apps.length === 0 && <Empty>맞는 앱이 없습니다. 주제를 바꿔 보세요</Empty>}
          {apps && apps.length > 0 && (
            <ul className="space-y-2">
              {apps.map((a) => (
                <li key={a.url} className="rounded-xl border bg-card p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{a.title}</p>
                      <p className="text-sm text-sub">{a.tagline}</p>
                      {a.reasons.length > 0 && <p className="mt-1 text-xs text-sub">{a.reasons.join(' · ')}</p>}
                      {a.down && <p className="mt-1 text-xs font-bold text-danger">지금 열리지 않을 수 있습니다(틸더스 점검 결과)</p>}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button icon="plus" tone={have.has(a.url) ? 'ghost' : 'primary'} className="h-9! px-3!" disabled={have.has(a.url)} onClick={() => void take(a)}>
                        {have.has(a.url) ? '담음' : '담기'}
                      </Button>
                      <Button icon="next" className="h-9! px-3!" onClick={() => open(a.url)}>
                        열어 보기
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Notice>추천은 틸더스(tuilders.com)가 교육과정·주제·큐레이터 추천으로 고릅니다. 앱 설명은 만든 분이 쓴 글입니다.</Notice>
        </div>
      )}
    </Sheet>
  );
}
