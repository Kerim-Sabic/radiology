/**
 * The account's saved study record for e2e tests (`vite preview` serves no /api): the server's own functions
 * (server/progressSync.ts) and Lua script, on an in-memory Redis shared by every page or browser context it is
 * attached to, so two contexts act as two devices of one account. `down` makes uploads and reads fail as if the
 * network were gone.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { FakeRedis } from '../tests/fakeRedis';
import { pullAttempts, pushAttempts, resetAttempts } from '../server/progressSync';

const USER = 'e2e-member';

export function progressServer() {
  const redis = new FakeRedis();
  const db = redis.client() as never;
  const server = {
    down: false,
    /** Entries in the account's log (one per committed attempt, plus later self-reviews). */
    entries: () => (redis.lists.get(`rvm:progress:${USER}:log`) ?? []).map((e) => JSON.parse(e) as { t: string; a?: { id: string } }),
    async attach(target: BrowserContext | Page) {
      await target.route('**/api/progress/**', async (route) => {
        if (server.down) return route.abort('internetdisconnected');
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === '/api/progress/attempts' && request.method() === 'POST') {
          const r = await pushAttempts(USER, request.postData() ?? '', db);
          return route.fulfill({ status: r.ok ? 200 : r.status, json: r.ok ? r : { error: r.error } });
        }
        if (url.pathname === '/api/progress/attempts' && request.method() === 'GET')
          return route.fulfill({ json: await pullAttempts(USER, Number(url.searchParams.get('after') ?? 0), url.searchParams.get('gen'), db) });
        if (url.pathname === '/api/progress/reset' && request.method() === 'POST') return route.fulfill({ json: await resetAttempts(USER, db) });
        return route.fulfill({ status: 404, json: { error: 'Not found' } });
      });
    },
  };
  return server;
}
