/**
 * Condition look-up: the curated list (book anchors checked against the book's own section and figure
 * index), forgiving matching without false hits, and case results built from the REAL installed packs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONDITIONS, CONDITION_BY_ID, type Condition } from '../src/content/conditions';
import { editDistance, findCases, groupByFamily, normalizeQuery, searchConditions, whereText, type CatalogView } from '../src/services/conditionSearch';
import { LessonFile, PackManifest, TargetGeometry, type ReferenceTarget, type Series, type Task, type TeachingCase } from '../src/schema/content';
import { sliceNormal } from '../src/lib/geometry';

const ROOT = join(__dirname, '..');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));
const top = (q: string) => searchConditions(q)[0]?.condition.id ?? null;
const ids = (q: string) => searchConditions(q).map((m) => m.condition.id);

describe('curated condition list', () => {
  const sections = read(join(ROOT, 'public/content/book/sections.v1.json')).sections as Array<{ physical: number; chapterId: string | null; title: string; kind: string }>;
  const figures = read(join(ROOT, 'public/content/book/figures.v1.json')).figures as Array<{ id: string; physical: number; chapterId: string | null }>;

  it('has unique ids, existing related conditions and something to say', () => {
    expect(new Set(CONDITIONS.map((c) => c.id)).size).toBe(CONDITIONS.length);
    for (const c of CONDITIONS) {
      for (const r of c.related) expect(CONDITION_BY_ID.has(r), `${c.id} → ${r}`).toBe(true);
      expect(c.signs.length, c.id).toBeGreaterThan(0);
      expect(c.book.length, c.id).toBeGreaterThan(0);
      expect(c.modalities.length, c.id).toBeGreaterThan(0);
    }
  });

  it('anchors every book reference to a heading or figure that the book index places on that page', () => {
    const bad: string[] = [];
    for (const c of CONDITIONS)
      for (const a of c.book) {
        const ok = a.heading
          ? sections.some((s) => s.physical === a.physical && s.title === a.heading && s.chapterId === a.chapterId)
          : figures.some((f) => f.physical === a.physical && f.id === a.figureId && f.chapterId === a.chapterId);
        if (!ok) bad.push(`${c.id}: p${a.physical} ${a.chapterId} ${a.heading ?? a.figureId}`);
      }
    expect(bad).toEqual([]);
  });

  it('never gives two conditions the same exact name or synonym', () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const c of CONDITIONS)
      for (const t of new Set([c.name, ...c.synonyms].map(normalizeQuery))) {
        if (owner.has(t) && owner.get(t) !== c.id) clashes.push(`${t}: ${owner.get(t)} / ${c.id}`);
        owner.set(t, c.id);
      }
    expect(clashes).toEqual([]);
  });
});

describe('matching', () => {
  it('normalizes British spelling, accents, punctuation and COVID-19', () => {
    expect(normalizeQuery('Haemothorax')).toBe('hemothorax');
    expect(normalizeQuery('  Pulmonary  OEDEMA ')).toBe('pulmonary edema');
    expect(normalizeQuery('COVID-19')).toBe('covid19');
    expect(normalizeQuery('covid 19 pneumonia')).toBe('covid19 pneumonia');
    expect(normalizeQuery('Tumour')).toBe('tumor');
    expect(normalizeQuery('Herniated disk')).toBe('herniated disc');
    expect(normalizeQuery('Pneumothórax')).toBe('pneumothorax');
  });

  it('measures typos with adjacent swaps counted once', () => {
    expect(editDistance('hemothorax', 'hemothorax')).toBe(0);
    expect(editDistance('hemothrax', 'hemothorax')).toBe(1);
    expect(editDistance('pnuemothorax', 'pneumothorax')).toBe(1);
    expect(editDistance('thorax', 'hemothorax')).toBe(4);
  });

  it('finds the condition by name, synonym, abbreviation, spelling variant and typo', () => {
    expect(top('hemothorax')).toBe('hemothorax');
    expect(top('Haemothorax')).toBe('hemothorax');
    expect(top('hemothrax')).toBe('hemothorax');
    expect(top('haemopneumothorax')).toBe('hemothorax');
    expect(top('PTX')).toBe('pneumothorax');
    expect(top('pnuemothorax')).toBe('pneumothorax');
    expect(top('tension pneumothorax on CT')).toBe('tension_pneumothorax');
    expect(top('PE')).toBe('pulmonary_embolism');
    expect(top('SBO')).toBe('small_bowel_obstruction');
    expect(top('COVID 19')).toBe('covid19');
    expect(top('pulmonary oedema')).toBe('congestive_heart_failure');
    expect(top('renal cell carcinoma')).toBe('renal_mass');
    expect(top('kidney stone')).toBe('kidney_stones');
    expect(top('glioblastoma')).toBe('brain_tumor');
    expect(top('fracture')).toBe('fracture');
    expect(top('effusion')).toBe('pleural_effusion');
    expect(top('consolidation')).toBe('airspace_disease');
  });

  it('finds the breast, pregnancy and childhood fracture entries', () => {
    expect(top('breast cyst')).toBe('breast_cyst');
    expect(top('microcalcifications')).toBe('breast_calcifications');
    expect(top('fibroadenoma')).toBe('breast_mass');
    expect(top('buckle fracture')).toBe('torus_greenstick_fracture');
    expect(top('greenstick')).toBe('torus_greenstick_fracture');
    expect(top('growth plate fracture')).toBe('salter_harris_fracture');
    expect(top('Salter Harris')).toBe('salter_harris_fracture');
    expect(top('head circumference')).toBe('pregnancy_ultrasound');
  });

  it('matches word beginnings as you type', () => {
    expect(ids('pneumo')).toEqual(expect.arrayContaining(['pneumothorax', 'pneumonia', 'pneumomediastinum', 'pneumoperitoneum']));
    expect(ids('hemo').includes('hemothorax')).toBe(true);
  });

  it('lists every kind of metastasis for "metastases"', () => {
    expect(ids('metastases')).toEqual(expect.arrayContaining(['lung_metastases', 'bone_metastases', 'liver_metastases', 'brain_metastases']));
  });

  it('never matches inside a word or across unrelated names', () => {
    expect(ids('thorax')).not.toContain('hemothorax');
    expect(ids('thorax')).not.toContain('pneumothorax');
    expect(ids('ax')).toEqual([]);
    expect(ids('hemothorax')).not.toContain('pneumothorax');
    // A real word of another condition is never read as a typo.
    expect(ids('hemothorax')).not.toContain('opacified_hemithorax');
    expect(ids('hemithorax')).not.toContain('hemothorax');
    expect(ids('pneumothorax')).not.toContain('hemothorax');
    expect(ids('banana')).toEqual([]);
    expect(ids('')).toEqual([]);
  });
});

// ------------------------------------------------------------------ results from a small fake catalog

const series = (uid: string, modality: string, n: number): Series =>
  ({ uid, modality, description: `${modality} series`, number: 1, studyUid: `st-${uid}`, instances: Array.from({ length: n }, (_, i) => ({ sopInstanceUid: `${uid}-${i}` })) }) as unknown as Series;
const kase = (id: string, subjectKey: string, seriesUid: string): TeachingCase =>
  ({ id, neutralTitle: `Patient ${id}`, subjectKey, primarySeriesUid: seriesUid, studyUids: [`st-${seriesUid}`] }) as unknown as TeachingCase;
const target = (id: string, classId: string, seriesUid: string, geometryType: ReferenceTarget['geometryType'] = 'contour_set'): ReferenceTarget =>
  ({ id, classId, seriesUid, label: id, geometryType }) as unknown as ReferenceTarget;

function fakeCatalog(cases: TeachingCase[], ser: Series[], targets: ReferenceTarget[], tasks: Task[] = []): CatalogView {
  const byStudy = new Map(ser.map((s) => [s.studyUid, s]));
  return {
    cases: new Map(cases.map((k) => [k.id, k])),
    series: new Map(ser.map((s) => [s.uid, s])),
    targets: new Map(targets.map((t) => [t.id, t])),
    tasksByCase: new Map(cases.map((k) => [k.id, tasks.filter((t) => t.caseId === k.id)])),
    seriesForCase: (k: TeachingCase) => k.studyUids.map((s) => byStudy.get(s)!).filter(Boolean),
    thumbnailUrl: () => null,
    seriesSource: (uid: string) => {
      const s = ser.find((x) => x.uid === uid);
      return s ? ({ sopUids: s.instances.map((i) => i.sopInstanceUid) } as never) : null;
    },
  } as unknown as CatalogView;
}

describe('case results', () => {
  const cond = (patch: Partial<Condition>): Condition => ({ ...CONDITION_BY_ID.get('lung_nodule')!, ...patch });

  it('says which images an outline is on, in viewer order', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    const g = { geometryType: 'contour_set', space: 'image_px', planes: [{ sopInstanceUid: 'c', frame: 1, polygons: [] }, { sopInstanceUid: 'b', frame: 1, polygons: [] }] } as unknown as Extract<TargetGeometry, { geometryType: 'contour_set' }>;
    expect(whereText(g, order)).toBe('images 2–3 of 5');
    expect(whereText({ ...g, planes: [g.planes[0]] } as TargetGeometry, order)).toBe('image 3 of 5');
    expect(whereText(g, ['c'])).toBe('outlined on the image');
    expect(whereText(null, order)).toBeUndefined();
  });

  it('links outlined findings to their learn-mode task and groups by modality', async () => {
    const ser = [series('ct1', 'CT', 5), series('xr1', 'DX', 1)];
    const k = { ...kase('k1', 'tcia:LIDC-IDRI:1', 'ct1'), studyUids: ['st-ct1', 'st-xr1'] } as TeachingCase;
    const tasks = [{ id: 'k1:search', caseId: 'k1', modes: ['learn', 'practice'], start: { seriesUid: 'ct1' }, seriesUids: ['ct1'], targets: [{ targetId: 'n1' }, { targetId: 'n2' }] }] as unknown as Task[];
    const cat = fakeCatalog([k], ser, [target('n1', 'finding:lung_nodule', 'ct1'), target('n2', 'finding:lung_nodule', 'ct1')], tasks);
    const geo = { geometryType: 'contour_set', space: 'image_px', planes: [{ sopInstanceUid: 'ct1-3', frame: 1, polygons: [] }] } as unknown as TargetGeometry;
    const hits = await findCases(cat, CONDITION_BY_ID.get('lung_nodule')!, async () => geo);
    expect(hits).toHaveLength(1);
    expect(hits[0].strength).toBe('outlined');
    expect(hits[0].items.map((i) => i.where)).toEqual(['image 4 of 5', 'image 4 of 5']);
    expect(hits[0].link).toBe('/read/k1?task=k1%3Asearch&mode=learn&show=n1');
    expect(groupByFamily(hits).map((g) => g.family)).toEqual(['CT']);
  });

  it('uses only labels that every reader group agreed on', async () => {
    const ser = [series('x1', 'CR', 1), series('x2', 'CR', 1)];
    const cases = [kase('r1', 'tcia:MIDRC-RICORD-1C:1', 'x1'), kase('r2', 'tcia:MIDRC-RICORD-1C:2', 'x2')];
    const t = [target('x1a', 'label:ricord', 'x1', 'image_label'), target('x1b', 'label:ricord', 'x1', 'image_label'), target('x2a', 'label:ricord', 'x2', 'image_label'), target('x2b', 'label:ricord', 'x2', 'image_label')];
    const labels: Record<string, string[]> = {
      x1a: ['Typical Appearance', 'Moderate Opacities (3-4 lung zones)'],
      x1b: ['Typical Appearance', 'Moderate Opacities (3-4 lung zones)'],
      x2a: ['Typical Appearance'],
      x2b: ['Negative for Pneumonia'],
    };
    const load = async (id: string) => ({ geometryType: 'image_label', sopInstanceUids: [], labels: labels[id] }) as unknown as TargetGeometry;
    const covid = CONDITION_BY_ID.get('covid19')!;
    const hits = await findCases(fakeCatalog(cases, ser, t), { ...covid, evidence: covid.evidence!.filter((e) => e.kind === 'reader_labels') }, load);
    expect(hits.map((h) => h.caseId)).toEqual(['r1']);
    expect(hits[0].items[0].label).toContain('All 2 reader groups');
  });

  it('shows collection-only patients as not outlined, and never twice', async () => {
    const ser = [series('s1', 'CT', 3)];
    const hits = await findCases(fakeCatalog([kase('sp', 'tcia:Spine-Mets-CT-SEG:1', 's1')], ser, []), CONDITION_BY_ID.get('bone_metastases')!, async () => null);
    expect(hits).toHaveLength(1);
    expect(hits[0].strength).toBe('collection');
    expect(hits[0].items).toEqual([]);
    expect(await findCases(fakeCatalog([], [], []), cond({ evidence: undefined }), async () => null)).toEqual([]);
  });
});

// ------------------------------------------------------------------ the real installed packs

function realCatalog(): { view: CatalogView; load: (id: string) => Promise<TargetGeometry | null> } | null {
  const PACKS = join(ROOT, 'public', 'packs');
  if (!existsSync(PACKS)) return null;
  const ser = new Map<string, Series>();
  const studySeries = new Map<string, Series[]>();
  const targets = new Map<string, ReferenceTarget>();
  const files = new Map<string, string>();
  const cases = new Map<string, TeachingCase>();
  const tasksByCase = new Map<string, Task[]>();
  for (const d of readdirSync(PACKS, { withFileTypes: true })) {
    if (!d.isDirectory() || !existsSync(join(PACKS, d.name, 'pack.json'))) continue;
    const m = PackManifest.parse(read(join(PACKS, d.name, 'pack.json')));
    for (const s of m.series) {
      ser.set(s.uid, s);
      studySeries.set(s.studyUid, [...(studySeries.get(s.studyUid) ?? []), s]);
    }
    for (const t of m.referenceTargets) {
      targets.set(t.id, t);
      files.set(t.id, join(PACKS, d.name, t.geometryFile));
    }
    const lp = join(PACKS, d.name, 'lessons.json');
    if (existsSync(lp)) {
      const l = LessonFile.parse(read(lp));
      for (const k of l.cases) cases.set(k.id, k);
      for (const t of l.tasks) tasksByCase.set(t.caseId, [...(tasksByCase.get(t.caseId) ?? []), t]);
    }
  }
  const view = {
    cases,
    series: ser,
    targets,
    tasksByCase,
    seriesForCase: (k: TeachingCase) => k.studyUids.flatMap((s) => studySeries.get(s) ?? []),
    thumbnailUrl: () => null,
    seriesSource: (uid: string) => {
      const s = ser.get(uid);
      if (!s) return null;
      // Same display order as the viewer: axial stacks head → feet.
      const n = s.geometry.iop ? sliceNormal(s.geometry.iop) : null;
      const inst = n && Math.abs(n[2]) > 0.7 && n[2] > 0 ? [...s.instances].reverse() : s.instances;
      return { sopUids: inst.flatMap((i) => Array.from({ length: i.frames }, () => i.sopInstanceUid)) } as never;
    },
  } as unknown as CatalogView;
  const load = async (id: string) => {
    const f = files.get(id);
    return f && existsSync(f) ? TargetGeometry.parse(read(f)) : null;
  };
  return { view, load };
}

const real = realCatalog();

describe.skipIf(!real)('results from the installed cases', () => {
  const run = (id: string) => findCases(real!.view, CONDITION_BY_ID.get(id)!, real!.load);

  it('has no case for hemothorax (none is labelled), and says nothing it cannot back up', async () => {
    expect(await run('hemothorax')).toEqual([]);
  });

  it('finds the pneumothorax radiographs with the radiologist box and a link to it', async () => {
    const hits = await run('pneumothorax');
    if (!hits.length) return; // pack not installed in this checkout
    expect(new Set(hits.map((h) => h.caseId)).size).toBeGreaterThanOrEqual(4);
    for (const h of hits) {
      expect(h.family).toBe('X-ray');
      expect(h.strength).toBe('outlined');
      expect(h.items.every((i) => i.where === 'boxed on the image')).toBe(true);
      expect(h.link).toMatch(/&show=/);
    }
  });

  it('finds the lung cancer CTs, boxed on a run of consecutive images', async () => {
    const hits = await run('lung_cancer');
    const ct = hits.filter((h) => h.family === 'CT');
    if (!ct.length) return; // pack not installed in this checkout
    expect(new Set(ct.map((h) => h.caseId)).size).toBe(4);
    for (const h of ct) {
      expect(h.items.some((i) => /^images \d+–\d+ of \d+$/.test(i.where ?? ''))).toBe(true);
      expect(h.link).toMatch(/&show=lung-dx-/);
    }
  });

  it('finds the new tumors and the stroke lesions on their own series', async () => {
    for (const [id, family, n] of [['hepatocellular_carcinoma', 'CT', 2], ['vestibular_schwannoma', 'MRI', 1], ['ischemic_stroke', 'MRI', 2]] as const) {
      const hits = await run(id);
      if (!hits.length) continue; // pack not installed in this checkout
      expect(new Set(hits.map((h) => h.caseId)).size).toBe(n);
      for (const h of hits) {
        expect(h.family).toBe(family);
        expect(h.strength).toBe('outlined');
      }
    }
  });

  it('finds every outlined lung nodule with the images it is on', async () => {
    const hits = await run('lung_nodule');
    const nodules = [...real!.view.targets.values()].filter((t) => t.classId === 'finding:lung_nodule' && [...real!.view.cases.values()].some((k) => real!.view.seriesForCase(k).some((s) => s.uid === t.seriesUid)));
    expect(hits.flatMap((h) => h.items).length).toBe(nodules.length);
    // LIDC CT nodules (outlines) and NIH chest radiograph nodules (radiologist boxes).
    expect(hits.some((h) => h.family === 'CT')).toBe(true);
    for (const h of hits) {
      expect(['CT', 'X-ray']).toContain(h.family);
      expect(h.strength).toBe('outlined');
      expect(h.link).toMatch(/^\/read\/[^?]+\?task=.+&mode=learn&show=/);
      if (h.family === 'CT') for (const it of h.items) expect(it.where).toMatch(/^images? \d+(–\d+)? of \d+$/);
    }
  });

  it('lists COVID-19 radiographs only where every reader group agreed on a COVID-19 category', async () => {
    const hits = await run('covid19');
    for (const h of hits.filter((x) => x.strength === 'labelled')) expect(h.items[0].label).toMatch(/Typical|Indeterminate|Atypical/);
    // A radiograph the readers called negative for pneumonia is never listed as COVID-19 pneumonia.
    expect(hits.some((h) => h.items.some((i) => /Negative for Pneumonia/.test(i.label) && !/Appearance/.test(i.label)))).toBe(false);
    // Patients known only from a COVID-positive cohort are listed as not outlined.
    for (const h of hits.filter((x) => x.strength === 'collection')) expect(h.note).toMatch(/may be normal/);
  });

  it('shows the sarcoma outlines on each MRI sequence and on CT', async () => {
    const hits = await run('soft_tissue_sarcoma');
    if (!hits.length) return;
    expect(new Set(hits.map((h) => h.family))).toEqual(new Set(['MRI', 'CT']));
    for (const h of hits) expect(h.items.map((i) => i.label)).toContain('Tumor');
  });

  it('shows breast cysts on ultrasound and calcifications on both mammographic views', async () => {
    const cysts = await run('breast_cyst');
    if (!cysts.length) return; // round-3 packs not installed in this checkout
    expect(new Set(cysts.map((h) => h.caseId)).size).toBe(2);
    for (const h of cysts) expect([h.family, h.strength, h.items[0].where]).toEqual(['Ultrasound', 'outlined', 'outlined on the image']);
    const calcs = await run('breast_calcifications');
    expect(new Set(calcs.map((h) => h.caseId)).size).toBe(2);
    expect(calcs).toHaveLength(4); // a CC and an MLO for each woman
    for (const h of calcs) expect([h.family, h.strength]).toEqual(['Mammography', 'outlined']);
    const masses = await run('breast_mass');
    expect(new Set(masses.map((h) => h.family))).toEqual(new Set(['Mammography', 'Ultrasound']));
    expect(masses.some((h) => /invasive carcinoma/.test(h.items[0].label))).toBe(true);
  });

  it("finds the children's wrist fractures on both views, by type", async () => {
    const sh = await run('salter_harris_fracture');
    if (!sh.length) return;
    const torus = await run('torus_greenstick_fracture');
    for (const hits of [sh, torus]) {
      expect(new Set(hits.map((h) => h.caseId)).size).toBe(2);
      expect(hits).toHaveLength(4); // frontal and lateral of each child
      for (const h of hits) {
        expect(h.family).toBe('X-ray');
        expect(h.items.every((i) => i.where === 'boxed on the image')).toBe(true);
        expect(h.link).toMatch(/&show=grazpedwri-/);
      }
    }
    expect(sh.every((h) => /Salter-Harris type II/.test(h.items[0].label))).toBe(true);
    const all = await run('fracture');
    for (const h of [...sh, ...torus]) expect(all.some((x) => x.seriesUid === h.seriesUid)).toBe(true);
  });

  it('lists knee osteoarthritis only where both experts gave Kellgren-Lawrence 2 or more', async () => {
    const hits = await run('osteoarthritis');
    if (!hits.length) return;
    expect(hits).toHaveLength(2);
    for (const h of hits) {
      expect(h.strength).toBe('labelled');
      expect(h.items[0].label).toMatch(/^All 2 reader groups: Kellgren-Lawrence grade [24] /);
    }
    const graded = [...real!.view.targets.values()].filter((t) => t.classId === 'label:knee_kl_grade');
    expect(graded).toHaveLength(6); // three knees, two experts each; the grade 0 knee is not listed
  });

  it('shows the fetal heads with the sonographer ellipse', async () => {
    const hits = await run('pregnancy_ultrasound');
    if (!hits.length) return;
    expect(new Set(hits.map((h) => h.caseId)).size).toBe(3);
    for (const h of hits) expect([h.family, h.strength]).toEqual(['Ultrasound', 'outlined']);
  });

  it('never repeats a series or lists a patient twice for the same evidence', async () => {
    for (const c of CONDITIONS.filter((x) => x.evidence)) {
      const hits = await run(c.id);
      const keys = hits.map((h) => `${h.seriesUid}|${h.strength}|${h.note}`);
      expect(new Set(keys).size, c.id).toBe(keys.length);
    }
  });
});
