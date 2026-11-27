export const API_SRC: string;
export const PACKAGE_REDIRECTS: Record<string, string>;
export const FILE_REDIRECTS: Record<string, string>;
export function redirectRelative(source: string, importer?: string): string | null;
export function localTrackVite(): import('vite').Plugin;
export function localTrackEsbuild(): import('esbuild').Plugin;
