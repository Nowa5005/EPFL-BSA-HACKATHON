// Pure helpers for the owner's Web/App preview (no DOM, unit-tested in apps/web/test/preview.test.ts).

export const PREVIEW_PATH = '/preview/app';

/** Only same-origin app paths (no "//host", no scheme, not the preview page itself); otherwise the fallback. */
export const safeAppPath = (p: string | null | undefined, fallback = '/sq') =>
  p && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') && !p.startsWith(PREVIEW_PATH) ? p : fallback;

/** Preview page URL showing `path` inside the phone frame. */
export const previewUrlFor = (path: string) => `${PREVIEW_PATH}?path=${encodeURIComponent(safeAppPath(path))}`;

/** iframe src: the same route of the same app, marked as app mode with ?app=1. */
export function frameSrc(path: string) {
  const p = safeAppPath(path);
  const [beforeHash, hash = ''] = p.split('#');
  const sep = beforeHash.includes('?') ? '&' : '?';
  return `${beforeHash}${sep}app=1${hash ? `#${hash}` : ''}`;
}

/** Removes the ?app=1 marker from a path reported by the frame. */
export function stripAppFlag(path: string) {
  const u = new URL(path, 'http://x');
  u.searchParams.delete('app');
  return u.pathname + (u.search === '?' ? '' : u.search) + u.hash;
}
