/*
 * 한글(.hwpx) 고치기(2026-11-28). HWPX 는 ZIP 안의 XML(Contents/section*.xml)이다.
 * 문단(<hp:p>) 단위로 번호를 붙여 AI 에게 보여 주고(표 칸 안 문단 포함), AI 가 낸 고치기(문단 글 바꾸기·찾아 바꾸기)를
 * 원본 서식은 그대로 둔 채 글자만 바꿔 새 파일로 만든다. 표에 줄 더하기·그림 넣기처럼 모양을 바꾸는 일은 하지 않는다.
 *
 * XML 은 표 안에 문단이 다시 들어가는(<hp:p> 안 <hp:tbl> 안 <hp:p>) 꼴이라 정규식 한 번으로는 못 다룬다 —
 * 태그를 차례로 읽으며 쌓기(stack)로 '이 글(<hp:t>)이 어느 문단의 것인지'를 정한다.
 */
import JSZip from 'jszip';
import { maskPii } from '@jarvis/shared';
import type { EditReport } from './xlsx-edit';
import { assertZipSmall } from './zip-guard';

export type HwpxEdit = { op: 'set_text'; p: number; text: string } | { op: 'replace'; find: string; replace: string };
export const HWPX_MAX_EDITS = 300;

interface Para {
  /** 문서 전체 번호(0부터) */
  index: number;
  section: string;
  /** 이 문단에 바로 속한 <hp:t> 들(안쪽 문단 것은 빼고)의 내용 자리 [시작, 끝) — 여는 태그 뒤 ~ 닫는 태그 앞 */
  texts: {
    start: number;
    end: number;
    selfClosing: boolean;
    tagStart: number;
    tagEnd: number;
  }[];
  /** 이 문단에 바로 속한 첫 <hp:run …> 여는 태그 자리(글이 없는 빈 문단에 글을 넣을 때) */
  firstRun: { start: number; end: number; selfClosing: boolean } | null;
  /** 이 문단의 <hp:linesegarray> 자리(글이 바뀌면 지운다 — 한글이 열 때 줄 나눔을 다시 계산) */
  linesegs: { start: number; end: number }[];
  text: string;
  inTable: boolean;
}

/** 문단 하나·문서 전체 글자 수 상한(찾아 바꾸기를 되풀이해 글이 불어나는 것을 막는다 — 코덱스 검토) */
const MAX_PARA_CHARS = 20_000;
const MAX_TOTAL_GROWTH = 1_000_000;
/** XML 1.0 에서 쓸 수 없는 글자(넣으면 파일이 깨진다) */
const BAD_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const cleanText = (s: string) => s.replace(BAD_XML_CHARS, '');

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&');
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** section XML 한 장의 문단들 */
function scan(xml: string, section: string, startIndex: number): Para[] {
  const out: Para[] = [];
  const stack: { p: Para; depthTbl: number }[] = [];
  let tblDepth = 0;
  const re = /<(\/?)([A-Za-z][\w.-]*:[\w.-]+|[A-Za-z][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let openT: { para: Para; contentStart: number; tagStart: number } | null = null;
  let openLineseg: { para: Para; start: number } | null = null;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const [whole, close, name, , self] = m;
    const at = m.index;
    const top = stack[stack.length - 1]?.p;
    if (name === 'hp:tbl') {
      if (!close && !self) tblDepth++;
      else if (close) tblDepth--;
      continue;
    }
    if (name === 'hp:p') {
      if (!close && !self) {
        const p: Para = {
          index: 0,
          section,
          texts: [],
          firstRun: null,
          linesegs: [],
          text: '',
          inTable: tblDepth > 0,
        };
        stack.push({ p, depthTbl: tblDepth });
        out.push(p);
      } else if (close) stack.pop();
      continue;
    }
    if (!top) continue;
    if (name === 'hp:run' && !close && !top.firstRun)
      top.firstRun = {
        start: at,
        end: at + whole.length,
        selfClosing: Boolean(self),
      };
    if (name === 'hp:t') {
      if (self)
        top.texts.push({
          start: at + whole.length,
          end: at + whole.length,
          selfClosing: true,
          tagStart: at,
          tagEnd: at + whole.length,
        });
      else if (!close) openT = { para: top, contentStart: at + whole.length, tagStart: at };
      else if (openT) {
        const inner = xml.slice(openT.contentStart, at);
        openT.para.texts.push({
          start: openT.contentStart,
          end: at,
          selfClosing: false,
          tagStart: openT.tagStart,
          tagEnd: at + whole.length,
        });
        // <hp:t> 안의 <hp:tab/>·<hp:lineBreak/> 같은 것은 칸 띄움으로
        openT.para.text += decode(
          inner
            .replace(/<hp:tab\b[^>]*\/>/g, '\t')
            .replace(/<hp:lineBreak\b[^>]*\/>/g, '\n')
            .replace(/<[^>]+>/g, ''),
        );
        openT = null;
      }
    }
    if (name === 'hp:linesegarray') {
      if (self) top.linesegs.push({ start: at, end: at + whole.length });
      else if (!close) openLineseg = { para: top, start: at };
      else if (openLineseg) {
        openLineseg.para.linesegs.push({
          start: openLineseg.start,
          end: at + whole.length,
        });
        openLineseg = null;
      }
    }
  }
  out.forEach((p, i) => (p.index = startIndex + i));
  return out;
}

async function open(buffer: Buffer | Uint8Array): Promise<{
  zip: JSZip;
  sections: { name: string; xml: string; paras: Para[] }[];
}> {
  const zip = await JSZip.loadAsync(buffer);
  // 머리말에 적힌 크기가 아니라 실제로 풀리는 크기를 센다(제미나이 검토)
  await assertZipSmall(zip);
  const names = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (names.length === 0) throw new Error('한글(HWPX) 문서가 아닙니다(본문 section 이 없습니다).');
  const sections: { name: string; xml: string; paras: Para[] }[] = [];
  let index = 0;
  for (const name of names) {
    const xml = await zip.file(name)!.async('string');
    // 주석·CDATA 안의 태그를 진짜 문단으로 읽지 않게, 이런 것이 든 문서는 다루지 않는다(한글이 만드는 파일엔 없다 — 코덱스 검토)
    if (/<!--|<!\[CDATA\[|<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('주석·DTD 가 든 HWPX 는 고칠 수 없습니다. 한글에서 다시 저장해 붙여 주세요.');
    const paras = scan(xml, name, index);
    index += paras.length;
    sections.push({ name, xml, paras });
  }
  return { zip, sections };
}

/** AI 에게 보여 줄 문단 목록: [p번호] 글 — 표 칸 안 문단은 (표) 표시, 빈 문단은 (빈 칸) */
export async function describeHwpx(buffer: Buffer | Uint8Array, maxChars = 30_000): Promise<string> {
  const { sections } = await open(buffer);
  const lines: string[] = [];
  for (const s of sections)
    for (const p of s.paras) {
      if (lines.length >= 1500) break;
      const t = p.text.replace(/\s+/g, ' ').trim();
      if (!t && !p.inTable) continue; // 표 밖 빈 줄은 줄인다(번호는 그대로)
      lines.push(`[p${p.index}]${p.inTable ? '(표)' : ''} ${t ? t.slice(0, 300) : '(빈 칸)'}`);
    }
  const text = maskPii(lines.join('\n'));
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(길어서 여기까지만 보였습니다)` : text;
}

type Cut = { start: number; end: number; with: string };

/**
 * 문단 하나의 글을 통째로 바꾸는 자르기 목록 — 첫 <hp:t> 에 넣고 나머지 <hp:t> 는 비운다(첫 글자 모양을 따른다). 줄 나눔 정보는 지운다.
 * 자리는 모두 '원래 XML' 기준이다 — 여러 문단(표를 품은 문단과 그 표 칸 문단)을 한꺼번에 뒤에서부터 잘라야 자리가 어긋나지 않는다(코덱스 검토).
 */
function cutsFor(xml: string, p: Para, text: string): Cut[] {
  const cuts: Cut[] = [];
  // 탭·줄 바꿈은 한글의 표시 요소로 되돌린다(읽을 때 \t·\n 으로 바꿨던 것 — 제미나이 검토)
  const enc = encode(text).replace(/\t/g, '<hp:tab/>').replace(/\r?\n/g, '<hp:lineBreak/>');
  if (p.texts.length > 0) {
    p.texts.forEach((t, i) => {
      const content = i === 0 ? enc : '';
      if (t.selfClosing)
        cuts.push({
          start: t.tagStart,
          end: t.tagEnd,
          with: content ? `<hp:t>${content}</hp:t>` : '',
        });
      else cuts.push({ start: t.start, end: t.end, with: content });
    });
  } else if (p.firstRun) {
    const r = p.firstRun;
    if (r.selfClosing) {
      const open = xml.slice(r.start, r.end).replace(/\/>$/, '>');
      cuts.push({
        start: r.start,
        end: r.end,
        with: `${open}<hp:t>${enc}</hp:t></hp:run>`,
      });
    } else cuts.push({ start: r.end, end: r.end, with: `<hp:t>${enc}</hp:t>` });
  } else throw new Error(`[p${p.index}] 에는 글을 넣을 자리가 없습니다.`);
  for (const l of p.linesegs) cuts.push({ start: l.start, end: l.end, with: '' });
  return cuts;
}

/** 원래 XML 기준 자르기들을 뒤에서부터 한 번에(겹치면 오류) */
function applyCuts(xml: string, cuts: Cut[]): string {
  const sorted = [...cuts].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = xml;
  let limit = Infinity;
  for (const c of sorted) {
    if (c.end > limit) throw new Error('고칠 자리가 겹칩니다(문단 구조가 예상과 다릅니다).');
    out = out.slice(0, c.start) + c.with + out.slice(c.end);
    limit = c.start;
  }
  return out;
}

/** 고친 XML 의 태그 짝이 맞는지(깨진 파일을 내보내지 않게) */
function assertBalanced(xml: string): void {
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z][\w.-]*(?::[\w.-]+)?)(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const [, close, name, self] = m;
    if (self) continue;
    if (!close) stack.push(name);
    else if (stack.pop() !== name) throw new Error('고친 결과의 XML 이 맞지 않아 멈췄습니다.');
  }
  if (stack.length > 0) throw new Error('고친 결과의 XML 이 맞지 않아 멈췄습니다.');
  // /g 정규식의 test 는 lastIndex 를 남긴다 — 매번 새로 검사(제미나이 검토)
  if (new RegExp(BAD_XML_CHARS.source).test(xml)) throw new Error('고친 결과에 쓸 수 없는 글자가 있습니다.');
}

/** 고치기 목록을 검사하고 적용한다. dry 면 파일은 만들지 않는다. */
export async function applyHwpxEdits(buffer: Buffer | Uint8Array, edits: unknown, dry = false): Promise<{ report: EditReport; file?: Buffer }> {
  if (!Array.isArray(edits) || edits.length === 0) throw new Error('고칠 내용(edits)이 비었습니다.');
  if (edits.length > HWPX_MAX_EDITS) throw new Error(`한 번에 ${HWPX_MAX_EDITS}개까지 고칠 수 있습니다.`);
  const { zip, sections } = await open(buffer);
  const all = sections.flatMap((s) => s.paras);
  /** 문단 번호 → 새 글(여러 고치기가 같은 문단을 건드리면 차례로) */
  const next = new Map<number, string>();
  const textOf = (p: Para) => next.get(p.index) ?? p.text;
  const lines: string[] = [];
  const note = (s: string) => lines.length < 1000 && lines.push(s);
  for (const raw of edits as HwpxEdit[]) {
    const e = (raw ?? {}) as HwpxEdit;
    if (e.op === 'set_text') {
      const p = all[Number(e.p)];
      if (!Number.isInteger(Number(e.p)) || !p) throw new Error(`없는 문단입니다: p${e.p}`);
      // 줄 바꿈은 살려 둔다 — 쓸 때 <hp:lineBreak/> 로(제미나이 검토)
      const t = cleanText(String(e.text ?? '').replace(/\r\n?/g, '\n')).slice(0, 5000);
      note(`[p${p.index}] ${textOf(p).slice(0, 200) || '(빈 칸)'} → ${t.slice(0, 200) || '(비움)'}`);
      next.set(p.index, t);
    } else if (e.op === 'replace') {
      const find = String(e.find ?? '');
      const rep = cleanText(String(e.replace ?? '').replace(/\r\n?/g, '\n')).slice(0, 5000);
      if (!find) throw new Error('replace 의 find 가 비었습니다.');
      let hits = 0;
      for (const p of all) {
        const cur = textOf(p);
        if (!cur.includes(find)) continue;
        hits++;
        const after = cur.split(find).join(rep);
        if (after.length > MAX_PARA_CHARS) throw new Error(`[p${p.index}] 글이 너무 길어집니다(찾아 바꾸기를 확인하세요).`);
        next.set(p.index, after);
        note(`[p${p.index}] ${cur.slice(0, 200)} → ${after.slice(0, 200)}`);
      }
      if (hits === 0) throw new Error(`문서에 "${find.slice(0, 40)}" 가 없습니다.`);
    } else throw new Error(`알 수 없는 고치기입니다: ${(e as { op?: string }).op}. set_text·replace 중 하나입니다.`);
  }
  const before = all.reduce((n, p) => n + p.text.length, 0);
  const afterLen = all.reduce((n, p) => n + textOf(p).length, 0);
  if (afterLen - before > MAX_TOTAL_GROWTH) throw new Error('고친 뒤 문서가 너무 커집니다.');
  const report = { lines: lines.map((l) => maskPii(l)), count: lines.length };
  // 미리 보기(dry)도 실제로 바꿔 보고 XML 이 맞는지까지 본다 — 승인 전 화면과 실제가 다르지 않게(코덱스 검토)
  const changed: { name: string; xml: string }[] = [];
  for (const s of sections) {
    const cuts = s.paras.filter((p) => next.has(p.index)).flatMap((p) => cutsFor(s.xml, p, next.get(p.index)!));
    if (cuts.length === 0) continue;
    const xml = applyCuts(s.xml, cuts);
    assertBalanced(xml);
    changed.push({ name: s.name, xml });
  }
  if (dry) return { report };
  for (const c of changed) zip.file(c.name, c.xml);
  // 미리보기 글(파일 탐색기용)도 맞춘다
  if (zip.file('Preview/PrvText.txt'))
    zip.file(
      'Preview/PrvText.txt',
      all
        .map((p) => textOf(p))
        .filter(Boolean)
        .join('\r\n')
        .slice(0, 1024),
    );
  // HWPX 규칙: mimetype 은 맨 앞·압축 없이
  const mime = zip.file('mimetype') ? await zip.file('mimetype')!.async('string') : null;
  if (mime !== null) zip.file('mimetype', mime, { compression: 'STORE' });
  const file = Buffer.from(
    await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      mimeType: 'application/hwp+zip',
    }),
  );
  return { report, file };
}
