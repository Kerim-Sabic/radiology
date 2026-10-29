/**
 * Round-4 packs (more patients from sources already in use): every graded answer is re-derived here from the expert
 * annotation or clinical data stored with the reference target in pack.json, independently of scripts/lessons/round4.py.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LessonFile, PackManifest, type ReferenceTarget, type Task } from '../src/schema/content';

const PACKS = join(__dirname, '..', 'public', 'packs');
const R4 = ['us-breast-2', 'stroke-mri-2', 'cxr-findings-2', 'peds-wrist-2', 'mammo-cbis-2'] as const;
const installed = R4.filter((p) => existsSync(join(PACKS, p, 'lessons.json')));
const load = (p: string) => ({
  pack: PackManifest.parse(JSON.parse(readFileSync(join(PACKS, p, 'pack.json'), 'utf-8'))),
  lessons: LessonFile.parse(JSON.parse(readFileSync(join(PACKS, p, 'lessons.json'), 'utf-8'))),
});
const correct = (t: Task | undefined) => (t && t.grading.kind === 'choice' ? t.grading.options.filter((o) => o.correct).map((o) => o.id).sort() : []);
const note = (t: ReferenceTarget) => t.provenanceDetail?.note ?? '';

describe.skipIf(!installed.length)('round-4 packs', () => {
  const all = installed.map((p) => ({ id: p, ...load(p) }));

  it('gives every new patient at least one graded task, with codes from EA upwards', () => {
    for (const { lessons } of all)
      for (const c of lessons.cases) {
        expect(lessons.tasks.some((t) => t.caseId === c.id && t.scoring === 'authoritative'), c.id).toBe(true);
        expect(c.neutralTitle, c.id).toMatch(/^Patient [E-Z][A-Z] · [^·]+$/);
      }
  });

  it('keeps dataset names and diagnoses out of everything the reading room shows', () => {
    const dataset = /NIH|ChestX|ISLES|GRAZ|CBIS|DDSM|Breast-Lesions|BrEaST/; // case as written ("Breast ultrasound" is fine)
    const diagnosis = /stroke|infarct|fractur|carcinoma|tumou?r|pneumo|effusion|nodule|\bmass|cyst|malignan|benign/i;
    for (const { pack } of all) {
      const texts = [...pack.studies.map((st) => st.description), ...pack.series.flatMap((s) => [s.description, s.roleNote, s.displayNote ?? ''])];
      for (const text of texts) {
        expect(text).not.toMatch(dataset);
        expect(text).not.toMatch(diagnosis);
      }
    }
  });

  it('breast ultrasound: shape, margin, echoes and outcome are the radiologist descriptors and the proven result', () => {
    const b = all.find((x) => x.id === 'us-breast-2');
    if (!b) return;
    for (const c of b.lessons.cases) {
      const t = b.pack.referenceTargets.find((x) => x.seriesUid === c.primarySeriesUid)!;
      const n = note(t);
      const field = (k: string) => n.match(new RegExp(`${k} ([^;]+);`))![1];
      const task = (s: string) => b.lessons.tasks.find((x) => x.id === `${c.id}:${s}`);
      expect(correct(task('outcome')), c.id).toEqual([n.includes('classification malignant') ? 'malignant' : 'benign']);
      expect(n, c.id).toMatch(/confirmed by (biopsy|follow-up care)/);
      if (n.includes('confirmed by follow-up care')) expect(n, c.id).toContain('classification benign');
      expect(correct(task('shape')), c.id).toEqual([field('shape'), field('margin') === 'circumscribed' ? 'circ' : 'notcirc'].sort());
      const echo = task('echo')!;
      const picked = echo.grading.kind === 'choice' ? echo.grading.options.filter((o) => o.correct).map((o) => o.text.toLowerCase()) : [];
      expect(picked.length, c.id).toBe(2);
      expect(picked.some((x) => x.startsWith(field('echogenicity').split('/')[0])), c.id).toBe(true);
    }
  });

  it('stroke MRI: ADC and side questions only where the mask supports them', () => {
    const s = all.find((x) => x.id === 'stroke-mri-2');
    if (!s) return;
    for (const c of s.lessons.cases) {
      const t = s.pack.referenceTargets.find((x) => x.seriesUid === c.primarySeriesUid)!;
      const n = note(t);
      const adc = s.lessons.tasks.find((x) => x.id === `${c.id}:adc`);
      expect(Boolean(adc), c.id).toBe(n.includes('low ADC yes'));
      const side = n.match(/side (left|right|not one-sided)/)![1];
      const sideTask = s.lessons.tasks.find((x) => x.id === `${c.id}:side`);
      if (side === 'not one-sided') expect(sideTask, c.id).toBeUndefined();
      else {
        expect(correct(sideTask), c.id).toEqual([side]);
        const [, l, total] = n.match(/midline: (\d+) of (\d+)/)!.map(Number);
        expect(Math.max(l, total - l) / total, c.id).toBeGreaterThanOrEqual(0.99);
      }
    }
  });

  it("children's wrists: the fracture type is the dataset's AO/OTA code", () => {
    const w = all.find((x) => x.id === 'peds-wrist-2');
    if (!w) return;
    const byCode: Record<string, string> = { '23r-E/2.1': 'sh2', '23r-M/2.1': 'incomplete', '23r-M/3.1': 'complete' };
    for (const c of w.lessons.cases) {
      const t = w.pack.referenceTargets.find((x) => x.seriesUid === c.primarySeriesUid)!;
      const code = note(t).match(/code (\S+) \(dataset\.csv\)/)![1];
      expect(correct(w.lessons.tasks.find((x) => x.id === `${c.id}:type`)), c.id).toEqual([byCode[code]]);
    }
  });

  it('mammography: margin or calcification form, and pathology, as in the case description', () => {
    const m = all.find((x) => x.id === 'mammo-cbis-2');
    if (!m) return;
    for (const c of m.lessons.cases) {
      const t = m.pack.referenceTargets.find((x) => x.seriesUid === c.primarySeriesUid)!;
      expect(correct(m.lessons.tasks.find((x) => x.id === `${c.id}:pathology`)), c.id).toEqual([/pathology MALIGNANT/.test(note(t)) ? 'malignant' : 'benign']);
      if (t.classId === 'finding:breast_mass') expect(correct(m.lessons.tasks.find((x) => x.id === `${c.id}:margin`)), c.id).toEqual([t.label.match(/, (\w+) margin/)![1]]);
      else expect(correct(m.lessons.tasks.find((x) => x.id === `${c.id}:form`)), c.id).toEqual([t.label.split(': ')[1].split(',')[0].replace(/ /g, '_')]);
    }
  });

  it('chest radiographs: the required box is the finding the case teaches', () => {
    const x = all.find((p) => p.id === 'cxr-findings-2');
    if (!x) return;
    const name: Record<string, string> = {
      'finding:pneumothorax': 'Pneumothorax', 'finding:pleural_effusion': 'Pleural effusion', 'finding:atelectasis': 'Atelectasis',
      'finding:cardiomegaly': 'Cardiomegaly', 'finding:lung_mass': 'Lung mass', 'finding:lung_nodule': 'Lung nodule', 'finding:pneumonia': 'Pneumonia',
    };
    for (const c of x.lessons.cases) {
      const locate = x.lessons.tasks.find((t) => t.id === `${c.id}:locate`)!;
      const req = locate.targets.filter((t) => t.required);
      expect(req.length, c.id).toBe(1);
      const t = x.pack.referenceTargets.find((r) => r.id === req[0].targetId)!;
      expect(c.learnTitle.startsWith(name[t.classId]), c.id).toBe(true);
    }
  });
});
