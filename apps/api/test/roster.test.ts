import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareRoster, parseRoster } from '@jarvis/shared';

describe('명단 대조', () => {
  it('줄·쉼표로 나누고 겹침을 뺀다', () => {
    assert.deepEqual(parseRoster('김민수\n이서연, 박지훈\n\n김 민수'), ['김민수', '이서연', '박지훈']);
  });
  it('미제출·중복·명단에 없는 응답', () => {
    const r = compareRoster(['김민수', '이서연', '박지훈', '최유진'], ['12번 김민수', '이서연', '이 서연', '3학년 2반 박지훈', '홍길동', '']);
    assert.deepEqual(r.submitted, ['김민수', '이서연', '박지훈']);
    assert.deepEqual(r.missing, ['최유진']);
    assert.deepEqual(r.duplicates, [{ name: '이서연', count: 2 }]);
    assert.deepEqual(r.unmatched, ['홍길동']);
  });
  it('긴 응답 안에 명단 이름이 둘이면 맞추지 않는다(사람이 확인)', () => {
    const r = compareRoster(['민수', '김민수'], ['김민수']);
    assert.deepEqual(r.submitted, ['김민수']);
    const r2 = compareRoster(['민수', '서연'], ['민수서연']);
    assert.deepEqual(r2.unmatched, ['민수서연']);
  });
});
