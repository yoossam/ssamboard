import { useEffect, useRef, useState } from 'react';
import { COLUMN_TYPES, COLUMN_TYPE_LABEL, compareRoster, parseRoster, type Column, type RowPage, type ColumnType, type RowDto, type TableDto, type TablePreview } from '@jarvis/shared';
import { PreviewEditor, type TableEdit } from '../ai/AiWindow';
import { Icon } from '../components/Icon';
import { Button, ButtonRow, Empty, Field, IconButton, inputClass, Notice, rowInput, Sheet, Tabs, Tag, Toggle, useSize } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { refresh, useConnectors, useRows, useTable, useTables } from '../lib/data';
import { cellText, count, isoToLocalInput, localInputToIso, shortWhen } from '../lib/format';
import { useApp } from '../lib/store';

// 표 목록·표 상세·파일 올리기·Google 시트 연결(4.3, 4.6).

const ORIGIN_LABEL: Record<TableDto['origin'], string> = { llm: 'AI', upload: '파일', sheet: '시트', manual: '직접', form: '설문' };

function fail(e: unknown): void {
  useApp.getState().toast(errorMessage(e), 'error');
}

/** 표를 보드에 표 블록으로 놓는다(LLM-5). 블록은 원본 표를 참조한다. */
async function placeOnBoard(table: Pick<TableDto, 'id' | 'name'>): Promise<void> {
  await api.post('/blocks', { type: 'table', title: table.name, source_table_id: table.id });
  await refresh('board');
}

// ── 표 목록 ──────────────────────────────────────────────────

export function TablesPanel() {
  const { close, open, replace } = useApp.getState();
  const { data = [], isLoading } = useTables();
  const { data: connectors = [] } = useConnectors();
  const google = connectors.find((c) => c.type === 'google_sheets');
  return (
    <Sheet
      title="표"
      icon="table"
      onClose={close}
      width={720}
      tall
      footer={
        <ButtonRow>
          <Button icon="upload" onClick={() => open({ kind: 'upload' })}>
            파일 올리기
          </Button>
          <Button icon="sheet" onClick={() => (google ? open({ kind: 'sheet', connectorId: google.id }) : replace({ kind: 'settings', tab: 'connect' }))}>
            {google ? '시트 가져오기' : 'Google 시트 연결'}
          </Button>
        </ButtonRow>
      }
    >
      {data.length === 0 ? (
        <Empty>{isLoading ? '불러오는 중입니다' : '아직 표가 없습니다. 파일을 올리거나 AI 창에 자료를 붙여넣어 만드세요.'}</Empty>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {data.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => open({ kind: 'table', tableId: t.id })}
              className="flex h-16 min-w-0 items-center gap-2.5 rounded-[10px] border px-3 text-left hover:bg-ground"
            >
              <Icon name={t.linked ? 'sheet' : 'table'} className="text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{t.name}</span>
                <span className="block truncate text-xs text-sub">
                  {count(t.row_count)}행 · 컬럼 {t.schema.columns.length}개
                </span>
              </span>
              {t.last_error ? <Tag tone="danger">오류</Tag> : <Tag tone={t.linked ? 'accent' : 'neutral'}>{t.linked ? '연결됨' : ORIGIN_LABEL[t.origin]}</Tag>}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

// ── 표 상세 ──────────────────────────────────────────────────

type DetailTab = 'rows' | 'columns' | 'settings' | 'roster';
const HEAD = 36;
const CELL_ROW = 40;

function RowForm({ table, row, onDone }: { table: TableDto; row: RowDto | null; onDone: () => void }) {
  const toast = useApp((s) => s.toast);
  const initial = (c: Column): string => {
    const v = row?.raw?.[c.id] ?? row?.values[c.id];
    if (v === null || v === undefined) return '';
    if (c.type === 'datetime' && typeof v === 'string' && !row?.raw?.[c.id]) return isoToLocalInput(v);
    return String(v);
  };
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(table.schema.columns.map((c) => [c.id, initial(c)])));
  const [busy, setBusy] = useState(false);

  const payload = () =>
    Object.fromEntries(table.schema.columns.map((c) => [c.id, c.type === 'datetime' && values[c.id] ? (localInputToIso(values[c.id]) ?? values[c.id]) : values[c.id] === '' ? null : values[c.id]]));
  const run = async (action: 'save' | 'delete') => {
    setBusy(true);
    try {
      if (action === 'delete' && row) await api.del(`/tables/${table.id}/rows/${row.id}`);
      else if (row) await api.patch(`/tables/${table.id}/rows/${row.id}`, { values: payload() });
      else await api.post(`/tables/${table.id}/rows`, { values: payload() });
      await refresh('rows', 'query', 'tables', 'trash');
      toast(action === 'delete' ? '휴지통으로 보냈습니다' : '저장했습니다');
      onDone();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-x-2 gap-y-3">
          {table.schema.columns.map((c) => (
            <Field key={c.id} label={`${c.name} · ${COLUMN_TYPE_LABEL[c.type]}`}>
              {c.type === 'boolean' ? (
                <select className={inputClass} value={values[c.id]} onChange={(e) => setValues({ ...values, [c.id]: e.target.value })}>
                  <option value="">(비움)</option>
                  <option value="true">예</option>
                  <option value="false">아니오</option>
                </select>
              ) : (
                <input
                  className={inputClass}
                  type={c.type === 'date' ? 'date' : c.type === 'datetime' ? 'datetime-local' : 'text'}
                  inputMode={c.type === 'number' ? 'decimal' : undefined}
                  value={values[c.id]}
                  onChange={(e) => setValues({ ...values, [c.id]: e.target.value })}
                />
              )}
            </Field>
          ))}
        </div>
      </div>
      <div className="shrink-0 border-t border-rule p-4">
        <ButtonRow>
          {row ? (
            <Button icon="trash" tone="danger" disabled={busy} onClick={() => run('delete')}>
              삭제
            </Button>
          ) : (
            <Button icon="close" disabled={busy} onClick={onDone}>
              취소
            </Button>
          )}
          <Button icon={row ? 'save' : 'plus'} tone="primary" disabled={busy} onClick={() => run('save')}>
            {row ? '저장' : '추가'}
          </Button>
        </ButtonRow>
      </div>
    </div>
  );
}

function RowsTab({ table, startNew }: { table: TableDto; startNew?: boolean }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [page, setPage] = useState(1);
  const [colStart, setColStart] = useState(0);
  const [editing, setEditing] = useState<RowDto | 'new' | null>(startNew ? 'new' : null);
  const per = Math.max(1, Math.floor((size.height - HEAD) / CELL_ROW));
  const { data } = useRows(table.id, page, size.height > 0 ? per : 0);
  const total = data?.total ?? table.row_count;
  const lastPage = Math.max(1, Math.ceil(total / per));
  const maxCols = Math.max(1, Math.floor(size.width / 128));
  const first = Math.min(colStart, Math.max(0, table.schema.columns.length - maxCols));
  const cols = table.schema.columns.slice(first, first + maxCols);
  const template = { gridTemplateColumns: `repeat(${cols.length || 1}, minmax(0, 1fr))` };
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage]);

  if (editing) return <RowForm table={table} row={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
        <div className="grid h-9 items-center border-b border-rule bg-ground text-xs font-medium text-sub" style={template}>
          {cols.map((c) => (
            <span key={c.id} className={`truncate px-3 ${c.type === 'number' ? 'text-right' : ''}`}>
              {c.name}
            </span>
          ))}
        </div>
        {total === 0 ? (
          <Empty>행이 없습니다</Empty>
        ) : (
          (data?.rows ?? []).slice(0, per).map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={table.linked}
              onClick={() => setEditing(r)}
              className="grid h-10 w-full items-center border-b border-rule text-left text-sm enabled:hover:bg-ground disabled:cursor-default"
              style={template}
            >
              {cols.map((c) => {
                const failed = r.raw?.[c.id];
                return (
                  <span key={c.id} className={`truncate px-3 ${c.type === 'number' ? 'text-right tabular-nums' : ''} ${failed ? 'text-danger' : ''}`}>
                    {failed ? String(failed) : cellText(r.values[c.id], c.type)}
                  </span>
                );
              })}
            </button>
          ))
        )}
      </div>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-t border-rule pr-1 pl-3">
        {table.linked ? (
          <span className="truncate text-xs text-sub">연결된 표는 읽기 전용입니다</span>
        ) : (
          <button type="button" onClick={() => setEditing('new')} className="flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium whitespace-nowrap text-accent hover:bg-tint">
            <Icon name="plus" size={16} />행 추가
          </button>
        )}
        <span className="flex shrink-0 items-center text-xs text-sub">
          {table.schema.columns.length > maxCols && (
            <>
              <IconButton icon="prev" label="이전 열" size={36} disabled={first === 0} onClick={() => setColStart(first - 1)} />
              <span className="px-1 whitespace-nowrap">
                열 {first + 1}–{first + cols.length} / {table.schema.columns.length}
              </span>
              <IconButton icon="next" label="다음 열" size={36} disabled={first + maxCols >= table.schema.columns.length} onClick={() => setColStart(first + 1)} />
              <span className="mx-1 h-5 w-px bg-line" />
            </>
          )}
          <IconButton icon="prev" label="이전 쪽" size={36} disabled={page <= 1} onClick={() => setPage(page - 1)} />
          <span className="px-1 tabular-nums whitespace-nowrap">{total === 0 ? '0' : `${(page - 1) * per + 1}–${Math.min(total, page * per)} / ${count(total)}`}</span>
          <IconButton icon="next" label="다음 쪽" size={36} disabled={page >= lastPage} onClick={() => setPage(page + 1)} />
        </span>
      </div>
    </div>
  );
}

/** 저장한 뒤의 스키마 변경(LLM-13). 컬럼 ID는 그대로라 저장된 집계가 깨지지 않는다. */
function ColumnsTab({ table }: { table: TableDto }) {
  const toast = useApp((s) => s.toast);
  const [names, setNames] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; type: ColumnType }>({ name: '', type: 'text' });
  const [busy, setBusy] = useState(false);

  const patch = async (op: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await api.patch(`/tables/${table.id}/schema`, { ops: [op] });
      await refresh('tables', 'rows', 'query');
      toast(done);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const rename = (c: Column) => {
    const name = (names[c.id] ?? c.name).trim();
    if (name && name !== c.name) void patch({ op: 'rename', col_id: c.id, name }, '이름을 변경했습니다');
  };

  if (table.linked) {
    return (
      <div className="p-4">
        <Notice>연결된 표의 컬럼은 원본 시트를 따릅니다. 시트에서 고친 뒤 새로고침하세요.</Notice>
      </div>
    );
  }
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto p-4 ${busy ? 'pointer-events-none opacity-70' : ''}`}>
      <div className="grid gap-2 md:grid-cols-2">
        {table.schema.columns.map((c) => (
          <div key={c.id} className="flex min-w-0 items-center gap-1.5 rounded-[10px] border p-2">
            <input
              aria-label="컬럼 이름"
              className={`${rowInput} flex-1`}
              value={names[c.id] ?? c.name}
              maxLength={60}
              onChange={(e) => setNames({ ...names, [c.id]: e.target.value })}
              onBlur={() => rename(c)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <select
              aria-label="컬럼 타입"
              className={`${rowInput} w-[104px] shrink-0`}
              value={c.type}
              onChange={(e) => patch({ op: 'retype', col_id: c.id, type: e.target.value }, '타입을 변경했습니다')}
            >
              {COLUMN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COLUMN_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            {confirm === c.id ? (
              <button
                type="button"
                onClick={() => patch({ op: 'delete', col_id: c.id }, '컬럼을 삭제했습니다')}
                className="h-10 shrink-0 rounded-[10px] bg-danger px-2 text-xs font-bold whitespace-nowrap text-white"
              >
                삭제 확인
              </button>
            ) : (
              <IconButton icon="trash" label="컬럼 삭제" size={40} disabled={table.schema.columns.length <= 1} onClick={() => setConfirm(c.id)} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-[10px] bg-ground p-3">
        <p className="mb-2 text-xs font-medium text-sub">컬럼 추가</p>
        <div className="flex items-center gap-1.5">
          <input aria-label="새 컬럼 이름" placeholder="이름" className={`${rowInput} flex-1`} value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <select aria-label="새 컬럼 타입" className={`${rowInput} w-[104px] shrink-0`} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as ColumnType })}>
            {COLUMN_TYPES.map((t) => (
              <option key={t} value={t}>
                {COLUMN_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <IconButton
            icon="plus"
            label="컬럼 추가"
            size={40}
            active
            disabled={!draft.name.trim()}
            onClick={() => {
              void patch({ op: 'add', name: draft.name.trim(), type: draft.type }, '컬럼을 추가했습니다');
              setDraft({ name: '', type: 'text' });
            }}
          />
        </div>
      </div>
      <p className="mt-3 text-xs text-sub">타입을 변경하면 기존 값을 새 타입으로 다시 변환합니다. 변환하지 못한 칸은 값을 비우고 원문을 남기며, 표에서 빨간 글자로 보입니다.</p>
    </div>
  );
}

function TableSettingsTab({ table }: { table: TableDto }) {
  const { toast, closeAll, close } = useApp.getState();
  const [name, setName] = useState(table.name);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const structureChanged = table.linked && !!table.last_error?.includes('구조');

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh('tables', 'rows', 'query', 'board', 'connectors', 'notifications', 'trash');
      if (done) toast(done);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const sync = (accept: boolean) =>
    act(async () => {
      const result = await api.post<{ status: string; message?: string }>(`/connectors/google-sheets/tables/${table.id}/sync`, { accept_structure: accept });
      if (result.status === 'synced') toast(table.form ? '설문 응답을 다시 읽었습니다' : '시트에서 다시 읽었습니다');
      else toast(result.message ?? '동기화하지 못했습니다', 'error');
    });

  return (
    <div className={`min-h-0 flex-1 space-y-4 overflow-y-auto p-4 ${busy ? 'pointer-events-none opacity-70' : ''}`}>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label="표 이름">
            <input className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <IconButton
          icon="save"
          label="이름 저장"
          active
          disabled={!name.trim() || name.trim() === table.name}
          onClick={() => act(() => api.patch(`/tables/${table.id}`, { name: name.trim() }), '이름을 변경했습니다')}
        />
      </div>

      <div className="rounded-[10px] border px-3">
        <Toggle
          label="LLM에 보내지 않음"
          on={table.llm_excluded}
          onChange={(on) => act(() => api.patch(`/tables/${table.id}`, { llm_excluded: on }), on ? 'AI가 이 표의 내용을 볼 수 없습니다' : 'AI가 이 표를 조회할 수 있습니다')}
        />
      </div>
      <p className="-mt-2 text-xs text-sub">켜면 AI에는 표 이름만 알려 주고, 컬럼과 행은 보내지 않습니다.</p>

      {table.linked && table.form && (
        <div className="space-y-2 rounded-[10px] border p-3">
          <div className="flex items-center gap-2">
            <Icon name="link" className="text-accent" />
            <span className="min-w-0 flex-1 truncate text-sm font-bold">Google 설문과 연결됨 · 응답은 읽기 전용</span>
            <Tag>{table.last_synced_at ? `읽은 때 ${shortWhen(table.last_synced_at)}` : '아직 읽기 전'}</Tag>
          </div>
          {table.last_error && <Notice tone="danger">{table.last_error}</Notice>}
          {!table.form.public_link && <Notice>링크만으로 응답할 수 있게 여는 데 실패했습니다. 설문지의 게시 설정에서 응답자를 확인하세요.</Notice>}
          <Field label="응답 링크 — 응답받을 사람에게 보내는 주소">
            <input className={inputClass} readOnly value={table.form.responder_uri} onFocus={(e) => e.target.select()} />
          </Field>
          <ButtonRow>
            <Button
              icon="paste"
              onClick={() =>
                navigator.clipboard.writeText(table.form!.responder_uri).then(
                  () => toast('응답 링크를 복사했습니다'),
                  () => toast('복사하지 못했습니다. 주소를 눌러 직접 복사하세요', 'error'),
                )
              }
            >
              링크 복사
            </Button>
            <Button icon="refresh" onClick={() => sync(false)}>
              응답 다시 읽기
            </Button>
          </ButtonRow>
          <p className="flex gap-4 text-xs">
            <a className="text-accent underline" href={table.form.responder_uri} target="_blank" rel="noopener noreferrer">
              설문 열어 보기
            </a>
            <a className="text-accent underline" href={table.form.edit_uri} target="_blank" rel="noopener noreferrer">
              Google 에서 설문지 고치기
            </a>
          </p>
          <p className="text-xs text-sub">응답은 15분마다 다시 읽습니다. 설문지에서 질문을 더하면 표에 열이 생깁니다. 이 표를 지워도 Google 설문지는 드라이브에 남습니다.</p>
        </div>
      )}

      {table.linked && !table.form && (
        <div className="space-y-2 rounded-[10px] border p-3">
          <div className="flex items-center gap-2">
            <Icon name="sheet" className="text-accent" />
            <span className="min-w-0 flex-1 truncate text-sm font-bold">Google 시트와 연결됨 · 읽기 전용</span>
            <Tag>{table.last_synced_at ? `동기화 ${shortWhen(table.last_synced_at)}` : '아직 동기화 전'}</Tag>
          </div>
          {table.last_error && <Notice tone="danger">{table.last_error}</Notice>}
          <ButtonRow>
            <Button icon="refresh" onClick={() => sync(false)}>
              지금 새로고침
            </Button>
            <Button icon="check" tone={structureChanged ? 'primary' : 'ghost'} disabled={!structureChanged} onClick={() => sync(true)}>
              새 구조로 다시 연결
            </Button>
          </ButtonRow>
        </div>
      )}

      {confirmDelete && <Notice tone="danger">표와 행을 휴지통으로 보냅니다. 30일 안에 복구할 수 있습니다.</Notice>}
      <ButtonRow>
        <Button
          icon="trash"
          tone="danger"
          onClick={() =>
            confirmDelete
              ? act(async () => {
                  await api.del(`/tables/${table.id}`);
                  close();
                }, '휴지통으로 보냈습니다')
              : setConfirmDelete(true)
          }
        >
          {confirmDelete ? '삭제 확인' : '표 삭제'}
        </Button>
        <Button
          icon="grid"
          tone="primary"
          onClick={() =>
            act(async () => {
              await placeOnBoard(table);
              closeAll();
            }, '보드에 놓았습니다')
          }
        >
          보드에 배치
        </Button>
      </ButtonRow>
    </div>
  );
}

/**
 * 명단 대조(2026-11-28 세 모델 토론 4번): 명단을 붙여 넣고 이름 칸을 고르면 미제출·중복·명단에 없는 응답을 보여 준다.
 * 명단은 이 기기(localStorage)에만 두고 서버·AI 로 보내지 않는다. 비교도 화면에서 한다(@jarvis/shared roster.ts).
 */
const rosterKey = (id: string) => `ssb-roster:${id}`;
function RosterTab({ table }: { table: TableDto }) {
  const toast = useApp((s) => s.toast);
  const cols = table.schema.columns;
  const guess = cols.find((c) => /이름|성명|name|학생|별명/i.test(c.name)) ?? cols.find((c) => c.type === 'text') ?? cols[0];
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(rosterKey(table.id)) ?? 'null') as { text: string; col: string } | null;
    } catch {
      return null;
    }
  })();
  const [text, setText] = useState(saved?.text ?? '');
  const [col, setCol] = useState(saved?.col && cols.some((c) => c.id === saved.col) ? saved.col : (guess?.id ?? ''));
  const [values, setValues] = useState<(string | null)[] | null>(null);
  const [busy, setBusy] = useState(false);
  const roster = parseRoster(text);

  const run = async () => {
    if (roster.length === 0) return toast('명단을 먼저 붙여 넣으세요', 'error');
    setBusy(true);
    try {
      const out: (string | null)[] = [];
      for (let page = 1; page <= 10; page++) {
        const r = await api.get<RowPage>(`/tables/${table.id}/rows?page=${page}&size=200`);
        out.push(...r.rows.map((row) => (row.values[col] === null || row.values[col] === undefined ? null : String(row.values[col]))));
        if (out.length >= r.total || r.rows.length === 0) break;
      }
      setValues(out);
      try {
        localStorage.setItem(rosterKey(table.id), JSON.stringify({ text, col }));
      } catch {
        /* 저장 못 해도 대조는 된다 */
      }
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const result = values ? compareRoster(roster, values) : null;
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 pt-1" data-roster>
      <p className="text-sm text-sub">
        명단을 붙여 넣고 [대조]를 누르면 안 낸 사람을 찾아요. 명단은 <b>이 기기에만</b> 저장되고 서버·AI 로 보내지 않아요.
        {table.last_synced_at ? ` 응답은 ${shortWhen(table.last_synced_at)} 기준이에요.` : ''}
      </p>
      <div className="grid gap-3 md:grid-cols-[1fr_14rem]">
        <Field label={`명단 (${roster.length}명)`} hint="한 줄에 한 명, 또는 쉼표로. 번호는 있어도 돼요(예: 12 김민수).">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className={`${inputClass} h-auto py-2`} placeholder={'김민수\n이서연\n박지훈'} />
        </Field>
        <div className="space-y-2">
          <Field label="응답의 이름 칸">
            <select value={col} onChange={(e) => setCol(e.target.value)} className={inputClass}>
              {cols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Button icon="check" tone="primary" disabled={busy || !col} onClick={() => void run()}>
            {busy ? '대조 중…' : '대조'}
          </Button>
        </div>
      </div>
      {result && (
        <div className="space-y-2" data-roster-result>
          <p className="text-base font-bold">
            {roster.length}명 중 낸 사람 {result.submitted.length}명 · <span className={result.missing.length ? 'text-danger' : ''}>안 낸 사람 {result.missing.length}명</span>
          </p>
          {result.missing.length > 0 && (
            <div className="rounded-lg border border-danger/40 p-2.5">
              <p className="text-xs font-bold text-danger">안 낸 사람</p>
              <p className="mt-1 text-sm leading-relaxed">{result.missing.join(', ')}</p>
              <Button
                icon="paste"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(result.missing.join(', '))
                    .then(() => toast('안 낸 사람 이름을 복사했어요'))
                    .catch(() => window.prompt('복사하세요', result.missing.join(', ')))
                }
              >
                이름 복사
              </Button>
            </div>
          )}
          {result.duplicates.length > 0 && <Notice tone="info">두 번 이상 낸 사람: {result.duplicates.map((d) => `${d.name}(${d.count})`).join(', ')}</Notice>}
          {result.unmatched.length > 0 && <Notice tone="info">명단에 없는 응답(오타·별명일 수 있어요, 직접 확인): {result.unmatched.join(', ')}</Notice>}
        </div>
      )}
    </div>
  );
}

/** addRow: 메뉴의 '표에 한 줄 넣기'로 열면 바로 새 줄 칸 */
export function TablePanel({ tableId, addRow, startTab }: { tableId: string; addRow?: boolean; startTab?: DetailTab }) {
  const close = useApp((s) => s.close);
  const { table, isLoading } = useTable(tableId);
  const [tab, setTab] = useState<DetailTab>(startTab ?? 'rows');
  if (!table) {
    if (isLoading) return null;
    return (
      <Sheet title="표" icon="table" onClose={close}>
        <Empty>표가 없습니다. 휴지통을 확인하세요.</Empty>
      </Sheet>
    );
  }
  return (
    <Sheet title={table.name} icon={table.linked ? 'sheet' : 'table'} onClose={close} width={880} tall flush>
      <div className="shrink-0 p-3 pb-2">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'rows', label: `행 ${count(table.row_count)}`, icon: 'table' },
            { id: 'columns', label: `컬럼 ${table.schema.columns.length}`, icon: 'edit' },
            { id: 'roster', label: '명단 대조', icon: 'check' },
            { id: 'settings', label: '설정', icon: 'settings' },
          ]}
        />
      </div>
      {tab === 'roster' && <RosterTab table={table} />}
      {tab === 'rows' && <RowsTab table={table} startNew={addRow} />}
      {tab === 'columns' && <ColumnsTab table={table} />}
      {tab === 'settings' && <TableSettingsTab table={table} />}
    </Sheet>
  );
}

// ── 미리보기 → 저장 (파일·시트 공통) ───────────────────────────

interface Draft {
  header: string[];
  sample: string[][];
  total: number;
  edit: TableEdit;
}

function draftOf(name: string, data: { header: string[]; guess: ColumnType[]; sample: string[][]; total: number }): Draft {
  return { header: data.header, sample: data.sample, total: data.total, edit: { name, columns: data.header.map((h, i) => ({ name: h || `열 ${i + 1}`, type: data.guess[i] ?? 'text' })) } };
}
const previewOf = (d: Draft): TablePreview => ({ name: d.edit.name, columns: d.edit.columns, rows: d.sample, total: d.total });

// ── 파일 올리기 ───────────────────────────────────────────────

export function UploadPanel() {
  const { close, closeAll, toast } = useApp.getState();
  const { data: tables = [] } = useTables();
  const file = useRef<HTMLInputElement>(null);
  const [uploadId, setUploadId] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [target, setTarget] = useState('new');
  const [place, setPlace] = useState(true);
  const [busy, setBusy] = useState('');
  const appendable = tables.filter((t) => !t.linked);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return toast('파일은 10MB까지 올릴 수 있습니다', 'error');
    setBusy('파일을 읽는 중입니다');
    try {
      const form = new FormData();
      form.append('file', f);
      const data = await api.post<{ upload_id: string; filename: string; header: string[]; guess: ColumnType[]; sample: string[][]; total: number }>('/uploads', form);
      setUploadId(data.upload_id);
      setDraft(draftOf(data.filename.replace(/\.[^.]+$/, ''), data));
    } catch (e) {
      fail(e);
    } finally {
      setBusy('');
      if (file.current) file.current.value = '';
    }
  };

  const suggest = async () => {
    if (!draft) return;
    setBusy('AI가 컬럼을 살펴보는 중입니다');
    try {
      const s = await api.post<{ table_name: string; columns: { name: string; type: ColumnType }[]; similar_table_id: string | null }>(`/uploads/${uploadId}/suggest`);
      setDraft({ ...draft, edit: { name: s.table_name, columns: s.columns } });
      if (s.similar_table_id) {
        setTarget(s.similar_table_id);
        toast('비슷한 표가 있어 "기존 표에 추가"를 골랐습니다. 새 표로 바꿀 수 있습니다.');
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy('저장하는 중입니다');
    try {
      if (target !== 'new') {
        const r = await api.post<{ added: number; unmatched: string[] }>(`/tables/${target}/append`, { upload_id: uploadId });
        toast(r.unmatched.length > 0 ? `${count(r.added)}행을 더했습니다 · 맞는 컬럼이 없어 뺀 열: ${r.unmatched.join(', ')}` : `${count(r.added)}행을 더했습니다`);
      } else {
        const r = await api.post<{ table: TableDto; failures: Record<string, number> }>('/tables', {
          name: draft.edit.name,
          upload_id: uploadId,
          columns: draft.edit.columns.map((c, i) => ({ ...c, source: i })),
        });
        if (place) await placeOnBoard(r.table);
        const failed = Object.values(r.failures).reduce((a, b) => a + b, 0);
        toast(failed > 0 ? `표를 만들었습니다 · 변환하지 못한 칸 ${count(failed)}개는 원문을 남겼습니다` : '표를 만들었습니다');
      }
      await refresh('tables', 'rows', 'query', 'board');
      closeAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy('');
    }
  };

  return (
    <Sheet
      title="파일 올리기"
      icon="upload"
      onClose={close}
      width={720}
      tall={!!draft}
      footer={
        draft ? (
          <ButtonRow>
            <Button icon="sparkle" disabled={!!busy || target !== 'new'} onClick={suggest}>
              AI 컬럼 제안
            </Button>
            <Button icon="save" tone="primary" disabled={!!busy} onClick={save}>
              저장
            </Button>
          </ButtonRow>
        ) : undefined
      }
    >
      <input ref={file} type="file" accept=".csv,.tsv,.txt,.xlsx" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {!draft ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Icon name="upload" size={32} className="text-accent" />
          <p className="text-sm">CSV 또는 XLSX 파일 · 최대 10MB</p>
          <p className="text-xs text-sub">서버가 파일을 읽어 미리보기를 보여 줍니다. 저장하기 전에는 표가 만들어지지 않습니다.</p>
          <Button icon="upload" tone="primary" className="min-w-40" disabled={!!busy} onClick={() => file.current?.click()}>
            {busy || '파일 고르기'}
          </Button>
        </div>
      ) : (
        <div className={`space-y-3 ${busy ? 'pointer-events-none opacity-70' : ''}`}>
          {busy && <Notice>{busy}</Notice>}
          <div className="grid grid-cols-2 gap-2">
            <Field label="저장할 곳">
              <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="new">새 표 만들기</option>
                {appendable.map((t) => (
                  <option key={t.id} value={t.id}>
                    기존 표에 추가: {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <div className="w-full rounded-[10px] border px-3">
                <Toggle label="보드에 배치" on={place && target === 'new'} disabled={target !== 'new'} onChange={setPlace} />
              </div>
            </div>
          </div>
          {target !== 'new' ? (
            <Notice>머리글 이름이 같은 컬럼끼리 맞춰 행을 더합니다. 맞는 컬럼이 없는 열은 뺍니다.</Notice>
          ) : (
            <div className="overflow-hidden rounded-[10px] border [&>div]:border-t-0">
              <PreviewEditor preview={previewOf(draft)} edit={draft.edit} locked={false} onChange={(edit) => setDraft({ ...draft, edit })} />
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ── Google 시트 ───────────────────────────────────────────────

let pickerApi: Promise<void> | null = null;
/** Google Picker 스크립트를 처음 쓸 때 한 번만 불러온다. CSP에서 이 출처만 예외로 허용한다. */
function loadPickerApi(): Promise<void> {
  pickerApi ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = () => (window as any).gapi.load('picker', { callback: () => resolve(), onerror: () => reject(new Error('Google Picker를 불러오지 못했습니다.')) });
    script.onerror = () => {
      pickerApi = null;
      reject(new Error('Google Picker를 불러오지 못했습니다.'));
    };
    document.head.appendChild(script);
  });
  return pickerApi;
}

/** 사용자가 고른 스프레드시트 하나만 돌려준다(GSH-1). 드라이브 전체를 읽지 않는다. */
async function pickSpreadsheet(connectorId: string): Promise<{ id: string; name: string } | null> {
  const cfg = await api.post<{ access_token: string; api_key: string; app_id: string }>(`/connectors/${connectorId}/picker`);
  await loadPickerApi();
  const g = (window as any).google.picker;
  return new Promise((resolve) => {
    new g.PickerBuilder()
      .addView(g.ViewId.SPREADSHEETS)
      .setOAuthToken(cfg.access_token)
      .setDeveloperKey(cfg.api_key)
      .setAppId(cfg.app_id)
      .setLocale('ko')
      .setCallback((data: any) => {
        if (data.action === g.Action.PICKED) resolve({ id: data.docs[0].id, name: data.docs[0].name });
        else if (data.action === g.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

export function SheetPanel({ connectorId }: { connectorId: string }) {
  const { close, closeAll, toast } = useApp.getState();
  const [sheet, setSheet] = useState<{ id: string; name: string } | null>(null);
  const [tabs, setTabs] = useState<{ title: string; rows: number; cols: number }[]>([]);
  const [tab, setTab] = useState('');
  const [range, setRange] = useState('');
  const [mode, setMode] = useState<'copy' | 'linked'>('linked');
  const [minutes, setMinutes] = useState(15);
  const [place, setPlace] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState('');

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy('');
    }
  };
  const choose = () =>
    run('Google에서 시트를 고르는 중입니다', async () => {
      const picked = await pickSpreadsheet(connectorId);
      if (!picked) return;
      const meta = await api.get<{ name: string; tabs: { title: string; rows: number; cols: number }[] }>(`/connectors/${connectorId}/sheets/${picked.id}`);
      setSheet({ id: picked.id, name: meta.name || picked.name });
      setTabs(meta.tabs);
      setTab(meta.tabs[0]?.title ?? '');
      setDraft(null);
    });
  const body = () => ({ connector_id: connectorId, spreadsheet_id: sheet!.id, tab, range: range.trim() || null });
  const preview = () =>
    run('시트를 읽는 중입니다', async () => {
      const data = await api.post<{ header: string[]; guess: ColumnType[]; sample: string[][]; total: number }>('/connectors/google-sheets/preview', body());
      setDraft(draftOf(`${sheet!.name} · ${tab}`, data));
    });
  const save = () =>
    run('저장하는 중입니다', async () => {
      const r = await api.post<{ table: TableDto }>('/connectors/google-sheets/link', { ...body(), mode, name: draft!.edit.name, sync_minutes: minutes, columns: draft!.edit.columns });
      if (place) await placeOnBoard(r.table);
      await refresh('tables', 'board', 'connectors');
      toast(mode === 'linked' ? `연결했습니다 · ${minutes}분마다 다시 읽습니다` : '가져왔습니다');
      closeAll();
    });

  return (
    <Sheet
      title="Google 시트"
      icon="sheet"
      onClose={close}
      width={720}
      tall={!!sheet}
      footer={
        sheet ? (
          <ButtonRow>
            <Button icon="refresh" disabled={!!busy || !tab} onClick={preview}>
              미리보기
            </Button>
            <Button icon="save" tone="primary" disabled={!!busy || !draft} onClick={save}>
              저장
            </Button>
          </ButtonRow>
        ) : undefined
      }
    >
      {!sheet ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Icon name="sheet" size={32} className="text-accent" />
          <p className="text-sm">가져올 스프레드시트를 고르세요</p>
          <p className="text-xs text-sub">쌤보드는 여기서 고른 파일만 읽을 수 있습니다. 드라이브의 다른 파일에는 접근하지 않고, 시트에 쓰지도 않습니다.</p>
          <Button icon="sheet" tone="primary" className="min-w-40" disabled={!!busy} onClick={choose}>
            {busy || '시트 고르기'}
          </Button>
        </div>
      ) : (
        <div className={`space-y-3 ${busy ? 'pointer-events-none opacity-70' : ''}`}>
          {busy && <Notice>{busy}</Notice>}
          <div className="flex items-center gap-2 rounded-[10px] border py-1 pr-1 pl-3">
            <Icon name="sheet" className="text-accent" />
            <span className="min-w-0 flex-1 truncate text-sm font-bold">{sheet.name}</span>
            <IconButton icon="refresh" label="다른 시트 고르기" onClick={choose} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="탭">
              <select
                className={inputClass}
                value={tab}
                onChange={(e) => {
                  setTab(e.target.value);
                  setDraft(null);
                }}
              >
                {tabs.map((t) => (
                  <option key={t.title} value={t.title}>
                    {t.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="범위 (비우면 탭 전체)">
              <input
                className={inputClass}
                placeholder="A1:F200"
                value={range}
                onChange={(e) => {
                  setRange(e.target.value);
                  setDraft(null);
                }}
              />
            </Field>
            <Field label="방식">
              <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as 'copy' | 'linked')}>
                <option value="linked">연결된 표 (주기적으로 다시 읽기)</option>
                <option value="copy">가져오기 (지금 한 번 복사)</option>
              </select>
            </Field>
            <Field label="다시 읽는 주기">
              <select className={inputClass} value={minutes} disabled={mode !== 'linked'} onChange={(e) => setMinutes(Number(e.target.value))}>
                {[5, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m}분마다
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="rounded-[10px] border px-3">
            <Toggle label="보드에 배치" on={place} onChange={setPlace} />
          </div>
          {draft ? (
            <div className="overflow-hidden rounded-[10px] border [&>div]:border-t-0">
              <PreviewEditor preview={previewOf(draft)} edit={draft.edit} locked={false} onChange={(edit) => setDraft({ ...draft, edit })} />
            </div>
          ) : (
            <Notice>"미리보기"를 눌러 컬럼 이름과 타입을 확인한 뒤 저장하세요. 연결된 표는 앱에서 읽기 전용입니다.</Notice>
          )}
        </div>
      )}
    </Sheet>
  );
}
