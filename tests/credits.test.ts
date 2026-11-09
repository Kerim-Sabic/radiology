import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const packsDir = join(root, 'public/packs');
type Entry = { ids: string[]; name: string; license: string; url: string; kind: string };
const credits = JSON.parse(readFileSync(join(root, 'public/content/credits.json'), 'utf8')) as { groups: Array<{ kind: string; entries: Entry[] }> };
const entries = credits.groups.flatMap((g) => g.entries);
const credited = new Set(entries.flatMap((e) => e.ids));

const packSourceIds = new Map<string, string>();
for (const d of readdirSync(packsDir)) {
  const f = join(packsDir, d, 'pack.json');
  if (!existsSync(f)) continue;
  for (const s of (JSON.parse(readFileSync(f, 'utf8')).sources ?? []) as Array<{ id: string }>) packSourceIds.set(s.id, d);
}

describe('sources and credits', () => {
  it('names every source of every pack (run python scripts/data/credits.py after adding a pack)', () => {
    expect(packSourceIds.size).toBeGreaterThan(20);
    const missing = [...packSourceIds].filter(([id]) => !credited.has(id)).map(([id, pack]) => `${id} (${pack})`);
    expect(missing).toEqual([]);
  });

  it('gives every entry a name, a licence and a link, and credits each source once', () => {
    for (const e of entries) {
      expect(e.name.trim(), e.ids.join()).not.toBe('');
      expect(e.license.trim(), e.ids.join()).not.toBe('');
      expect(e.url, e.ids.join()).toMatch(/^https?:\/\//);
    }
    const all = entries.flatMap((e) => e.ids);
    expect(new Set(all).size).toBe(all.length);
  });

  it('credits the datasets and tools the owners asked to see named', () => {
    const text = JSON.stringify(entries);
    for (const n of ['ARCADE', 'CADICA', 'TotalSegmentator', 'TopCoW', 'IXI', 'MIDRC-RICORD-1C', 'Horalix', 'Decathlon']) expect(text).toContain(n);
  });
});
