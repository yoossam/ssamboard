import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkDraft, MenusService, RECOMMEND_SCHEMA } from '../src/menus/menus.service';

const base = { label: '메뉴', icon: 'sparkle', description: '', action_type: 'ask_ai', prompt: null, url: null, panel: null, table_id: null, new_table: null, reason: '' };

/** 구조화 출력 규칙: 모든 object 에 additionalProperties:false, required 는 properties 전부 */
function walk(node: any, path = '$'): string[] {
  const bad: string[] = [];
  if (node && typeof node === 'object') {
    if (node.type === 'object') {
      if (node.additionalProperties !== false) bad.push(`${path}: additionalProperties`);
      const keys = Object.keys(node.properties ?? {});
      if (JSON.stringify([...(node.required ?? [])].sort()) !== JSON.stringify(keys.sort())) bad.push(`${path}: required`);
    }
    for (const [k, v] of Object.entries(node)) bad.push(...walk(v, `${path}.${k}`));
  }
  return bad;
}

describe('내 메뉴 — 틀 검사와 AI 추천', () => {
  it('추천 답 모양은 구조화 출력 규칙을 지킨다', () => {
    assert.deepEqual(walk(RECOMMEND_SCHEMA), []);
  });

  it('틀에 맞게 바로잡거나 거부한다', () => {
    const own = new Set(['t1']);
    assert.deepEqual(checkDraft({ ...base, label: '  아주 아주 긴 메뉴 이름이 넘치는 경우입니다 ', icon: 'nope', prompt: '정리해 줘' }, own), {
      label: '아주 아주 긴 메뉴 이름이 넘치는 경우입니다'.slice(0, 16),
      icon: 'sparkle',
      description: '',
      action: { type: 'ask_ai', prompt: '정리해 줘' },
      new_table: null,
    });
    assert.deepEqual(checkDraft({ ...base, action_type: 'add_row', table_id: 't1' }, own).action, { type: 'add_row', table_id: 't1' });
    // 남의 표 id 는 쓰지 않고 새 표가 없으면 거부
    assert.throws(() => checkDraft({ ...base, action_type: 'open_table', table_id: 'other' }, own), /열 표가 없습니다/);
    assert.throws(() => checkDraft({ ...base, action_type: 'link', url: 'http://example.com' }, own), /https/);
    assert.throws(() => checkDraft({ ...base, action_type: 'open_panel', panel: 'admin' }, own), /열 화면이 없습니다/);
    assert.throws(() => checkDraft({ ...base, prompt: '   ' }, own), /보낼 말이 없습니다/);
    const t = checkDraft({ ...base, action_type: 'add_row', new_table: { name: '출결', columns: [{ name: '날짜', type: 'date' }, { name: '날짜', type: 'text' }, { name: '사유', type: 'weird' }] } }, own);
    assert.deepEqual(t.new_table, { name: '출결', columns: [{ name: '날짜', type: 'date' }, { name: '사유', type: 'text' }] });
  });

  it('사용자 열쇠의 AI 에게 틀·기존 표를 주고, 틀에 맞는 추천만 돌려준다', async () => {
    const seen: any[] = [];
    const fakeLlm = {
      context: async () => ({
        model: 'm',
        apiKey: 'k',
        adapter: {
          json: async (req: any) => {
            seen.push(req);
            return {
              data: {
                summary: '상담과 출결 정리',
                menus: [
                  { ...base, label: '상담 기록 추가', action_type: 'add_row', new_table: { name: '상담 기록', columns: [{ name: '학생', type: 'text' }] }, reason: '자주 적음' },
                  { ...base, label: '출석부', action_type: 'open_table', table_id: 't1', reason: '있는 표' },
                  { ...base, label: '나쁜 링크', action_type: 'link', url: 'javascript:alert(1)' },
                ],
              },
              usage: { input_tokens: 1, output_tokens: 1 },
            };
          },
        },
      }),
      record: async () => undefined,
    };
    const fakeTables = { list: async () => [{ id: 't1', name: '출석부', llm_excluded: false, schema: { columns: [{ name: '이름', type: 'text' }] } }] };
    const fakeDb = { query: async () => [] };
    const svc = new MenusService(fakeDb as any, fakeLlm as any, fakeTables as any);
    const r = await svc.recommend({ id: 'u' } as any, '상담이랑 출결 관리하고 싶어');
    assert.equal(r.summary, '상담과 출결 정리');
    assert.deepEqual(
      r.menus.map((m) => [m.label, m.action_type, m.table_id, m.new_table?.name ?? null]),
      [
        ['상담 기록 추가', 'add_row', null, '상담 기록'],
        ['출석부', 'open_table', 't1', null],
      ],
    );
    assert.match(seen[0].system, /ask_ai/);
    assert.match(seen[0].user, /<request>\n상담이랑 출결 관리하고 싶어/);
    assert.match(seen[0].user, /"id":"t1"/);
    await assert.rejects(svc.recommend({ id: 'u' } as any, '  '), /적어 주세요/);
  });
});
