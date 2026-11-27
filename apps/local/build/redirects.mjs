// 구글 드라이브 트랙 빌드 규칙(Vite·esbuild 둘 다 씀): 서버 코드(apps/api/src)가 부르는 Node·Nest 모듈을 브라우저 대체품으로 바꾼다.
// 새 서버 코드가 여기 없는 Node 모듈을 쓰면 빌드가 실패한다 — 대체품을 더하거나 그 기능을 이 트랙에서 막는다.
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = normalize(join(here, '..', '..', '..'));
export const API_SRC = join(root, 'apps', 'api', 'src');
const SRC = join(here, '..', 'src');

/** 패키지 이름 → 대체 파일 */
export const PACKAGE_REDIRECTS = {
  '@nestjs/common': join(SRC, 'shim', 'nest-common.ts'),
  '@nestjs/core': join(SRC, 'shim', 'nest-core.ts'),
  '@nestjs/platform-express': join(SRC, 'shim', 'platform-express.ts'),
  pg: join(SRC, 'shim', 'pg.ts'),
  'node:path': join(SRC, 'shim', 'node-path.ts'),
  'node:fs': join(SRC, 'shim', 'node-fs.ts'),
  'node:fs/promises': join(SRC, 'shim', 'node-fs.ts'),
  'node:crypto': join(SRC, 'shim', 'node-crypto.ts'),
};

/** 서버 파일(apps/api/src 기준) → 대체 파일 */
export const FILE_REDIRECTS = {
  'config.ts': join(SRC, 'shim', 'config.ts'),
  'common/crypto.ts': join(SRC, 'shim', 'crypto.ts'),
  'auth/google.service.ts': join(SRC, 'stub', 'google.ts'),
  'auth/auth.service.ts': join(SRC, 'stub', 'auth.ts'),
};

const fileMap = new Map(Object.entries(FILE_REDIRECTS).map(([k, v]) => [normalize(join(API_SRC, k)), v]));

/** 상대 경로로 부른 서버 파일이 대체 대상이면 대체 파일을 준다. */
export function redirectRelative(source, importer) {
  if (!importer || !source.startsWith('.')) return null;
  const base = normalize(join(dirname(importer), source));
  for (const cand of [base, base + '.ts']) if (fileMap.has(cand)) return fileMap.get(cand);
  return null;
}

/** Vite 플러그인 */
export function localTrackVite() {
  return {
    name: 'ssamboard-local-track',
    enforce: 'pre',
    resolveId(source, importer) {
      if (PACKAGE_REDIRECTS[source]) return PACKAGE_REDIRECTS[source];
      return redirectRelative(source, importer);
    },
  };
}

/** esbuild 플러그인(시험용 묶기) */
export function localTrackEsbuild() {
  return {
    name: 'ssamboard-local-track',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (PACKAGE_REDIRECTS[args.path]) return { path: PACKAGE_REDIRECTS[args.path] };
        const r = redirectRelative(args.path, args.importer);
        return r ? { path: r } : undefined;
      });
    },
  };
}
