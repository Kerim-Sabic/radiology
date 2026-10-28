import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOX_DAYS,
  bestWindow,
  distanceToShapes,
  distractors,
  inSentence,
  insideShapes,
  kindsFor,
  pickNext,
  presetFor,
  recordAnswer,
  summary,
  type DrillCandidate,
  type DrillStats,
  findingName,
  conditionForFinding,
  REGIONS,
  type DrillKind,
} from '../src/services/drill';
import { landmarks, levelName, mapZ, matchLevels, type Landmark } from '../src/services/levelSync';
import { noteFor, structureBase } from '../src/content/structureNotes';
import { SEARCH_PATTERNS, patternsFor } from '../src/content/searchPatterns';
import { canonicalAnatomyKey } from '../src/content/bookAnatomy';
import { Catalog } from '../src/services/caseRepository';
import { mistakeNotebook, todayPlan } from '../src/services/learningModel';
import { shapeArea, shapeContains, shapeRings, type Shape } from '../src/components/ws/overlayShapes';
import type { LoadedTarget } from '../src/grading/spatialGrader';
import type { ReferenceTarget } from '../src/schema/content';

const cand = (key: string, caseId: string, extra: Partial<DrillCandidate> = {}): DrillCandidate => ({
  caseId,
  targetId: `${caseId}-${key}`,
  seriesUid: `s-${caseId}`,
  key,
  base: structureBase(key),
  name: key,
  family: 'CT',
  provenance: 'source_manual',
  category: 'organ',
  ...extra,
});
const fixed = () => 0.5;

describe('spaced repetition', () => {
  it('moves a structure up a box when right and back to box 0 (asked again soon) when wrong', () => {
    const now = Date.parse('2026-10-27T10:00:00Z');
    let s: DrillStats = {};
    s = recordAnswer(s, cand('liver', 'a'), true, now);
    expect(s.liver.box).toBe(1);
    expect(Date.parse(s.liver.due) - now).toBe(BOX_DAYS[1] * 86400e3);
    s = recordAnswer(s, cand('liver', 'b'), true, now);
    expect(s.liver.box).toBe(2);
    s = recordAnswer(s, cand('liver', 'c'), false, now);
    expect(s.liver).toMatchObject({ box: 0, seen: 3, correct: 2, misses: 1, lastCase: 'c' });
    expect(Date.parse(s.liver.due) - now).toBe(10 * 60e3);
    expect(summary(s, now + 11 * 60e3).due).toBe(1);
  });

  it('asks due structures before new ones, and on a different patient from last time', () => {
    const now = Date.parse('2026-10-27T10:00:00Z');
    const pool = [cand('liver', 'a'), cand('liver', 'b'), cand('spleen', 'a'), cand('pancreas', 'a')];
    let stats: DrillStats = {};
    stats = recordAnswer(stats, pool[0], false, now - 3600e3); // missed an hour ago → due
    stats = recordAnswer(stats, pool[2], true, now - 3600e3); // known → not due
    const pick = pickNext(pool, stats, { region: 'all', kinds: ['locate'], expertOnly: false, recentBases: [], lastCase: null, now, rng: fixed });
    expect(pick?.cand.key).toBe('liver');
    expect(pick?.cand.caseId).toBe('b');
    expect(pick?.kind).toBe('locate');
  });

  it('respects expert-only and modality-specific question types', () => {
    const pool = [cand('heart', 'a', { provenance: 'ai_draft', family: 'XR' })];
    expect(pickNext(pool, {}, { region: 'all', kinds: ['locate'], expertOnly: true, recentBases: [], lastCase: null, rng: fixed })).toBeNull();
    // A radiograph has no slices to find and no CT window to choose.
    expect(pickNext(pool, {}, { region: 'all', kinds: ['find', 'window'], expertOnly: false, recentBases: [], lastCase: null, rng: fixed })).toBeNull();
  });
});

describe('drill wording and question choice', () => {
  it('writes names inside a sentence without breaking abbreviations', () => {
    expect(inSentence('Stomach')).toBe('stomach');
    expect(inSentence('Left atrium')).toBe('left atrium');
    expect(inSentence('T2 vertebra')).toBe('T2 vertebra');
    expect(inSentence('S1 vertebra')).toBe('S1 vertebra');
  });
  it('never asks for one "best window" where the answer depends on contrast', () => {
    expect(kindsFor(cand('pulmonary_arteries_left_lower_lobe', 'a', { family: 'CT' }), ['window', 'locate'])).toEqual(['locate']);
    expect(kindsFor(cand('pulmonary_trunk', 'a', { family: 'CT' }), ['window'])).toEqual(['window']);
  });
});

describe('click grading', () => {
  const square: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const hole: Array<[number, number]> = [
    [4, 4],
    [6, 4],
    [6, 6],
    [4, 6],
  ];
  it('treats a hole inside an outline as outside', () => {
    expect(insideShapes([2, 2], [square])).toBe(true);
    expect(insideShapes([5, 5], [square, hole])).toBe(false);
    expect(insideShapes([12, 5], [square])).toBe(false);
  });
  it('measures the distance to the nearest edge', () => {
    expect(distanceToShapes([12, 5], [square])).toBeCloseTo(2);
    expect(distanceToShapes([5, 5], [square])).toBeCloseTo(5);
  });
});

describe('name-the-outline distractors and windows', () => {
  const t = (id: string, classId: string, label: string, sop = 'i1', c = [0, 0]): LoadedTarget => ({
    ref: { id, classId, label, provenance: 'source_manual' } as ReferenceTarget,
    geom: {
      geometryType: 'contour_set',
      space: 'image_px',
      planes: [
        {
          sopInstanceUid: sop,
          polygons: [
            [
              [c[0], c[1]],
              [c[0] + 4, c[1]],
              [c[0] + 4, c[1] + 4],
            ],
          ],
        },
      ],
    } as LoadedTarget['geom'],
  });
  it('offers the other-side twin first, then nearby structures on the same slice', () => {
    const left = t('a', 'anatomy:kidney_left', 'Kidney left', 'i1', [0, 0]);
    const all = [left, t('b', 'anatomy:liver', 'Liver', 'i1', [50, 0]), t('c', 'anatomy:kidney_right', 'Kidney right', 'i1', [80, 0]), t('d', 'anatomy:spleen', 'Spleen', 'i1', [5, 0])];
    expect(distractors(left, all, 'i1')).toEqual(['Kidney right', 'Spleen', 'Liver']);
  });
  it('picks the window from the structure', () => {
    expect(bestWindow({ key: 'lung_upper_lobe_left', category: 'airway' })).toBe('Lung');
    expect(bestWindow({ key: 'rib_left_5', category: 'bone' })).toBe('Bone');
    expect(bestWindow({ key: 'aorta_arch', category: 'vessel' })).toBe('Soft tissue');
    const presets = [
      { label: 'Soft tissue', center: 40, width: 400 },
      { label: 'Mediastinum', center: 50, width: 350 },
      { label: 'Lung', center: -600, width: 1500 },
    ];
    expect(presetFor(presets, 'Soft tissue', true)?.label).toBe('Mediastinum');
    expect(presetFor(presets, 'Soft tissue', false)?.label).toBe('Soft tissue');
    expect(presetFor(presets, 'Bone', false)).toBeUndefined();
  });
});

describe('matching two patients at the same level', () => {
  const mk = (pairs: Array<[string, number]>) => new Map<string, Landmark>(pairs.map(([key, mid]) => [key, { key, lo: mid - 10, hi: mid + 10, mid }]));
  it('interpolates between shared landmarks and drops ones that would run backwards', () => {
    const a = mk([
      ['t4_vertebra', 100],
      ['t8_vertebra', 0],
      ['liver', -60],
      ['l1_vertebra', -120],
    ]);
    const b = mk([
      ['t4_vertebra', 500],
      ['t8_vertebra', 380],
      ['liver', 600], // inconsistent label: dropped
      ['l1_vertebra', 300],
    ]);
    const pairs = matchLevels(a, b);
    expect(pairs).toHaveLength(3);
    expect(mapZ(50, pairs)).toBeCloseTo(440);
    expect(mapZ(-60, pairs)).toBeCloseTo(340);
    expect(mapZ(150, pairs)).toBeCloseTo(550); // above the top landmark: same offset
    expect(levelName(2, a)).toBe('T8');
    expect(levelName(400, a)).toBeNull();
  });
  it('reads landmark levels from slice positions', () => {
    const idx = { bySop: new Map([['s1', { plane: { ipp: [0, 0, -40] } }], ['s2', { plane: { ipp: [0, 0, -20] } }]]) } as never;
    const t = { ref: { classId: 'anatomy:vertebrae_T12' }, geom: { geometryType: 'contour_set', space: 'image_px', planes: [{ sopInstanceUid: 's1', polygons: [] }, { sopInstanceUid: 's2', polygons: [] }] } } as unknown as LoadedTarget;
    expect(landmarks([t], idx).get('t12_vertebra')).toEqual({ key: 't12_vertebra', lo: -40, hi: -20, mid: -30 });
  });
});

describe("today's plan", () => {
  it('spreads a new student across different patients instead of filling the day with one', () => {
    const c = new Catalog();
    for (const p of ['A', 'B', 'C', 'D'])
      for (let i = 0; i < 3; i++)
        c.tasks.set(`${p}${i}`, { id: `${p}${i}`, caseId: p, modes: ['practice'], skillDimensions: ['anatomy'], objectiveIds: [], type: 'find_structure', title: '' } as never);
    const plan = todayPlan([], c, 30);
    const newOnes = plan.filter((x) => x.why === 'New patient').map((x) => x.caseId);
    expect(new Set(newOnes).size).toBe(newOnes.length);
    expect(new Set(plan.map((x) => x.caseId)).size).toBe(4);
    expect(plan.find((x) => x.kind === 'weak')?.why).toMatch(/^Begin with /);
  });
});

describe('mistake notebook', () => {
  const attempt = (id: string, extra: Record<string, unknown>) =>
    ({ id, taskId: 't', caseId: 'c', holdoutGroup: 'g', submittedAt: `2026-10-2${id}T10:00:00Z`, uncertain: false, revealed: false, confidence: 3, independent: true, objectiveIds: [], skillDimensions: ['anatomy'], ...extra }) as never;
  it('lists a self-review answer only when you judged it wrong, never just for being self-reviewed', () => {
    const grade = { outcome: 'self_review', errors: [] };
    const list = mistakeNotebook([attempt('1', { grade, selfReview: { checked: [], verdict: 'correct' } }), attempt('2', { grade, selfReview: { checked: [], verdict: 'incorrect' } })], null);
    expect(list.map((m) => m.attempt)).toHaveLength(1);
    expect(list[0].reason).toBe('You judged it not right');
  });
});

describe('outlines with holes', () => {
  const sq = (a: number, b: number): Array<[number, number]> => [
    [a, a],
    [b, a],
    [b, b],
    [a, b],
  ];
  const skull = { targetId: 's', label: 'Skull', kind: 'poly', pts: sq(0, 100), holes: [sq(10, 90)], provenance: 'ai_draft', category: 'bone', layer: 'atlas' } as Shape;
  it('a point in the hole (the cranial cavity) is not on the structure', () => {
    expect(shapeContains(skull, [50, 50])).toBe(false);
    expect(shapeContains(skull, [5, 50])).toBe(true);
    expect(shapeArea(skull)).toBeCloseTo(100 * 100 - 80 * 80);
    // The drill grades with every ring, even-odd: inside the hole is a miss, its edge 40 px away.
    expect(insideShapes([50, 50], shapeRings([skull]))).toBe(false);
    expect(distanceToShapes([50, 50], shapeRings([skull]))).toBeCloseTo(40);
  });
});

describe('aorta and colon parts replace the whole outline', () => {
  it('hides the whole aorta and colon on a series that has their named parts', () => {
    const c = new Catalog();
    const add = (id: string, classId: string, seriesUid: string) =>
      c.targets.set(id, { id, classId, seriesUid, label: id, geometryType: 'contour_set', provenance: 'ai_draft', layer: 'atlas' } as ReferenceTarget);
    add('w1', 'anatomy:aorta', 'A');
    add('p1', 'anatomy:aorta_arch', 'A');
    add('c1', 'anatomy:colon', 'A');
    add('c2', 'anatomy:colon_sigmoid', 'A');
    add('w2', 'anatomy:aorta', 'B');
    add('li', 'anatomy:large_intestine', 'B');
    expect(c.anatomyTargetsForSeries(['A']).sort()).toEqual(['c2', 'p1']);
    expect(c.anatomyTargetsForSeries(['B']).sort()).toEqual(['li', 'w2']);
    // Chambers replace an AI heart, but an expert outline is never hidden by machine-drawn parts.
    add('h1', 'anatomy:heart', 'C');
    add('ra', 'anatomy:heart_atrium_right', 'C');
    c.targets.set('ex', { id: 'ex', classId: 'anatomy:large_intestine', seriesUid: 'C', label: 'ex', geometryType: 'contour_set', provenance: 'source_manual', layer: 'atlas' } as ReferenceTarget);
    add('cs', 'anatomy:colon_sigmoid', 'C');
    expect(c.anatomyTargetsForSeries(['C']).sort()).toEqual(['cs', 'ex', 'ra']);
  });
});

// ------------------------------------------------------------------ real installed labels
const PACKS = join(__dirname, '..', 'public', 'packs');
const classIds = new Set<string>();
for (const d of readdirSync(PACKS, { withFileTypes: true })) {
  const f = join(PACKS, d.name, 'pack.json');
  if (!d.isDirectory() || !existsSync(f)) continue;
  for (const t of JSON.parse(readFileSync(f, 'utf-8')).referenceTargets as Array<{ classId: string }>) if (t.classId.startsWith('anatomy:')) classIds.add(t.classId);
}

describe('installed atlas outlines respect the anatomy', () => {
  type Ring = Array<[number, number]>;
  type Plane = { sopInstanceUid: string; polygons: Ring[]; holes?: Ring[] };
  type AtlasTarget = { classId: string; seriesUid: string; geometryFile: string };
  const dir = join(PACKS, 'anatomy-atlas');
  const atlas = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf-8')).referenceTargets as AtlasTarget[];
  const planes = (t: AtlasTarget) => (JSON.parse(readFileSync(join(dir, t.geometryFile), 'utf-8')) as { planes: Plane[] }).planes;
  const inside = (p: [number, number], rings: Ring[]) =>
    rings.reduce((n, r) => {
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++)
        if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
      return n + (c ? 1 : 0);
    }, 0) % 2 === 1;

  it('the trachea is one tube on every slice: it ends at the carina, below which the airway is a main bronchus', () => {
    const split = atlas.filter((t) => t.classId === 'anatomy:trachea').flatMap((t) => planes(t).filter((pl) => pl.polygons.length > 1).map((pl) => `${t.geometryFile} @ ${pl.sopInstanceUid}`));
    expect(split).toEqual([]);
    // The vessel-draft pack's trachea follows the same rule.
    const vdDir = join(PACKS, 'vessel-drafts');
    const vd = (JSON.parse(readFileSync(join(vdDir, 'pack.json'), 'utf-8')).referenceTargets as AtlasTarget[]).filter((t) => t.classId === 'anatomy:trachea');
    expect(vd.length).toBeGreaterThan(0);
    for (const t of vd) {
      const g = JSON.parse(readFileSync(join(vdDir, t.geometryFile), 'utf-8')) as { planes: Plane[] };
      expect(g.planes.filter((pl) => pl.polygons.length > 1).length, t.geometryFile).toBe(0);
    }
  });

  it('no pulmonary trunk or artery outline lies inside a machine-drawn heart outline', () => {
    const hearts = new Map<string, Map<string, Ring[]>>();
    for (const t of atlas.filter((x) => x.classId === 'anatomy:heart'))
      hearts.set(t.seriesUid, new Map(planes(t).map((pl) => [pl.sopInstanceUid, [...pl.polygons, ...(pl.holes ?? [])]])));
    let checked = 0;
    const bad: string[] = [];
    for (const t of atlas.filter((x) => /^anatomy:pulmonary_(trunk|arter)/.test(x.classId))) {
      const heart = hearts.get(t.seriesUid);
      for (const pl of planes(t))
        for (const r of pl.polygons) {
          const c: [number, number] = [r.reduce((s, q) => s + q[0], 0) / r.length, r.reduce((s, q) => s + q[1], 0) / r.length];
          checked++;
          const rings = heart?.get(pl.sopInstanceUid);
          if (rings && inside(c, rings)) bad.push(`${t.classId} @ ${pl.sopInstanceUid}`);
        }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(bad).toEqual([]);
  });
});

describe('teaching notes and search patterns cover the real labels', () => {
  it('every labelled structure has a note (look, neighbours, chapter, window)', () => {
    const missing = [...classIds].filter((c) => !noteFor(c));
    expect(missing, `no note for: ${missing.join(', ')}`).toEqual([]);
    expect(noteFor('anatomy:heart', 'XR')?.look).toMatch(/border/);
    // Side-specific notes: each chamber gets its own anatomy, not a shared "heart chamber" note.
    expect(noteFor('anatomy:heart_atrium_left')?.look).toMatch(/most posterior/);
    expect(noteFor('anatomy:heart_ventricle_right')?.look).toMatch(/most anterior/);
    expect(noteFor('anatomy:heart_atrium_right')?.near).toMatch(/SVC/);
    expect(noteFor('anatomy:pulmonary_trunk')?.look).toMatch(/main pulmonary artery/);
    expect(noteFor('anatomy:pulmonary_artery_left')?.look).toMatch(/left main bronchus/);
    expect(noteFor('anatomy:pulmonary_arteries_right_lower_lobe')?.look).toMatch(/Lobar and segmental/);
    expect(noteFor('anatomy:main_bronchus_right')?.look).toMatch(/bronchus intermedius/);
    expect(noteFor('anatomy:main_bronchus_left')?.near).toMatch(/left pulmonary artery arches over it/);
  });
  it('every search-pattern step with labels to show matches at least one installed structure', () => {
    const keys = [...classIds].map(canonicalAnatomyKey);
    const unmatched = SEARCH_PATTERNS.filter((p) => p.id !== 'brain_mr').flatMap((p) => p.steps.filter((s) => s.show && !keys.some((k) => s.show!.test(k))).map((s) => `${p.id}:${s.id}`));
    expect(unmatched).toEqual([]);
    expect(patternsFor('CT', new Set(['lung_left', 'trachea', 'heart']))[0].id).toBe('chest_ct');
    expect(patternsFor('CT', new Set(['liver', 'kidney_left', 'colon_sigmoid']))[0].id).toBe('abdomen_ct');
    expect(patternsFor('DX', new Set()).length).toBe(0);
  });
});

describe('finding drills', () => {
  const finding = (classId: string, family: 'XR' | 'CT' | 'MR'): DrillCandidate => ({
    caseId: 'c',
    targetId: 't',
    seriesUid: 's',
    key: classId,
    base: classId,
    name: findingName(classId),
    family,
    provenance: 'source_manual',
    category: 'finding',
  });

  it('asks findings as "point to it", and "find its level" only on CT/MR', () => {
    const all: DrillKind[] = ['locate', 'find', 'name', 'window'];
    expect(kindsFor(finding('finding:pneumothorax', 'XR'), all)).toEqual(['locate']);
    expect(kindsFor(finding('finding:pulmonary_embolism', 'CT'), all)).toEqual(['locate', 'find']);
    expect(REGIONS.find((r) => r.id === 'findings')!.test(finding('finding:fracture', 'XR'))).toBe(true);
  });

  it('names findings plainly, in American spelling, and links each to a condition with signs', () => {
    for (const id of ['pneumothorax', 'pleural_effusion', 'atelectasis', 'cardiomegaly', 'lung_mass', 'lung_nodule', 'pneumonia', 'pulmonary_embolism', 'liver_metastasis', 'renal_tumor', 'glioma', 'fracture']) {
      const classId = `finding:${id}`;
      expect(findingName(classId)).not.toMatch(/tumour|oedema|haem|_/);
      const c = conditionForFinding(classId);
      expect(c, classId).not.toBeNull();
      expect(c!.signs.length).toBeGreaterThan(0);
    }
    expect(findingName('finding:some_new_thing')).toBe('Some new thing');
  });
});

describe('finding drills: the most specific explanation', () => {
  it('explains a growth-plate fracture with Salter-Harris, not the general fracture entry', () => {
    const c = conditionForFinding('finding:physeal_fracture');
    expect(c?.name).toMatch(/Salter-Harris/);
    expect(findingName('finding:physeal_fracture')).toMatch(/Salter-Harris/);
    expect(conditionForFinding('finding:fracture')?.id).toBe('fracture');
  });
});
