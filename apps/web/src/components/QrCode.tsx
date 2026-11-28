import { useMemo } from 'react';
import { qrMatrix, qrSvgPath } from '@jarvis/shared';

/**
 * 주소를 QR 로(학생이 휴대폰 카메라로 바로 연다). 바깥 라이브러리 없이 @jarvis/shared qr.ts 가 만든다.
 * 흰 바탕·검은 칸으로 고정한다(어두운 화면·색 바탕에서도 카메라가 읽게).
 */
export function QrCode({ text, size = 220, label }: { text: string; size?: number; label?: string }) {
  const svg = useMemo(() => {
    const g = qrMatrix(text);
    return g ? qrSvgPath(g) : null;
  }, [text]);
  if (!svg) return <p className="text-xs text-sub">주소가 길어 QR 을 만들 수 없습니다. 주소를 복사해 주세요.</p>;
  return (
    <svg
      role="img"
      aria-label={label ?? 'QR 코드'}
      width={size}
      height={size}
      viewBox={`0 0 ${svg.size} ${svg.size}`}
      shapeRendering="crispEdges"
      className="shrink-0 rounded-lg"
      style={{ background: '#fff' }}
    >
      <path d={svg.d} fill="#000" />
    </svg>
  );
}
