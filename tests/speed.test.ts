/**
 * Speed on a slow phone connection: each free task has its first picture (shown while the reading room downloads),
 * only free cases ask for one, and the sign-in service's address comes from its key for an early connection.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { posterUrl } from '../src/components/RoomPreview';
import { clerkFrontendHost } from '../src/auth/AccountGate';
import { FREE_CASES } from '../src/content/weekly';

describe('posters', () => {
  it('exist for every task of the always-free cases, small enough for a slow connection', () => {
    const tasks: Array<{ id: string; caseId: string }> = [];
    for (const pack of ['starter', 'cxr-findings']) {
      const lessons = JSON.parse(readFileSync(`public/packs/${pack}/lessons.json`, 'utf8')) as { tasks: Array<{ id: string; caseId: string }> };
      tasks.push(...lessons.tasks.filter((t) => FREE_CASES.includes(t.caseId)));
    }
    expect(tasks.length).toBeGreaterThan(5);
    for (const t of tasks) {
      const url = posterUrl(t.caseId, t.id)!;
      const file = `public${decodeURIComponent(url)}`;
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size, file).toBeLessThan(40_000);
    }
  });

  it('are asked for only on the free cases, for their own tasks', () => {
    expect(posterUrl('starter-ct-chest-01', 'starter-ct-chest-01:esophagus')).toBe('/landing/posters/starter-ct-chest-01--esophagus.webp');
    expect(posterUrl('pe-pat005', 'pe-pat005:locate')).toBeNull();
    expect(posterUrl('starter-ct-chest-01', 'pe-pat005:locate')).toBeNull();
    expect(posterUrl('starter-ct-chest-01', null)).toBeNull();
  });
});

describe('early connections', () => {
  it('reads the sign-in service host from its publishable key, and nothing from a bad one', () => {
    const key = `pk_live_${Buffer.from('clerk.www.radiology.monster$').toString('base64')}`;
    expect(clerkFrontendHost(key)).toBe('https://clerk.www.radiology.monster');
    expect(clerkFrontendHost(undefined)).toBeNull();
    expect(clerkFrontendHost('pk_live_!!!')).toBeNull();
    expect(clerkFrontendHost(`pk_live_${Buffer.from('javascript:alert(1)$').toString('base64')}`)).toBeNull();
  });
});
