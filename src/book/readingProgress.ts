/** Pages of the book you have opened in the reader (this browser only; small, so localStorage). */
const KEY = 'rvm.bookPagesRead.v1';
const listeners = new Set<() => void>();
let cache: Set<number> | null = null;

function load(): Set<number> {
  if (cache) return cache;
  try {
    cache = new Set((JSON.parse(localStorage.getItem(KEY) ?? '[]') as number[]).filter((n) => Number.isInteger(n)));
  } catch {
    cache = new Set();
  }
  return cache;
}

export const readingProgress = {
  pages: () => load(),
  markRead(physical: number) {
    const s = load();
    if (s.has(physical)) return;
    s.add(physical);
    try {
      localStorage.setItem(KEY, JSON.stringify([...s]));
    } catch {
      /* storage unavailable: keep in memory */
    }
    listeners.forEach((l) => l());
  },
  fraction(range: [number, number]): number {
    const s = load();
    let n = 0;
    for (let p = range[0]; p <= range[1]; p++) if (s.has(p)) n++;
    return n / (range[1] - range[0] + 1);
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
