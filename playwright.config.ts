import { defineConfig, devices } from '@playwright/test';

// Acceptance tests run against the PRODUCTION build served by `vite preview`
// (same static output that Netlify/Vercel serve). Run `npm run build` first.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  // x-rvm-test: the anonymous event log drops every request of the suite, even one that reached a real server.
  use: { baseURL: 'http://localhost:4317', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', extraHTTPHeaders: { 'x-rvm-test': '1' } },
  webServer: { command: 'npx vite preview --port 4317 --strictPort', url: 'http://localhost:4317', reuseExistingServer: false, timeout: 60_000 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
  ],
});
