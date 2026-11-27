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

// ── AI 창 첨부 파일·구글 링크(2026-11-27) ─────────────────────────────────────
import JSZip from 'jszip';
import { exportUrl, findGoogleLinks, readAttachments, readGoogleLink } from '../src/ai/attachments';

const zipB64 = async (files: Record<string, string>) => {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
};
const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('AI 창 첨부 파일', () => {
  it('PDF 는 문서 블록으로, 글·워드·한글(HWPX)·파워포인트는 글로 바꾼다', async () => {
    const pdf = b64('%PDF-1.4 fake');
    const docx = await zipB64({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>가정통신문</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">12월 3일 &amp; 현장체험</w:t></w:r></w:p></w:body></w:document>' });
    const hwpx = await zipB64({ 'Contents/section0.xml': '<hs:sec><hp:p><hp:run><hp:t>학부모 상담 안내</hp:t></hp:run></hp:p></hs:sec>' });
    const pptx = await zipB64({ 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>1학기 계획</a:t></a:r></a:p></p:sld>' });
    const { pdfs, texts } = await readAttachments([
      { name: '공문.pdf', data: pdf },
      { name: '메모.txt', data: b64('준비물: 리코더') },
      { name: '안내.docx', data: docx },
      { name: '상담.hwpx', data: hwpx },
      { name: '계획.pptx', data: pptx },
    ]);
    assert.deepEqual(pdfs, [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf }, title: '공문.pdf' }]);
    assert.deepEqual(texts.map((t) => t.text), ['준비물: 리코더', '가정통신문\n12월 3일 & 현장체험', '학부모 상담 안내', '[슬라이드 1]\n1학기 계획']);
  });
  it('읽을 수 없는 형식·가짜 PDF·너무 많은 파일은 까닭과 함께 거절한다', async () => {
    await assert.rejects(readAttachments([{ name: '공문.hwp', data: b64('x') }]), /PDF 나 HWPX/);
    await assert.rejects(readAttachments([{ name: '가짜.pdf', data: b64('hello') }]), /PDF 파일이 아닙니다/);
    await assert.rejects(readAttachments([{ name: '실행.exe', data: b64('MZ') }]), /첨부할 수 있는 파일/);
    await assert.rejects(readAttachments(Array(6).fill({ name: 'a.txt', data: b64('a') })), /5개까지/);
  });
});

describe('구글 문서·시트 링크', () => {
  it('링크에서 종류·id·시트 탭을 찾고, 내보내기 주소는 새로 만든다(같은 파일은 한 번, 3개까지)', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const links = findGoogleLinks(`이거 봐 https://docs.google.com/spreadsheets/d/${id}/edit#gid=42 와 https://docs.google.com/document/d/${id}x/edit?usp=sharing 그리고 https://docs.google.com/spreadsheets/d/${id}/view`);
    assert.deepEqual(links.map((l) => [l.kind, l.gid]), [['spreadsheets', '42'], ['document', undefined]]);
    assert.equal(exportUrl(links[0]), `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=42`);
    assert.equal(exportUrl(links[1]), `https://docs.google.com/document/d/${id}x/export?format=txt`);
    assert.deepEqual(findGoogleLinks('https://evil.example/document/d/123456789012345678901234'), []);
  });
  it('공개 문서만 읽고, 로그인 화면·다른 주소로 넘기면 읽지 않는다', async () => {
    const link = findGoogleLinks('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012/edit')[0];
    const res = (status: number, headers: Record<string, string>, body = '') => new Response(status >= 300 && status < 400 ? null : body, { status, headers });
    const seq = (...list: Response[]) => (async () => list.shift()!) as unknown as typeof fetch;
    assert.deepEqual(
      await readGoogleLink(link, seq(res(307, { location: 'https://doc-0s.googleusercontent.com/export/abc' }), res(200, { 'content-type': 'text/plain' }, '알림장 내용'))),
      { ok: true, label: '구글 문서', text: '알림장 내용' },
    );
    assert.equal((await readGoogleLink(link, seq(res(302, { location: 'https://accounts.google.com/ServiceLogin' })))).ok, false);
    assert.equal((await readGoogleLink(link, seq(res(302, { location: 'http://169.254.169.254/' })))).ok, false);
    assert.equal((await readGoogleLink(link, seq(res(200, { 'content-type': 'text/html' }, '<html>로그인</html>')))).ok, false);
    // 크기를 알려 주지 않는 큰 응답은 받으면서 끊는다
    const big = await readGoogleLink(link, seq(res(200, { 'content-type': 'text/plain' }, 'ㄱ'.repeat(1_000_000))));
    assert.deepEqual(big, { ok: false, label: '구글 문서', reason: 'too_big' });
  });
});

describe('첨부 압축 파일 크기', () => {
  it('풀면 지나치게 커지는 엑셀도 읽지 않는다', async () => {
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', '<x>' + 'a'.repeat(70_000_000) + '</x>', { compression: 'DEFLATE' });
    const data = (await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })).toString('base64');
    await assert.rejects(readAttachments([{ name: '큰.xlsx', data }]), /너무 커서/);
  });
  it('풀면 지나치게 커지는 문서는 읽지 않는다', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:p>' + 'ㄱ'.repeat(25_000_000) + '</w:p>', { compression: 'DEFLATE' });
    const data = (await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })).toString('base64');
    await assert.rejects(readAttachments([{ name: '큰.docx', data }]), /너무 커서/);
  });
});
