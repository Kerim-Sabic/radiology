/**
 * Study tests run as a signed-in member with active access: the account API is mocked here, because
 * `vite preview` serves no /api and the account gate fails closed. The gate itself (prices, sign-in,
 * unconfirmed payment, service failure) is tested in membership.spec.ts against the same mocks.
 */
import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/api/config', (r) => r.fulfill({ json: { auth: true, billing: true } }));
    await page.route('**/api/session', (r) =>
      r.fulfill({ json: { user: { name: 'Test Member', email: 'member@example.com' }, access: { active: true, tier: 'lifetime', expiresAt: null }, billingReady: true } }),
    );
    await use(page);
  },
});

export { expect };
export type { Page };
