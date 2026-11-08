import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FREE_TASK_TEXT } from '../src/content/freeTasks.generated';

const root = join(__dirname, '..');
const posters = readdirSync(join(root, 'public/landing/posters')).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5).replace('--', ':'));
const lessons = new Map<string, { title: string; prompt: string }>();
for (const p of JSON.parse(readFileSync(join(root, 'public/packs/index.json'), 'utf8')).packs as Array<{ lessons?: string }>) {
  const f = join(root, 'public/packs', p.lessons ?? '');
  if (!p.lessons || !existsSync(f)) continue;
  for (const t of JSON.parse(readFileSync(f, 'utf8')).tasks as Array<{ id: string; title: string; prompt: string }>) lessons.set(t.id, t);
}

describe('the case preview knows each free task’s question before the catalogue arrives', () => {
  it('has the question of every task with a first picture, word for word from the lessons (run node scripts/build/freeTasks.mjs)', () => {
    expect(Object.keys(FREE_TASK_TEXT).sort()).toEqual([...posters].sort());
    for (const [id, t] of Object.entries(FREE_TASK_TEXT)) expect({ title: t.title, prompt: t.prompt }).toEqual({ title: lessons.get(id)!.title, prompt: lessons.get(id)!.prompt });
  });

  it('says "Tap the …" only for one-point tasks, as the reading room does', () => {
    expect(FREE_TASK_TEXT['starter-ct-chest-01:esophagus'].tap).toBe('Tap the esophagus');
    expect(FREE_TASK_TEXT['starter-ct-chest-01:heart'].tap).toBe('Tap the heart');
    expect(FREE_TASK_TEXT['starter-ct-chest-01:five-structures'].tap).toBeNull();
    expect(FREE_TASK_TEXT['starter-ct-chest-01:orientation'].tap).toBeNull();
  });
});
