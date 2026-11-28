import { BadRequestException } from '@nestjs/common';
import type JSZip from 'jszip';

/* 압축 파일(xlsx·hwpx·docx·pptx)을 풀기 전에 실제로 풀리는 크기를 센다 — 압축 폭탄 막기. 첨부·표 업로드·파일 고치기가 함께 쓴다. */
export const MAX_UNZIPPED = 60 * 1024 * 1024;

/**
 * 압축 파일(DOCX·HWPX·PPTX·XLSX)을 실제로 조금씩 풀어 보며 크기를 센다 — 파일이 스스로 적어 둔 크기는 믿지 않는다(2026-11-27 GPT 검토).
 * 넘으면 그 자리에서 멈춘다. 푼 조각은 쌓아 두지 않으므로 세는 동안 메모리가 늘지 않는다.
 */
export async function assertZipSmall(zip: JSZip): Promise<void> {
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
