import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateQuery, type TableSchema } from '@jarvis/shared';
import { deviceName, isIdleLocked, pinFailure, secondsLeft } from '../src/auth/lock';
import { decrypt, encrypt, hmac, safeEqual, signState, verifyState } from '../src/common/crypto';
import { RateLimiter } from '../src/common/rate-limit';
import { buildQuerySql, toQueryResult } from '../src/tables/query-sql';
import { imageBlocks, MAX_IMAGES } from '../src/ai/ai.service';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('암호화 (USR-2a, CON-3)', () => {
  it('AES-256-GCM으로 암호화하고 되돌린다', () => {
    const token = encrypt('sk-ant-비밀-1234', KEY);
    assert.match(token, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.notEqual(token, encrypt('sk-ant-비밀-1234', KEY));
    assert.equal(decrypt(token, KEY), 'sk-ant-비밀-1234');
  });
  it('변조된 암호문과 다른 키를 거부한다', () => {
    const token = encrypt('secret', KEY);
    const parts = token.split('.');
    parts[3] = Buffer.from('other!').toString('base64url');
    assert.throws(() => decrypt(parts.join('.'), KEY));
    assert.throws(() => decrypt(token, Buffer.alloc(32, 8).toString('base64')));
    assert.throws(() => encrypt('x', 'short'));
  });
  it('서명한 state는 변조·만료를 걸러낸다', () => {
    const state = signState({ kind: 'login', nonce: 'n1' }, KEY);
    assert.equal(verifyState<{ nonce: string }>(state, KEY)?.nonce, 'n1');
    assert.equal(verifyState(state + 'x', KEY), null);
    assert.equal(verifyState(state, 'other-secret'), null);
    assert.equal(verifyState(state, KEY, -1), null);
    assert.equal(verifyState('', KEY), null);
    assert.ok(safeEqual(hmac('a', 'k'), hmac('a', 'k')));
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
  });
});

describe('잠금 판정 (AUTH-5·7)', () => {
  const now = new Date('2026-11-25T10:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  it('잠금 시간이 지나면 잠긴다', () => {
    assert.equal(isIdleLocked(ago(9.9), 10, now), false);
    assert.equal(isIdleLocked(ago(10), 10, now), true);
    assert.equal(isIdleLocked(ago(600), 0, now), false);
  });
  it('남은 시간을 초로 알려 준다', () => {
    assert.equal(secondsLeft(ago(9), 10, now), 60);
    assert.equal(secondsLeft(ago(30), 10, now), 0);
    assert.equal(secondsLeft(ago(1), 0, now), null);
  });
  it('PIN을 5번 틀리면 모든 세션을 끝내고 15분 막는다', () => {
    assert.deepEqual(pinFailure(1, now), { failCount: 1, lockedUntil: null, revokeAll: false, attemptsLeft: 4 });
    assert.equal(pinFailure(4, now).attemptsLeft, 1);
    const fifth = pinFailure(5, now);
    assert.equal(fifth.revokeAll, true);
    assert.equal(fifth.failCount, 0);
    assert.equal(fifth.lockedUntil?.toISOString(), '2026-11-25T10:15:00.000Z');
  });
  it('기기 이름을 User-Agent에서 뽑는다', () => {
    assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), 'iPhone · Safari');
    assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'), 'Windows · Chrome');
    assert.equal(deviceName('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36'), 'Android · Samsung Internet');
    assert.equal(deviceName(''), '알 수 없는 기기');
  });
  it('속도 제한은 창 안의 횟수만 센다', () => {
    const limiter = new RateLimiter(2, 1000);
    assert.equal(limiter.allow('a', 0), true);
    assert.equal(limiter.allow('a', 10), true);
    assert.equal(limiter.allow('a', 20), false);
    assert.equal(limiter.allow('b', 20), true);
    assert.equal(limiter.allow('a', 1500), true);
  });
});

describe('조회·집계 SQL 만들기 (4.4)', () => {
  const schema: TableSchema = {
    columns: [
      { id: 'c_1', name: '거래처', type: 'text' },
      { id: 'c_2', name: '상태', type: 'select' },
      { id: 'c_3', name: '금액', type: 'number' },
      { id: 'c_4', name: '날짜', type: 'date' },
    ],
  };
  const build = (q: unknown) => {
    const v = validateQuery(q, schema);
    assert.ok(v.ok, v.ok ? '' : v.error);
    return buildQuerySql('table-id', 'user-id', v.spec, schema);
  };
  it('값과 컬럼 ID는 모두 파라미터로 넘긴다', () => {
    const b = build({
      filter: [{ col_id: 'c_2', op: 'eq', value: "미수'; drop table users; --" }],
      group_by: [{ col_id: 'c_4', bucket: 'month' }],
      agg: [{ col_id: 'c_3', fn: 'sum' }],
    });
    assert.equal(b.mode, 'agg');
    assert.ok(!b.sql.includes('drop table'));
    assert.ok(!b.sql.includes('c_2'));
    assert.deepEqual(b.params.slice(0, 2), ['table-id', 'user-id']);
    assert.ok(b.params.includes("미수'; drop table users; --"));
    assert.match(b.sql, /group by to_char\(date_trunc\('month'/);
    assert.deepEqual(b.columns.map((c) => c.label), ['날짜 (월)', '금액 합계']);
  });
  it('집계가 없으면 행을 그대로 돌려준다', () => {
    const b = build({ filter: [{ col_id: 'c_1', op: 'contains', value: '50%_상사' }], sort: [{ col_id: 'c_3', dir: 'desc' }], limit: 5 });
    assert.equal(b.mode, 'rows');
    assert.ok(b.params.includes('%50\\%\\_상사%'));
    assert.match(b.sql, /order by .*::numeric desc nulls last, r\.position asc limit 5$/);
    const result = toQueryResult(b, [{ id: 'r1', data: { c_1: '가나상사', c_3: 1200 } }]);
    assert.deepEqual(result.rows, [['가나상사', null, 1200, null]]);
  });
  it('집계 결과로 정렬할 수 있다', () => {
    const b = build({ group_by: ['c_2'], agg: [{ fn: 'count' }, { col_id: 'c_3', fn: 'avg' }], sort: [{ agg: 1, dir: 'desc' }] });
    assert.match(b.sql, /order by a1 desc nulls last limit 100$/);
    assert.deepEqual(toQueryResult(b, [{ g0: '미수', a0: 3, a1: 1033333.3 }]).rows, [['미수', 3, 1033333.3]]);
  });
});

// ── AI 창 이미지 첨부(2026-11-27) ─────────────────────────────────────────────
describe('AI 창 이미지 첨부', () => {
  it('맞는 모양만 Claude 이미지 블록으로 바꾸고, 틀리면 조용히 빼지 않고 거절한다', () => {
  const png = Buffer.from('fake-png-bytes').toString('base64');
  assert.deepEqual(imageBlocks(undefined), []);
  assert.deepEqual(imageBlocks([{ media_type: 'image/jpeg', data: png }]), [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: png } },
  ]);
  const one = { media_type: 'image/png', data: png };
  assert.throws(() => imageBlocks(Array(MAX_IMAGES + 1).fill(one)), /한 번에 4장/);
  assert.throws(() => imageBlocks([{ media_type: 'image/svg+xml', data: png }]), /JPG·PNG·WEBP·GIF/);
  assert.throws(() => imageBlocks([{ media_type: 'image/png', data: 'data:image/png;base64,AAAA' }]), /읽을 수 없습니다/);
  assert.throws(() => imageBlocks([{ media_type: 'image/png', data: 'A'.repeat(4_000_004) }]), /너무 크거나/);
  assert.throws(() => imageBlocks('nope'), /형식이 올바르지/);
});
});
