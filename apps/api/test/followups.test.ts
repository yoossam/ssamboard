import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { followUps, type CommandDto } from '@jarvis/shared';

const base: CommandDto = { id: 'c', status: 'applied', steps: [{ index: 0, tool: 'edit_file', title: '파일 고치기', detail: '' }] };
const now = Date.parse('2026-11-28T10:00:00Z');

describe('완료 뒤 남은 일', () => {
  it('승인 대기는 승인만', () => {
    assert.deepEqual(
      followUps({ ...base, status: 'proposed' }, now).map((f) => f.kind),
      ['approve'],
    );
  });
  it('안 받은 파일만 남은 일 — 받았거나 기한이 지났거나 지워진 것은 빼기', () => {
    const files = [
      { id: 'a', name: '새.xlsx', expires_at: '2026-11-29T00:00:00Z' },
      { id: 'b', name: '받음.xlsx', expires_at: '2026-11-29T00:00:00Z', downloaded: true },
      { id: 'c', name: '지남.xlsx', expires_at: '2026-11-27T00:00:00Z' },
      { id: 'd', name: '지움.xlsx', gone: true },
    ];
    assert.deepEqual(
      followUps({ ...base, files }, now).map((f) => f.file_id),
      ['a'],
    );
  });
  it('드라이브 사본 공유·구글 설문·못 한 것', () => {
    const r = followUps(
      {
        ...base,
        steps: [{ index: 0, tool: 'create_form', title: '설문', detail: '' }],
        shares: [
          { id: 's1', title: '할 일', url: 'https://docs.google.com/x', revoked: false, snapshot: true },
          { id: 's2', title: '일정', url: 'https://example.com/s/x', revoked: false, snapshot: false },
        ],
        skipped: ['표 줄 넣기'],
      },
      now,
    );
    assert.deepEqual(
      r.map((f) => f.kind),
      ['snapshot', 'external', 'retry'],
    );
    assert.match(r[2].prompt ?? '', /표 줄 넣기/);
  });
  it('되돌린 설문은 구글에 남았다고 알린다, 취소는 없음', () => {
    assert.match(followUps({ ...base, status: 'undone', steps: [{ index: 0, tool: 'create_form', title: '', detail: '' }] }, now)[0].text, /남아 있어요/);
    assert.deepEqual(followUps({ ...base, status: 'cancelled' }, now), []);
  });
});
