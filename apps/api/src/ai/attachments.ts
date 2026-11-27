import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { extname } from 'node:path';
import { BadRequestException, HttpException } from '@nestjs/common';
import { bad } from '../common/http';
import { cellText, decodeText } from '../uploads/uploads.service';

/*
 * AI 창 첨부(2026-11-27 "첨부파일, 구글 문서·시트 링크도"). 저장하지 않고 이번 요청에만 쓴다.
 *  - PDF: Claude 문서 블록으로 그대로 보낸다(표·그림까지 읽는다).
 *  - 글로 바꿀 수 있는 파일(TXT·CSV·MD·JSON·XLSX·DOCX·HWPX·PPTX): 서버에서 글로 바꿔 자료(<attached_file>)로 붙인다.
 *  - HWP(옛 한글 파일)·DOC·XLS 는 읽을 수 없다 — PDF 나 HWPX·DOCX·XLSX 로 저장해 달라고 안내한다.
 *  - 구글 문서·시트·프레젠테이션 링크: '링크가 있는 모든 사용자' 공유 문서만 내보내기 주소로 읽는다(구글 연결 없이).
 * 첨부 안의 글은 모두 데이터다(시스템 지시 1번). 화면은 apps/web/src/lib/attachments.ts.
 */

export const MAX_FILES = 5;
/** 한 파일 base64 글자 수(약 10MB) */
const MAX_FILE_B64 = 14_000_000;
/** 글로 바꾼 첨부·링크 내용의 합계(글자) — 붙여넣은 자료 한도와 같다 */
export const MAX_ATTACHED_TEXT = 60_000;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const TEXT_EXT = new Set(['.txt', '.csv', '.tsv', '.md', '.json']);
const ZIP_TEXT_EXT = new Set(['.docx', '.hwpx', '.pptx']);
const UNREADABLE: Record<string, string> = {
  '.hwp': 'HWP(한글) 파일은 바로 읽을 수 없습니다. 한글에서 PDF 나 HWPX 로 저장해 첨부해 주세요.',
  '.doc': '옛 워드(DOC) 파일은 바로 읽을 수 없습니다. PDF 나 DOCX 로 저장해 첨부해 주세요.',
  '.xls': '옛 엑셀(XLS) 파일은 바로 읽을 수 없습니다. XLSX 나 CSV 로 저장해 첨부해 주세요.',
  '.ppt': '옛 파워포인트(PPT) 파일은 바로 읽을 수 없습니다. PDF 나 PPTX 로 저장해 첨부해 주세요.',
};

export type PdfBlock = {
  type: 'document';
  source: { type: 'base64'; media_type: 'application/pdf'; data: string };
  title: string;
};
export interface AttachedText {
  name: string;
  text: string;
}

const xmlText = (xml: string, paragraph: RegExp, run: RegExp): string =>
  xml
    .split(paragraph)
    .map((part) => Array.from(part.matchAll(run), (m) => m[1]).join(''))
    .filter((line) => line.trim())
    .join('\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** 압축을 풀면 이보다 커지는 파일은 읽지 않는다(작은 파일이 풀면서 메모리를 다 쓰는 일을 막는다). */
const MAX_UNZIPPED = 60 * 1024 * 1024;

/**
 * 압축 파일(DOCX·HWPX·PPTX·XLSX)을 실제로 조금씩 풀어 보며 크기를 센다 — 파일이 스스로 적어 둔 크기는 믿지 않는다(2026-11-27 GPT 검토).
 * 넘으면 그 자리에서 멈춘다. 푼 조각은 쌓아 두지 않으므로 세는 동안 메모리가 늘지 않는다.
 */
async function assertZipSmall(zip: JSZip): Promise<void> {
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    await new Promise<void>((resolve, reject) => {
      const stream = (entry as unknown as { internalStream: (t: string) => any }).internalStream('uint8array');
      stream
        .on('data', (chunk: Uint8Array) => {
          total += chunk.length;
          if (total > MAX_UNZIPPED) {
            stream.pause();
            reject(new BadRequestException('파일을 풀면 너무 커서 읽지 않았습니다. PDF 로 저장해 첨부해 주세요.'));
          }
        })
        .on('error', reject)
        .on('end', () => resolve())
        .resume();
    });
  }
}

async function zipText(ext: string, buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  await assertZipSmall(zip);
  const pick = (re: RegExp) =>
    Object.keys(zip.files)
      .filter((n) => re.test(n))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (ext === '.docx') {
    const xml = (await zip.file('word/document.xml')?.async('string')) ?? '';
    return xmlText(xml, /<\/w:p>/, /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g);
  }
  if (ext === '.hwpx') {
    const parts = await Promise.all(pick(/^Contents\/section\d+\.xml$/).map((n) => zip.file(n)!.async('string')));
    return parts.map((xml) => xmlText(xml, /<\/hp:p>/, /<hp:t(?:\s[^>]*)?>([^<]*)<\/hp:t>/g)).join('\n');
  }
  const slides = await Promise.all(pick(/^ppt\/slides\/slide\d+\.xml$/).map((n) => zip.file(n)!.async('string')));
  return slides.map((xml, i) => `[슬라이드 ${i + 1}]\n${xmlText(xml, /<\/a:p>/, /<a:t>([^<]*)<\/a:t>/g)}`).join('\n\n');
}

async function xlsxText(buffer: Buffer): Promise<string> {
  // 엑셀도 압축 파일이다 — 읽기 전에 실제로 풀리는 크기부터 센다.
  await assertZipSmall(await JSZip.loadAsync(buffer));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const out: string[] = [];
  for (const sheet of workbook.worksheets.slice(0, 5)) {
    out.push(`[시트: ${sheet.name}]`);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (out.length < 2000) out.push(Array.from(row.values as unknown[]).slice(1).map(cellText).join('\t'));
    });
  }
  return out.join('\n');
}

/** 요청의 첨부를 검사하고 PDF 블록과 글 자료로 나눈다. 모양이 틀리면 거절한다(조용히 빼지 않는다). */
export async function readAttachments(files: unknown): Promise<{ pdfs: PdfBlock[]; texts: AttachedText[] }> {
  if (files === undefined || files === null) return { pdfs: [], texts: [] };
  if (!Array.isArray(files)) bad('첨부 형식이 올바르지 않습니다.');
  if (files.length > MAX_FILES) bad(`파일은 한 번에 ${MAX_FILES}개까지 첨부할 수 있습니다.`);
  const pdfs: PdfBlock[] = [];
  const texts: AttachedText[] = [];
  for (const file of files) {
    const name = typeof file?.name === 'string' ? file.name.replace(/[\r\n<>]/g, ' ').slice(0, 120) : '';
    const data = typeof file?.data === 'string' ? file.data : '';
    const ext = extname(name).toLowerCase();
    if (!name) bad('파일 이름이 없습니다.');
    if (UNREADABLE[ext]) bad(UNREADABLE[ext]);
    if (!data || data.length > MAX_FILE_B64 || !B64_RE.test(data)) bad(`${name}: 파일이 너무 크거나(10MB 까지) 읽을 수 없습니다.`);
    const buffer = Buffer.from(data, 'base64');
    try {
      if (ext === '.pdf') {
        if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') bad(`${name}: PDF 파일이 아닙니다.`);
        pdfs.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: name });
      } else if (TEXT_EXT.has(ext)) texts.push({ name, text: decodeText(buffer) });
      else if (ext === '.xlsx') texts.push({ name, text: await xlsxText(buffer) });
      else if (ZIP_TEXT_EXT.has(ext)) texts.push({ name, text: await zipText(ext, buffer) });
      else bad(`${name}: 첨부할 수 있는 파일은 이미지·PDF·한글(HWPX)·워드(DOCX)·엑셀(XLSX)·파워포인트(PPTX)·글(TXT·CSV·MD)입니다.`);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      bad(`${name}: 파일을 읽지 못했습니다. 다른 형식(PDF 등)으로 저장해 다시 첨부해 주세요.`);
    }
  }
  return { pdfs, texts };
}

// ── 구글 문서·시트·프레젠테이션 링크 ─────────────────────────────────────────────

const GOOGLE_LINK_RE = /https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{20,100})[^\s<>"')]*/g;
const KIND_LABEL = { document: '구글 문서', spreadsheets: '구글 시트', presentation: '구글 프레젠테이션' } as const;
export const MAX_GOOGLE_LINKS = 3;
const MAX_LINK_BYTES = 2_000_000;

export interface GoogleLink {
  kind: keyof typeof KIND_LABEL;
  id: string;
  gid?: string;
  url: string;
}

/** 요청 글에서 구글 문서·시트·프레젠테이션 링크를 찾는다(같은 파일은 한 번). 내보내기 주소는 여기서 새로 만든다(받은 주소를 그대로 부르지 않는다). */
export function findGoogleLinks(text: string): GoogleLink[] {
  const seen = new Set<string>();
  const out: GoogleLink[] = [];
  for (const m of text.matchAll(GOOGLE_LINK_RE)) {
    const kind = m[1] as GoogleLink['kind'];
    const key = `${kind}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const gid = /[#&?]gid=(\d{1,12})/.exec(m[0])?.[1];
    out.push({ kind, id: m[2], gid, url: m[0] });
  }
  return out.slice(0, MAX_GOOGLE_LINKS);
}

export function exportUrl(link: GoogleLink): string {
  const base = `https://docs.google.com/${link.kind}/d/${link.id}`;
  if (link.kind === 'document') return `${base}/export?format=txt`;
  if (link.kind === 'presentation') return `${base}/export/txt`;
  return `${base}/export?format=csv${link.gid ? `&gid=${link.gid}` : ''}`;
}

/** 허용하는 내보내기 응답 주소: 구글 문서 자체나 구글이 내려 주는 파일 주소. 로그인 화면으로 가면 공개 문서가 아니다. */
const allowedHost = (host: string) => host === 'docs.google.com' || host.endsWith('.googleusercontent.com');

/** '링크가 있는 모든 사용자' 공유 문서를 글로 읽는다. 공개가 아니면 그 까닭을 돌려준다. */
export async function readGoogleLink(link: GoogleLink, fetcher: typeof fetch = fetch): Promise<{ ok: true; text: string; label: string } | { ok: false; label: string; reason: string }> {
  const label = KIND_LABEL[link.kind];
  let url = exportUrl(link);
  try {
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'ssamboard' } });
      if (res.status >= 300 && res.status < 400) {
        const next = new URL(res.headers.get('location') ?? '', url);
        if (next.protocol !== 'https:' || !allowedHost(next.hostname)) return { ok: false, label, reason: 'not_public' };
        url = next.toString();
        continue;
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) return { ok: false, label, reason: 'not_public' };
      if (!res.ok) return { ok: false, label, reason: 'failed' };
      const type = res.headers.get('content-type') ?? '';
      if (type.includes('text/html')) return { ok: false, label, reason: 'not_public' };
      const length = Number(res.headers.get('content-length') ?? 0);
      if (length > MAX_LINK_BYTES) return { ok: false, label, reason: 'too_big' };
      // 받으면서 세다가 2MB 를 넘으면 그 자리에서 끊는다(크기를 안 알려 주는 응답도 끝까지 받지 않는다).
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = res.body?.getReader();
      if (!reader) return { ok: false, label, reason: 'failed' };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_LINK_BYTES) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, label, reason: 'too_big' };
        }
        chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);
      return { ok: true, label, text: decodeText(buffer) };
    }
    return { ok: false, label, reason: 'failed' };
  } catch {
    return { ok: false, label, reason: 'failed' };
  }
}

export const LINK_FAIL_TEXT: Record<string, string> = {
  not_public: '공개 문서가 아니라 읽지 못했습니다. 공유를 "링크가 있는 모든 사용자(보기)"로 바꾸거나, 파일로 내려받아 첨부해 주세요.',
  too_big: '문서가 너무 커서(2MB 넘음) 읽지 못했습니다. 필요한 부분만 붙여 넣어 주세요.',
  failed: '문서를 읽지 못했습니다. 잠시 뒤 다시 해 주세요.',
};
