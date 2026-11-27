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

/** 붙여넣기·끌어 놓기에서 이미지 파일만 꺼낸다. */
export function imageFilesFrom(list: DataTransfer | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list.files ?? []).filter(isImageFile);
}
