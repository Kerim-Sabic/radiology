import { describe, expect, it } from 'vitest';
import { PAGES, paletteItems, paletteSearch } from '../src/services/palette';

const catalog = {
  cases: new Map([
    ['pe-pat005', { id: 'pe-pat005', neutralTitle: 'CT chest with contrast · FUMPE PAT005', learnTitle: 'Pulmonary embolism on CT', region: ['chest'] }],
    ['mg-1', { id: 'mg-1', neutralTitle: 'Mammogram, both breasts, CC and MLO', learnTitle: 'Spiculated carcinoma', region: ['breast'] }],
  ]),
  seriesForCase: (k: { id: string }) => [{ modality: k.id.startsWith('mg') ? 'MG' : 'CT' }],
} as never;
const curriculum = { units: [{ id: 'ch24', kind: 'chapter', number: '24', title: 'Recognizing the Imaging Findings of Trauma to the Chest', objectives: [] }] } as never;
const items = paletteItems(catalog, curriculum);
const titles = (q: string) => paletteSearch(items, q).map((i) => i.title);

describe('quick search', () => {
  it('lists the pages when nothing is typed', () => {
    expect(paletteSearch(items, '')).toHaveLength(12);
    expect(paletteSearch(items, '')[0].title).toBe(PAGES[0].title);
  });

  it('finds pages, conditions, chapters and cases by the start of their words', () => {
    expect(titles('drill')[0]).toBe('Drills');
    expect(titles('shortcuts')[0]).toBe('Guide');
    expect(titles('pneumoth')[0]).toMatch(/^Pneumothorax/);
    expect(titles('trauma chest')).toContain('Recognizing the Imaging Findings of Trauma to the Chest');
    expect(titles('chapter 24')[0]).toBe('Recognizing the Imaging Findings of Trauma to the Chest');
    expect(titles('mammogram')).toContain('Mammogram, both breasts, CC and MLO');
    expect(titles('MG')).toContain('Mammogram, both breasts, CC and MLO'); // by modality
  });

  it('forgives a typo in a condition name', () => {
    expect(titles('pnemothorax')[0]).toMatch(/^Pneumothorax/);
  });

  it('never finds a case by its diagnosis', () => {
    expect(paletteSearch(items, 'spiculated carcinoma').filter((i) => i.kind === 'case')).toHaveLength(0);
    expect(paletteSearch(items, 'embolism').filter((i) => i.kind === 'case')).toHaveLength(0);
    expect(paletteSearch(items, 'embolism').some((i) => i.kind === 'condition')).toBe(true);
  });
});
