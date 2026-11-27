// AI 창에 붙이는 이미지(2026-11-27). 보내기 전에 이 기기에서 줄인다 — 긴 변 1568px(Claude 가 그 이상은 어차피 줄여 읽는다),
// JPEG 85%. 원본은 서버에 남지 않고 이번 요청에만 간다. 한 번에 4장까지(서버 apps/api/src/ai/ai.service.ts 의 MAX_IMAGES 와 같다).

export const MAX_IMAGES = 4;
const MAX_EDGE = 1568;
const QUALITY = 0.85;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

export interface AttachedImage {
  id: string;
  /** 미리보기용 data: 주소 */
  preview: string;
  media_type: 'image/jpeg';
  /** base64(머리말 없음) */
  data: string;
}

export const isImageFile = (file: File) => ACCEPT.includes(file.type) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name);

// blob: 주소는 이 앱의 보안 정책(img-src 'self' data:)에 막히므로 data: 주소로 읽는다.
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error(`${file.name || '이미지'}를 읽지 못했습니다. JPG·PNG 로 바꿔 다시 해 주세요.`));
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = fail;
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** 파일 하나를 줄여 JPEG base64 로 만든다. 투명한 부분은 흰 바탕으로 채운다. */
export async function shrinkImage(file: File): Promise<AttachedImage> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이 브라우저에서는 이미지를 줄일 수 없습니다.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const preview = canvas.toDataURL('image/jpeg', QUALITY);
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, preview, media_type: 'image/jpeg', data: preview.slice(preview.indexOf(',') + 1) };
}


// ── 이미지가 아닌 첨부 파일(2026-11-27) ─────────────────────────────────────────
// PDF 는 그대로, 한글(HWPX)·워드·엑셀·파워포인트·글 파일은 서버가 글로 바꿔 AI 에 자료로 준다(apps/api/src/ai/attachments.ts).
export const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_ACCEPT = 'image/*,.pdf,.hwpx,.docx,.xlsx,.pptx,.txt,.csv,.tsv,.md,.json,.hwp,.doc,.xls,.ppt';
const READABLE = /\.(pdf|hwpx|docx|xlsx|pptx|txt|csv|tsv|md|json)$/i;
const OLD_FORMAT: Record<string, string> = {
  hwp: 'HWP(한글) 파일은 바로 읽을 수 없어요. 한글에서 PDF 나 HWPX 로 저장해 첨부해 주세요.',
  doc: '옛 워드(DOC) 파일은 PDF 나 DOCX 로 저장해 첨부해 주세요.',
  xls: '옛 엑셀(XLS) 파일은 XLSX 나 CSV 로 저장해 첨부해 주세요.',
  ppt: '옛 파워포인트(PPT) 파일은 PDF 나 PPTX 로 저장해 첨부해 주세요.',
};

export interface AttachedFile {
  id: string;
  name: string;
  /** base64(머리말 없음) */
  data: string;
}

/** 이미지가 아닌 파일 하나를 읽는다. 못 쓰는 형식·너무 큰 파일은 까닭과 함께 거절한다. */
export function readAttachedFile(file: File): Promise<AttachedFile> {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  if (OLD_FORMAT[ext]) return Promise.reject(new Error(OLD_FORMAT[ext]));
  if (!READABLE.test(file.name)) return Promise.reject(new Error(`${file.name}: 이미지·PDF·한글(HWPX)·워드·엑셀·파워포인트·글 파일만 첨부할 수 있어요.`));
  if (file.size > MAX_FILE_BYTES) return Promise.reject(new Error(`${file.name}: 10MB 보다 큰 파일은 첨부할 수 없어요.`));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name}를 읽지 못했습니다.`));
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: file.name, data: url.slice(url.indexOf(',') + 1) });
    };
    reader.readAsDataURL(file);
  });
}

/** 고른·붙여넣은·끌어 놓은 파일을 이미지와 나머지로 나눈다. */
export function splitFiles(files: File[]): { images: File[]; others: File[] } {
  return { images: files.filter(isImageFile), others: files.filter((f) => !isImageFile(f)) };
}

/** 붙여넣기·끌어 놓기에서 파일을 모두 꺼낸다. */
export function filesFrom(list: DataTransfer | null | undefined): File[] {
  return list ? Array.from(list.files ?? []) : [];
}

// ── 링크 첨부(2026-11-27 "파일이면 파일, 링크면 링크 — 그냥 넣으면 알아서") ─────────────
// 붙여넣기·끌어 놓기에 구글 문서·시트·프레젠테이션 링크만 있으면 글 대신 첨부(링크)로 붙인다. 다른 주소는 글 그대로 둔다.
export const MAX_LINKS = 3;
const GOOGLE_LINK = /https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/[A-Za-z0-9_-]{20,100}[^\s<>"')]*/g;
const LINK_KIND: Record<string, string> = { document: '구글 문서', spreadsheets: '구글 시트', presentation: '구글 프레젠테이션' };

export interface AttachedLink {
  url: string;
  label: string;
}

/** 넣은 글이 구글 링크(들)뿐이면 그 링크들을, 아니면 빈 목록을 돌려준다. */
export function googleLinksOnly(text: string): AttachedLink[] {
  const found = Array.from(text.matchAll(GOOGLE_LINK), (m) => ({ url: m[0], label: LINK_KIND[m[1]] }));
  if (found.length === 0) return [];
  const rest = found.reduce((t, l) => t.replace(l.url, ''), text).trim();
  return rest ? [] : found;
}

/** 끌어 놓은 것에서 링크 글을 꺼낸다(주소 줄·글). */
export function droppedText(list: DataTransfer | null | undefined): string {
  return list ? list.getData('text/uri-list') || list.getData('text/plain') || '' : '';
}
