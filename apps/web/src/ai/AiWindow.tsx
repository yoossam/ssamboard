import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { COLUMN_TYPES, COLUMN_TYPE_LABEL, normalizeValue, type BlockDto, type ColumnType, type CommandDto, type PlanStepView, type TablePreview } from '@jarvis/shared';
import { BLOCK_ICON, Icon } from '../components/Icon';
import { SafeText } from '../components/SafeText';
import { Button, ButtonRow, compactInput, IconButton, inputClass, Notice, Tag, useIsPhone } from '../components/ui';
import { api, errorMessage, streamAi } from '../lib/api';
import { refresh, useBoard } from '../lib/data';
import { droppedText, FILE_ACCEPT, filesFrom, googleLinksOnly, MAX_FILES, MAX_IMAGES, MAX_LINKS, readAttachedFile, shrinkImage, splitFiles, type AttachedFile, type AttachedImage, type AttachedLink } from '../lib/images';
import { useApp } from '../lib/store';

// 하나뿐인 AI 창(ONE-2). 대화와 실행을 모두 맡는다.
// 데이터를 바꾸는 일은 항상 계획 → 승인 → 반영 순서를 따르고, 승인한 뒤에도 되돌릴 수 있다(ONE-5·6).

export type TableEdit = { name: string; columns: { name: string; type: ColumnType }[] };

interface UserMsg {
  id: number;
  role: 'user';
  text: string;
  data: string;
  blocks: string[];
  /** 첨부한 이미지의 미리보기(data: 주소). 이 화면에서만 보이고 서버에는 남지 않는다. */
  images?: string[];
  /** 첨부한 파일 이름 */
  files?: string[];
}
interface AiMsg {
  id: number;
  role: 'assistant';
  text: string;
  tools: string[];
  streaming: boolean;
  error?: string;
  plan?: CommandDto;
  /** 표 미리보기에서 고친 이름·컬럼(단계 번호별) */
  edits: Record<string, TableEdit>;
}
type Msg = UserMsg | AiMsg;

interface AiState {
  messages: Msg[];
  conversationId: string | undefined;
  busy: boolean;
  abort: AbortController | null;
  send: (text: string, data: string, blockIds: string[], blockTitles: string[], images?: AttachedImage[], files?: AttachedFile[], links?: AttachedLink[]) => Promise<void>;
  stop: () => void;
  patch: (id: number, change: Partial<AiMsg>) => void;
  reset: () => void;
}

let seq = 0;

export const useAi = create<AiState>()((set, get) => ({
  messages: [],
  conversationId: undefined,
  busy: false,
  abort: null,
  patch: (id, change) => set((s) => ({ messages: s.messages.map((m) => (m.id === id && m.role === 'assistant' ? { ...m, ...change } : m)) })),
  stop: () => get().abort?.abort(),
  reset: () => {
    get().abort?.abort();
    set({ messages: [], conversationId: undefined, busy: false, abort: null });
  },
  send: async (text, data, blockIds, blockTitles, images = [], files = [], links = []) => {
    if (get().busy || (!text.trim() && images.length === 0 && files.length === 0 && links.length === 0)) return;
    const abort = new AbortController();
    const askId = ++seq;
    const replyId = ++seq;
    set((s) => ({
      busy: true,
      abort,
      messages: [...s.messages, { id: askId, role: 'user', text: text.trim(), data, blocks: blockTitles, images: images.map((img) => img.preview), files: [...files.map((f) => f.name), ...links.map((l) => l.label)] }, { id: replyId, role: 'assistant', text: '', tools: [], streaming: true, edits: {} }],
    }));
    const patch = get().patch;
    const current = () => get().messages.find((m): m is AiMsg => m.id === replyId && m.role === 'assistant');
    try {
      await streamAi(
        {
          text: text.trim(),
          data: data || undefined,
          context_block_ids: blockIds,
          conversation_id: get().conversationId,
          images: images.length > 0 ? images.map(({ media_type, data: b64 }) => ({ media_type, data: b64 })) : undefined,
          files: files.length > 0 ? files.map(({ name, data: b64 }) => ({ name, data: b64 })) : undefined,
          links: links.length > 0 ? links.map((l) => l.url) : undefined,
        },
        (event) => {
          const msg = current();
          if (!msg) return;
          if (event.type === 'text') patch(replyId, { text: msg.text + event.delta });
          else if (event.type === 'tool') patch(replyId, { tools: msg.tools.includes(event.label) ? msg.tools : [...msg.tools, event.label] });
          else if (event.type === 'plan') patch(replyId, { plan: event.command });
          else if (event.type === 'error') patch(replyId, { error: event.message });
          else if (event.type === 'done') set({ conversationId: event.conversation_id });
        },
        abort.signal,
      );
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') patch(replyId, { error: errorMessage(e) });
    } finally {
      patch(replyId, { streaming: false });
      set({ busy: false, abort: null });
      // 비용 한도 알림 같은 것이 새로 생겼을 수 있다.
      void refresh('notifications');
    }
  },
}));

const TOOL_ICON: Record<string, string> = {
  add_task: 'tasks',
  update_task: 'tasks',
  add_event: 'calendar',
  update_event: 'calendar',
  create_block: 'grid',
  update_block: 'grid',
  delete_block: 'trash',
  create_table: 'table',
  add_rows: 'table',
  mark_notifications: 'bell',
};
const STATUS_LABEL: Record<CommandDto['status'], string> = { proposed: '승인 전', applied: '반영됨', undone: '되돌림', cancelled: '취소됨' };

const EXAMPLES = ['내일 3시 거래처 미팅 추가', '오늘 온 알림 중 급한 것만', '이번 주 일정과 마감 정리해 줘', '표를 월별로 요약해서 새 블록으로'];

/** 새 표 미리보기(LLM-4·12). 이름·컬럼명·타입을 고칠 수 있고, 타입에 맞지 않는 칸은 강조한다. */
export function PreviewEditor({ preview, edit, onChange, locked }: { preview: TablePreview; edit: TableEdit | undefined; onChange: (edit: TableEdit) => void; locked: boolean }) {
  const value = edit ?? { name: preview.name, columns: preview.columns };
  const [start, setStart] = useState(0);
  const SHOW = 3;
  const first = Math.min(start, Math.max(0, value.columns.length - SHOW));
  const cols = value.columns.map((c, i) => ({ ...c, i })).slice(first, first + SHOW);
  const failRate = (i: number, type: ColumnType) => {
    const cells = preview.rows.map((r) => r[i]).filter((v) => v !== null && v !== '');
    return cells.length === 0 ? 0 : cells.filter((v) => !normalizeValue(v, type).ok).length / cells.length;
  };
  const setColumn = (i: number, change: Partial<{ name: string; type: ColumnType }>) => onChange({ ...value, columns: value.columns.map((c, j) => (j === i ? { ...c, ...change } : c)) });
  // 실패가 20%를 넘는 컬럼이 보이면 모든 컬럼에 같은 높이의 줄을 두어 아래 행이 어긋나지 않게 한다(LLM-12).
  const warn = (c: { i: number; type: ColumnType }) => c.type !== 'text' && failRate(c.i, c.type) > 0.2;
  const anyWarn = !locked && cols.some(warn);

  return (
    <div className="border-t border-rule px-3 py-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-sub">표 이름</span>
        <input className={inputClass} value={value.name} disabled={locked} maxLength={80} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </label>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs font-medium text-sub">
          컬럼 {value.columns.length}개 · 미리보기 {Math.min(5, preview.rows.length)} / {preview.total}행
        </span>
        {value.columns.length > SHOW && (
          <span className="flex">
            <IconButton icon="prev" label="이전 컬럼" size={32} disabled={first === 0} onClick={() => setStart(first - 1)} />
            <IconButton icon="next" label="다음 컬럼" size={32} disabled={first + SHOW >= value.columns.length} onClick={() => setStart(first + 1)} />
          </span>
        )}
      </div>
      <div className="mt-1 grid gap-2" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
        {cols.map((c) => {
          const rate = failRate(c.i, c.type);
          return (
            <div key={c.i} className="min-w-0">
              <input aria-label="컬럼 이름" className={compactInput} value={c.name} disabled={locked} maxLength={60} onChange={(e) => setColumn(c.i, { name: e.target.value })} />
              <select aria-label="컬럼 타입" className={`${compactInput} mt-1`} value={c.type} disabled={locked} onChange={(e) => setColumn(c.i, { type: e.target.value as ColumnType })}>
                {COLUMN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {COLUMN_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              {anyWarn &&
                (warn(c) ? (
                  <button type="button" onClick={() => setColumn(c.i, { type: 'text' })} className="mt-1 h-7 w-full truncate rounded-md bg-dangertint px-1 text-xs font-medium text-danger">
                    {Math.round(rate * 100)}% 실패 · 글자로 변경
                  </button>
                ) : (
                  <div className="mt-1 h-7" />
                ))}
              {preview.rows.slice(0, 5).map((r, k) => {
                const raw = r[c.i];
                const bad = raw !== null && raw !== '' && !normalizeValue(raw, c.type).ok;
                return (
                  <p key={k} title={bad ? '이 타입으로 바꾸지 못하는 값입니다. 저장하면 값은 비우고 원문은 남깁니다.' : undefined} className={`h-8 truncate border-b border-rule px-2 text-xs leading-8 ${bad ? 'bg-dangertint text-danger' : ''}`}>
                    {raw ?? ''}
                  </p>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlanCard({ msg }: { msg: AiMsg }) {
  const plan = msg.plan!;
  const patch = useAi((s) => s.patch);
  const closeAi = useApp((s) => s.closeAi);
  const toast = useApp((s) => s.toast);
  const [working, setWorking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deletes = plan.steps.filter((s) => s.tool === 'delete_block').length;

  const run = async (action: 'apply' | 'undo' | 'cancel') => {
    if (action === 'apply' && deletes > 0 && !confirmDelete) return setConfirmDelete(true);
    setWorking(true);
    try {
      const next = await api.post<CommandDto>(`/ai/commands/${plan.id}/${action}`, action === 'apply' ? { edits: msg.edits } : {});
      patch(msg.id, { plan: next });
      if (action !== 'cancel') await refresh();
      if (action === 'apply') toast('반영했습니다');
      if (action === 'undo') toast((next.skipped?.length ?? 0) > 0 ? `되돌렸습니다 · ${next.skipped!.length}건은 건너뜀` : '되돌렸습니다');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setWorking(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex h-11 items-center justify-between gap-2 border-b border-rule px-3">
        <span className="text-sm font-bold">변경 계획</span>
        <span className="text-xs whitespace-nowrap text-sub">
          {plan.steps.length}건 · {STATUS_LABEL[plan.status]}
        </span>
      </div>
      {plan.steps.map((step: PlanStepView) => (
        <div key={step.index}>
          <div className="flex min-h-[52px] items-center gap-2.5 border-b border-rule px-3 py-1.5">
            <Icon name={TOOL_ICON[step.tool] ?? 'sparkle'} className={step.tool === 'delete_block' ? 'text-danger' : 'text-accent'} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{step.title}</p>
              <p className="truncate text-xs text-sub">{step.detail}</p>
            </div>
          </div>
          {step.preview && (
            <PreviewEditor preview={step.preview} edit={msg.edits[String(step.index)]} locked={plan.status !== 'proposed' || working} onChange={(edit) => patch(msg.id, { edits: { ...msg.edits, [String(step.index)]: edit } })} />
          )}
        </div>
      ))}
      <div className="space-y-2 p-3">
        {plan.status === 'proposed' && (
          <>
            {confirmDelete && <Notice tone="danger">삭제 {deletes}건이 들어 있습니다. 승인하면 휴지통으로 보내고, 30일 안에 복구할 수 있습니다.</Notice>}
            <ButtonRow>
              <Button icon="close" disabled={working} onClick={() => run('cancel')}>
                취소
              </Button>
              <Button icon={confirmDelete ? 'trash' : 'check'} tone={confirmDelete ? 'danger' : 'primary'} disabled={working} onClick={() => run('apply')}>
                {confirmDelete ? '삭제 포함 승인' : '승인'}
              </Button>
            </ButtonRow>
            <p className="text-center text-xs text-sub">승인한 뒤에도 되돌릴 수 있습니다</p>
          </>
        )}
        {plan.status === 'applied' && (
          <ButtonRow>
            <Button icon="undo" disabled={working} onClick={() => run('undo')}>
              되돌리기
            </Button>
            <Button icon="grid" onClick={closeAi}>
              보드 보기
            </Button>
          </ButtonRow>
        )}
        {plan.status === 'undone' && (plan.skipped?.length ?? 0) > 0 && (
          <Notice>
            적용한 뒤에 직접 고친 항목은 덮어쓰지 않고 건너뛰었습니다: {plan.skipped!.join(', ')}
          </Notice>
        )}
        {plan.status === 'undone' && (plan.skipped?.length ?? 0) === 0 && <p className="text-center text-xs text-sub">모두 되돌렸습니다</p>}
        {plan.status === 'cancelled' && <p className="text-center text-xs text-sub">계획을 취소했습니다. 반영된 것은 없습니다.</p>}
      </div>
    </div>
  );
}

function Message({ msg }: { msg: Msg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        {msg.images && msg.images.length > 0 && (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
            {msg.images.map((src, i) => (
              <img key={i} src={src} alt={`첨부 이미지 ${i + 1}`} className="size-20 rounded-[10px] border object-cover" />
            ))}
          </div>
        )}
        {msg.text && (
          <div className="max-w-[85%] rounded-[14px_14px_4px_14px] bg-accent px-3.5 py-2.5 text-white">
            <SafeText text={msg.text} className="[&_a]:text-white" />
          </div>
        )}
        {(msg.blocks.length > 0 || msg.data || (msg.files?.length ?? 0) > 0) && (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-1">
            {msg.blocks.map((b) => (
              <Tag key={b} tone="accent">
                {b}
              </Tag>
            ))}
            {msg.data && <Tag>자료 {msg.data.length.toLocaleString()}자</Tag>}
            {msg.files?.map((name) => (
              <Tag key={name}>📎 {name}</Tag>
            ))}
          </div>
        )}
      </div>
    );
  }
  const waiting = msg.streaming && !msg.text && !msg.plan;
  return (
    <div className="space-y-2">
      {msg.tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {msg.tools.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      )}
      {msg.text && <SafeText text={msg.text} />}
      {waiting && <p className="text-sm text-sub">생각하는 중입니다…</p>}
      {msg.plan && <PlanCard msg={msg} />}
      {msg.error && <Notice tone="danger">{msg.error}</Notice>}
    </div>
  );
}

function Composer({ blocks }: { blocks: BlockDto[] }) {
  const send = useAi((s) => s.send);
  const stop = useAi((s) => s.stop);
  const busy = useAi((s) => s.busy);
  const hasMessages = useAi((s) => s.messages.length > 0);
  const selected = useApp((s) => s.selected);
  const toggleSelected = useApp((s) => s.toggleSelected);
  const clearSelected = useApp((s) => s.clearSelected);
  const [text, setText] = useState('');
  const [data, setData] = useState('');
  const [showData, setShowData] = useState(false);
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [links, setLinks] = useState<AttachedLink[]>([]);
  // 넣은 것이 구글 문서·시트 링크뿐이면 글이 아니라 첨부(링크)로 붙인다. 그 밖의 글·주소는 그대로 입력칸에 들어간다.
  const attachLinks = (found: AttachedLink[]) => {
    setLinks((now) => [...now, ...found.filter((l) => !now.some((x) => x.url === l.url))].slice(0, MAX_LINKS));
    if (links.length + found.length > MAX_LINKS) setImageError(`링크는 한 번에 ${MAX_LINKS}개까지예요.`);
  };
  const [imageError, setImageError] = useState('');
  const [shrinking, setShrinking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // 첨부: 단추로 고르기·붙여넣기(Ctrl+V)·끌어 놓기. 이미지는 이 기기에서 줄이고(lib/images.ts), 나머지 파일은 그대로 읽어 서버가 글로 바꾼다.
  const attach = async (all: File[]) => {
    if (all.length === 0) return;
    setImageError('');
    const { images: pics, others } = splitFiles(all);
    const notes: string[] = [];
    const roomImg = MAX_IMAGES - images.length;
    const roomFile = MAX_FILES - files.length;
    if (pics.length > roomImg) notes.push(`이미지는 한 번에 ${MAX_IMAGES}장까지예요.`);
    if (others.length > roomFile) notes.push(`파일은 한 번에 ${MAX_FILES}개까지예요.`);
    setShrinking(true);
    try {
      const [madeImages, madeFiles] = await Promise.all([
        Promise.all(pics.slice(0, Math.max(0, roomImg)).map(shrinkImage)),
        Promise.allSettled(others.slice(0, Math.max(0, roomFile)).map(readAttachedFile)),
      ]);
      setImages((now) => [...now, ...madeImages].slice(0, MAX_IMAGES));
      setFiles((now) => [...now, ...madeFiles.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))].slice(0, MAX_FILES));
      for (const r of madeFiles) if (r.status === 'rejected') notes.push(errorMessage(r.reason));
    } catch (e) {
      notes.push(errorMessage(e));
    } finally {
      setShrinking(false);
      setImageError(notes.join(' '));
      input.current?.focus();
    }
  };
  const picked = blocks.filter((b) => selected.includes(b.id));

  // "@일정"처럼 쓰면 블록을 골라 컨텍스트로 넣는다(ONE-7).
  const mention = /(?:^|\s)@(\S*)$/.exec(text);
  const candidates = mention ? blocks.filter((b) => !selected.includes(b.id) && b.title.toLowerCase().includes(mention[1].toLowerCase())).slice(0, 4) : [];
  const pick = (b: BlockDto) => {
    toggleSelected(b.id);
    setText(text.replace(/(^|\s)@\S*$/, '$1'));
    input.current?.focus();
  };

  // 입력줄이나 블록에서 넘어온 말이 있으면 바로 보낸다. AI 창이 이미 열려 있을 때 넘어온 말도 받는다.
  const waiting = useApp((s) => s.aiDraft);
  useEffect(() => {
    const draft = useApp.getState().takeDraft();
    // 입력줄에서 이미지만 넘어왔으면 붙여 두고 할 말을 기다린다. 글이 함께 오면 바로 보낸다.
    if ((draft?.images?.length || draft?.files?.length || draft?.links?.length) && !draft.text.trim()) {
      setImages((draft.images ?? []).slice(0, MAX_IMAGES));
      setFiles((draft.files ?? []).slice(0, MAX_FILES));
      setLinks((draft.links ?? []).slice(0, MAX_LINKS));
      input.current?.focus();
    } else if (draft) void submit(draft.text, draft.data, draft.images, draft.files, draft.links);
    else input.current?.focus();
  }, [waiting]);

  const submit = async (value = text, attached?: string, attachedImages?: AttachedImage[], attachedFiles?: AttachedFile[], attachedLinks?: AttachedLink[]) => {
    const body = value.trim();
    const sending = attachedImages ?? images;
    const sendingFiles = attachedFiles ?? files;
    const sendingLinks = attachedLinks ?? links;
    if ((!body && sending.length === 0 && sendingFiles.length === 0 && sendingLinks.length === 0) || busy || shrinking) return;
    const current = useApp.getState().selected;
    const chosen = blocks.filter((b) => current.includes(b.id));
    setText('');
    const pasted = (attached ?? data).trim();
    setData('');
    setShowData(false);
    clearSelected();
    setImages([]);
    setFiles([]);
    setLinks([]);
    setImageError('');
    await send(body, pasted, chosen.map((b) => b.id), chosen.map((b) => b.title), sending, sendingFiles, sendingLinks);
  };

  return (
    <div
      className="shrink-0 border-t border-rule p-3"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const dropped = filesFrom(e.dataTransfer);
        const found = dropped.length === 0 ? googleLinksOnly(droppedText(e.dataTransfer)) : [];
        if (dropped.length === 0 && found.length === 0) return;
        e.preventDefault();
        if (found.length > 0) attachLinks(found);
        else void attach(dropped);
      }}
    >
      {(files.length > 0 || links.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1.5" aria-label="첨부한 파일">
          {links.map((l, i) => (
            <span key={l.url} title={l.url} className="flex h-8 max-w-full items-center gap-1 rounded-lg border bg-card pr-1 pl-2 text-sm">
              <Icon name="link" size={15} className="shrink-0 text-accent" />
              <span className="max-w-[16rem] truncate">{l.label} 링크</span>
              <button type="button" aria-label={`링크 ${i + 1} 빼기`} onClick={() => setLinks((now) => now.filter((x) => x.url !== l.url))} className="flex size-6 items-center justify-center rounded-md text-sub hover:bg-tint hover:text-ink">
                <Icon name="close" size={14} />
              </button>
            </span>
          ))}
          {files.map((f, i) => (
            <span key={f.id} className="flex h-8 max-w-full items-center gap-1 rounded-lg border bg-card pr-1 pl-2 text-sm">
              <Icon name="clip" size={15} className="shrink-0 text-sub" />
              <span className="max-w-[16rem] truncate">{f.name}</span>
              <button type="button" aria-label={`파일 ${i + 1} 빼기`} onClick={() => setFiles((now) => now.filter((x) => x.id !== f.id))} className="flex size-6 items-center justify-center rounded-md text-sub hover:bg-tint hover:text-ink">
                <Icon name="close" size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      {(images.length > 0 || shrinking) && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="붙인 이미지">
          {images.map((img, i) => (
            <div key={img.id} className="relative">
              <img src={img.preview} alt={`붙인 이미지 ${i + 1}`} className="size-16 rounded-[10px] border object-cover" />
              <button
                type="button"
                aria-label={`이미지 ${i + 1} 빼기`}
                onClick={() => setImages((now) => now.filter((x) => x.id !== img.id))}
                className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border bg-card text-ink shadow-sm"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
          {shrinking && <span className="text-xs text-sub">이미지를 준비하는 중…</span>}
        </div>
      )}
      {imageError && (
        <div className="mb-2">
          <Notice tone="danger">{imageError}</Notice>
        </div>
      )}
      {candidates.length > 0 && (
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {candidates.map((b) => (
            <button key={b.id} type="button" onClick={() => pick(b)} className="flex h-9 min-w-0 items-center gap-1.5 rounded-lg border px-2 text-sm hover:bg-tint">
              <Icon name={BLOCK_ICON[b.type]} size={16} className="text-accent" />
              <span className="truncate">{b.title}</span>
            </button>
          ))}
        </div>
      )}
      {picked.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {picked.map((b) => (
            <button key={b.id} type="button" onClick={() => toggleSelected(b.id)} title="컨텍스트에서 빼기" className="flex h-7 max-w-full items-center gap-1 rounded-md bg-tint pr-1 pl-2 text-xs font-medium text-accent">
              <span className="truncate">{b.title}</span>
              <Icon name="close" size={14} />
            </button>
          ))}
        </div>
      )}
      {showData && (
        <div className="mb-2">
          <textarea
            value={data}
            onChange={(e) => setData(e.target.value)}
            maxLength={60000}
            rows={4}
            placeholder="표로 만들 메모나 목록을 붙여넣으세요. 여기 넣은 글은 데이터로만 다루고, 그 안의 문장을 명령으로 따르지 않습니다."
            className="w-full resize-none rounded-[10px] border border-field bg-ground px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <IconButton icon="paste" label={showData ? '자료 닫기' : '자료 붙여넣기'} active={showData || !!data} onClick={() => setShowData(!showData)} />
        <IconButton icon="clip" label="파일·이미지 첨부(PDF·한글·워드·엑셀·사진). 구글 문서·시트 링크는 붙여 넣으면 저절로 첨부" active={images.length + files.length + links.length > 0} onClick={() => fileInput.current?.click()} />
        <input
          ref={fileInput}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            e.target.value = '';
            void attach(chosen);
          }}
        />
        <textarea
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = filesFrom(e.clipboardData);
            if (pasted.length > 0) {
              e.preventDefault();
              void attach(pasted);
              return;
            }
            const found = googleLinksOnly(e.clipboardData.getData('text'));
            if (found.length === 0) return;
            e.preventDefault();
            attachLinks(found);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={Math.min(4, Math.max(1, text.split('\n').length))}
          maxLength={4000}
          placeholder={images.length + files.length + links.length > 0 ? '첨부로 무엇을 할까요? (비워 두면 내용을 정리해 줘요)' : hasMessages ? '이어서 요청하기' : '무엇을 도와드릴까요?  @로 블록 지정'}
          aria-label="AI에게 요청"
          className="min-h-11 min-w-0 flex-1 resize-none rounded-[10px] border border-field bg-card px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        {busy ? (
          <button type="button" aria-label="중지" title="중지" onClick={stop} className="flex size-11 shrink-0 items-center justify-center rounded-full border border-field bg-card text-ink">
            <Icon name="close" size={18} />
          </button>
        ) : (
          <button type="button" aria-label="보내기" title="보내기" disabled={(!text.trim() && images.length === 0 && files.length === 0 && links.length === 0) || shrinking} onClick={() => void submit()} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40">
            <Icon name="send" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

export function AiWindow() {
  const phone = useIsPhone();
  const layout = useApp((s) => s.aiLayout);
  const setLayout = useApp((s) => s.setAiLayout);
  const close = useApp((s) => s.closeAi);
  const messages = useAi((s) => s.messages);
  const reset = useAi((s) => s.reset);
  const { data: board } = useBoard();
  const scroller = useRef<HTMLDivElement>(null);
  const panel = !phone && layout === 'panel';

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useApp.getState().panels.length === 0 && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const body = (
    <section
      role="dialog"
      aria-label="AI"
      className={`anim-rise flex flex-col overflow-hidden bg-card ${
        panel
          ? 'fixed top-0 right-0 bottom-0 z-30 w-[420px] border-l'
          : phone
            ? 'h-[88dvh] w-full rounded-t-[20px] pb-[env(safe-area-inset-bottom)] shadow-xl'
            : 'h-[min(720px,calc(100dvh-48px))] w-full max-w-[640px] rounded-2xl shadow-xl'
      }`}
    >
      {phone && <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-field" />}
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-rule pr-1.5 pl-4">
        <Icon name="sparkle" className="text-accent" />
        <h2 className="ml-1 min-w-0 flex-1 truncate text-base font-bold">AI</h2>
        {messages.length > 0 && <IconButton icon="refresh" label="새 대화" onClick={reset} />}
        {!phone && <IconButton icon={panel ? 'modal' : 'panel'} label={panel ? '가운데 창으로 보기' : '옆 패널로 보기'} onClick={() => setLayout(panel ? 'modal' : 'panel')} />}
        <IconButton icon="close" label="닫기" onClick={close} />
      </header>
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-end gap-2">
            <p className="text-sm text-sub">이렇게 말해 보세요. 바꾸는 일은 계획을 먼저 보여 드리고, 승인해야 반영합니다.</p>
            <div className="grid grid-cols-2 gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => useAi.getState().send(ex, '', [], [])} className="flex h-14 items-center rounded-[10px] border px-3 text-left text-sm hover:bg-tint">
                  <span className="line-clamp-2">{ex}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <Message key={m.id} msg={m} />)
        )}
      </div>
      <Composer blocks={board?.blocks ?? []} />
    </section>
  );

  if (panel) return body;
  return (
    <div className={`anim-fade fixed inset-0 z-30 flex bg-scrim ${phone ? 'items-end' : 'items-center justify-center p-6'}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      {body}
    </div>
  );
}
