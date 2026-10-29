import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The title shown before an answer (Assess, quick search, drills, saved images) must never give the diagnosis away.
// A dataset's name does (a stroke collection, a fracture atlas, a liver-cancer series), so titles follow one pattern.
const root = resolve(__dirname, '../public/packs');
const index = JSON.parse(readFileSync(resolve(root, 'index.json'), 'utf8')) as { packs: Array<{ manifest: string; lessons: string | null }> };
const cases = index.packs.flatMap((p) => {
  const file = resolve(root, p.lessons ?? p.manifest.replace(/pack\.json$/, 'lessons.json'));
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, 'utf8')) as { cases: Array<{ id: string; neutralTitle: string; learnTitle: string }> }).cases;
});
const sourceWords = index.packs.flatMap((p) => {
  const m = JSON.parse(readFileSync(resolve(root, p.manifest), 'utf8')) as { sources: Array<{ id: string; name: string }> };
  return m.sources.flatMap((s) => [s.id, ...s.name.split(/[\s()]+/)]).filter((w) => w.length >= 4 && /[A-Z0-9]/.test(w) && !/^(Lung|Chest|Breast|Brain|Knee|Wrist|Digital|Pediatric|Segmentation|Challenge|Clinical|Center|Cancer|Imaging|Archive)$/i.test(w));
});
// Collections whose name hints at the diagnosis (or the source), as they appear in scan descriptions.
const DATASETS = /\b(NIH|ChestX-ray14|FUMPE|ISLES|FracAtlas|GRAZPEDWRI|CBIS|DDSM|Breast-Lesions-USG|BrEaST|HC18|Lung-PET-CT-Dx|HCC-TACE|VS-SEG|CRLM|Colorectal-Liver|LNQ|KiTS\d*|LIDC(-IDRI)?|ReMIND|Spine-Mets|Soft-tissue-Sarcoma|PROSTATEx|RICORD|LCTSC|Pediatric-CT-SEG)\b|\b[Ss]troke\b/;

describe('neutral case titles', () => {
  it('every case is "Patient <code> · <scan>", with no dataset name or image number', () => {
    expect(cases.length).toBeGreaterThan(50);
    const bad = cases.filter((c) => !/^Patient [A-Z]{1,3} · [^·]+$/.test(c.neutralTitle) || /\d{3,}/.test(c.neutralTitle));
    expect(bad.map((c) => `${c.id}: ${c.neutralTitle}`)).toEqual([]);
    const leaks = cases.filter((c) => sourceWords.some((w) => c.neutralTitle.toLowerCase().includes(w.toLowerCase())) || DATASETS.test(c.neutralTitle));
    expect(leaks.map((c) => `${c.id}: ${c.neutralTitle}`)).toEqual([]);
  });

  it('patient codes are unique', () => {
    const codes = cases.map((c) => c.neutralTitle.split(' · ')[0]);
    expect(codes.filter((c, i) => codes.indexOf(c) !== i)).toEqual([]);
  });
});

describe('scan descriptions shown while answering', () => {
  it('study and series descriptions never name the collection or the diagnosis', () => {
    const leaks: string[] = [];
    for (const p of index.packs) {
      const m = JSON.parse(readFileSync(resolve(root, p.manifest), 'utf8')) as {
        studies: Array<{ description: string }>;
        series: Array<{ description: string; acquisition: Record<string, unknown> }>;
      };
      const texts = [...m.studies.map((s) => s.description), ...m.series.flatMap((s) => [s.description, String(s.acquisition.SeriesDescription ?? ''), String(s.acquisition.StudyDescription ?? '')])];
      for (const t of texts) if (DATASETS.test(t)) leaks.push(`${p.manifest}: ${t}`);
    }
    expect([...new Set(leaks)]).toEqual([]);
  });
});

describe('clinical context shown before answering', () => {
  it('never states the diagnosis', () => {
    const all = index.packs.flatMap((p) => {
      const file = resolve(root, p.lessons ?? p.manifest.replace(/pack\.json$/, 'lessons.json'));
      if (!existsSync(file)) return [];
      return (JSON.parse(readFileSync(file, 'utf8')) as { cases: Array<{ id: string; clinicalContext: string | null }> }).cases;
    });
    const bad = all.filter((c) => /stroke|carcinoma|schwannoma|metasta|sarcoma|embol|fracture|tumou?r|nodule|pneumothorax|effusion|confirmed by biopsy/i.test(c.clinicalContext ?? ''));
    expect(bad.map((c) => `${c.id}: ${c.clinicalContext}`)).toEqual([]);
  });
});
