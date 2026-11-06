/**
 * Every finding the datasets' experts outlined has a condition entry, so the finding drill and the conditions page can say
 * what to look for and link the book (a new pack's finding class without one left the drill's explanation empty).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { conditionForFinding } from '../src/services/drill';

describe('finding conditions', () => {
  it('every expert finding class in the installed packs maps to a condition with signs and a book page', () => {
    const P = join(__dirname, '..', 'public', 'packs');
    const ids = new Set<string>();
    for (const d of readdirSync(P)) {
      const f = join(P, d, 'pack.json');
      if (!existsSync(f)) continue;
      for (const t of JSON.parse(readFileSync(f, 'utf-8')).referenceTargets as Array<{ classId: string; provenance: string }>)
        if (t.classId.startsWith('finding:') && t.provenance === 'source_manual') ids.add(t.classId);
    }
    expect(ids.size).toBeGreaterThan(10);
    const missing = [...ids].filter((c) => !conditionForFinding(c));
    expect(missing).toEqual([]);
    for (const c of ids) {
      const cond = conditionForFinding(c)!;
      expect(cond.signs.length, c).toBeGreaterThan(0);
      expect(cond.book.length, c).toBeGreaterThan(0);
    }
  });
});
