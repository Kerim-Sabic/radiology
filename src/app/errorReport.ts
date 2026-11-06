/**
 * What to tell someone when the app fails, and what to do about it. Pure functions, so the
 * wording and the reload rule are tested without a browser (tests/errorReport.test.ts).
 */

export type ErrorKind = 'stale' | 'offline' | 'crash';

export interface ErrorCopy {
  kind: ErrorKind;
  /** The overlay tag on the dimmed scan, like a viewer's status line. */
  tag: string;
  title: string;
  body: string;
}

/** A code file of the app failed to load: a dropped connection, or a release replaced the old files. */
export const isStaleRelease = (message: string) =>
  /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically|Unable to preload CSS/i.test(message);

const isNetwork = (message: string) => /Failed to fetch|NetworkError|Load failed|network error|ERR_INTERNET_DISCONNECTED/i.test(message);

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** The headline and explanation for an error. `scope` says whether the whole app or one page failed. */
export function describeError(error: unknown, scope: 'app' | 'page', online = true): ErrorCopy {
  const message = errorMessage(error);
  if (isStaleRelease(message))
    return {
      kind: 'stale',
      tag: 'Series incomplete',
      title: scope === 'app' ? 'Radiology Monster didn’t finish loading' : 'This page didn’t finish loading',
      body: 'The connection dropped, or Radiology Monster was updated while this tab was open. Reload to get the latest version. Answers you submitted are kept.',
    };
  if (!online || isNetwork(message))
    return {
      kind: 'offline',
      tag: 'No signal',
      title: 'You seem to be offline',
      body: 'Check your connection, then reload. Answers you submitted are kept, and anything not yet sent is saved on this device.',
    };
  return {
    kind: 'crash',
    tag: 'Image not rendered',
    title: scope === 'app' ? 'Radiology Monster hit a problem' : 'This page hit a problem',
    body: 'Something went wrong while showing this screen. Answers you submitted are kept. Reload to try again; if it keeps happening, copy the details below and send them to us.',
  };
}

/** The text "Copy details" puts on the clipboard: enough to find the bug, nothing personal. */
export function errorDetails(error: unknown, where: { url: string; userAgent: string; at: Date; stack?: string | null }): string {
  const stack = where.stack ?? (error instanceof Error ? error.stack : undefined);
  return [
    errorMessage(error),
    `Page: ${where.url.split('?')[0]}`,
    `Time: ${where.at.toISOString()}`,
    `Browser: ${where.userAgent}`,
    stack ? `\n${stack.split('\n').slice(0, 12).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Key for the last automatic reload after a failed code download. */
export const AUTO_RELOAD_KEY = 'rvm:auto-reload-at';
/** One automatic reload per minute at most, so a file that is really missing ends on the error screen, not in a loop. */
export const AUTO_RELOAD_WINDOW_MS = 60_000;

export function mayAutoReload(lastReloadAt: string | null, now: number): boolean {
  const last = Number(lastReloadAt);
  return !lastReloadAt || !Number.isFinite(last) || now - last > AUTO_RELOAD_WINDOW_MS;
}

/** Whether an error boundary should reload for this error (a stale code file, no reload in the last minute). */
export function willReloadFor(error: unknown, storage: Pick<Storage, 'getItem'> | null, now = Date.now()): boolean {
  if (!storage || !isStaleRelease(errorMessage(error))) return false;
  try {
    return mayAutoReload(storage.getItem(AUTO_RELOAD_KEY), now);
  } catch {
    return false;
  }
}

/** This tab's sessionStorage, or null where the browser blocks it. */
export function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reload the tab once to pick up a new release's code files. Returns true if it is reloading. Called from Vite's
 * preload-error event (main.tsx) and from the error boundaries: a chunk without dependencies is a plain `import()`
 * that never fires that event, so the boundary has to catch the same failure.
 */
export function reloadOnceForNewRelease(storage: Pick<Storage, 'getItem' | 'setItem'> | null, reload: () => void, now = Date.now()): boolean {
  if (!storage) return false;
  try {
    if (!mayAutoReload(storage.getItem(AUTO_RELOAD_KEY), now)) return false;
    storage.setItem(AUTO_RELOAD_KEY, String(now));
  } catch {
    return false; // storage blocked: show the error screen rather than risk a reload loop
  }
  reload();
  return true;
}
