/*
 * 'node:fs'·'node:fs/promises' 대체품(구글 드라이브 트랙). 서버 디스크 대신 이 탭의 메모리에 둔다.
 * 쓰는 곳은 파일로 표 만들기(uploads.service) 하나 — 올린 파일을 표로 만들 때까지만 필요하고, 새로 고치면 사라져도 된다.
 * 글꼴 파일 읽기(view-frame) 같은 다른 쓰임은 없는 파일로 알린다.
 */
import { Buffer } from 'buffer';

const files = new Map<string, Uint8Array>();
const enoent = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });

export async function writeFile(path: string, data: Uint8Array | string): Promise<void> {
  files.set(path, typeof data === 'string' ? Buffer.from(data) : data);
}
export async function readFile(path: string): Promise<Buffer> {
  const f = files.get(path);
  if (!f) throw enoent(path);
  return Buffer.from(f);
}
export async function mkdir(_path: string, _opts?: unknown): Promise<void> {}
export async function rm(path: string, _opts?: unknown): Promise<void> {
  files.delete(path);
}
export const unlink = rm;
export async function stat(path: string): Promise<{ size: number }> {
  const f = files.get(path);
  if (!f) throw enoent(path);
  return { size: f.byteLength };
}
export function readFileSync(path: string): never {
  throw enoent(path);
}
export const existsSync = (path: string): boolean => files.has(path);
export const promises = { readFile, writeFile, mkdir, rm, unlink, stat };
export default { readFileSync, existsSync, promises };
