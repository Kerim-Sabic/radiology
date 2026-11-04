/**
 * Study tests run as a signed-in member with active access: the account API is mocked here, because
 * `vite preview` serves no /api and the account gate fails closed. The gate itself (prices, sign-in,
 * unconfirmed payment, service failure) is tested in membership.spec.ts against the same mocks.
 * The account's saved study record is the server's own code on an in-memory store (progressServer.ts).
 */
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { progressServer } from './progressServer';

/** The mocked account for a page or a whole browser context (a second context is a second device). */
export async function signedInMember(target: BrowserContext | Page) {
  await target.route('**/api/config', (r) => r.fulfill({ json: { auth: true, billing: true } }));
  await target.route('**/api/session', (r) =>
    r.fulfill({ json: { user: { name: 'Test Member', email: 'member@example.com' }, access: { active: true, tier: 'lifetime', expiresAt: null }, billingReady: true } }),
  );
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await signedInMember(page);
    await progressServer().attach(page);
    await use(page);
  },
});

export { expect };
export type { Page };
