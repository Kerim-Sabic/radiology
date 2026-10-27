/**
 * Deterministic, coordinate-aware grading. The LLM is never the spatial answer key.
 * All comparisons are made in source geometry (patient LPS mm or contract image px on a
 * specific SOP instance), never in canvas pixels.
 */
import type { ReferenceTarget, TargetGeometry, Task } from '../schema/content';
import {
  boxIoU,
  distanceToBoundary,
  distanceToPolygon,
  dot,
  imageToPatient,
  normalize,
  patientToImage,
  patientToPlaneMm,
  pointInPolygon,
  polygonBounds,
  polygonCentroid,
  sub,
  type Box,
  type Vec2,
  type Vec3,
} from '../lib/geometry';
import type { SeriesIndex } from './seriesIndex';
import type { ErrorCategory, GradeResult, LearnerMark, MarkOutcome, PositionAtSubmit, TargetOutcome } from './types';

export interface LoadedTarget {
  ref: ReferenceTarget;
  geom: TargetGeometry;
}

export interface GradeInput {
  task: Task;
  /** Every reference target available for the case (used to say what a misplaced mark actually hit). */
  targets: Map<string, LoadedTarget>;
  series: Map<string, SeriesIndex>;
  marks: LearnerMark[];
  position?: PositionAtSubmit;
  choice?: string[];
  declaredNoFinding?: boolean;
}

const AUTHORITATIVE_PROVENANCE = new Set(['source_manual', 'human_reviewed']);

export function isAuthoritativeTarget(t: ReferenceTarget): boolean {
  if (!AUTHORITATIVE_PROVENANCE.has(t.provenance)) return false;
  if (t.provenance === 'human_reviewed' && t.review.status !== 'reviewed_by_user') return false;
  return true;
}

// ------------------------------------------------------------------ probes

interface Probe {
  seriesUid: string;
  sop: string | null;
  px: Vec2 | null; // contract px on `sop`
  world: Vec3 | null;
}

/** Representative point of a mark: point/arrow tip, box centre, outline centroid. */
export function probeOfMark(mark: LearnerMark, series: SeriesIndex | undefined): Probe {
  let px: Vec2 | null = null;
  if (mark.imagePx && mark.imagePx.length) {
    if (mark.tool === 'box' && mark.imagePx.length >= 2) {
      const [a, b] = mark.imagePx;
      px = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    } else if (mark.tool === 'outline' && mark.imagePx.length >= 3) px = polygonCentroid(mark.imagePx);
    else px = mark.imagePx[0];
  }
  let world: Vec3 | null = null;
  if (mark.worldLps && mark.worldLps.length) {
    if (mark.tool === 'box' && mark.worldLps.length >= 2) {
      const [a, b] = mark.worldLps;
      world = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    } else if (mark.tool === 'outline' && mark.worldLps.length >= 3) {
      const n = mark.worldLps.length;
      world = mark.worldLps.reduce<Vec3>((acc, p) => [acc[0] + p[0] / n, acc[1] + p[1] / n, acc[2] + p[2] / n], [0, 0, 0]);
    } else world = mark.worldLps[0];
  }
  let sop = mark.sopInstanceUid;
  // Derive whichever representation is missing from series geometry.
  if (series && sop && px && !world) {
    const inst = series.bySop.get(sop);
    if (inst?.plane) world = imageToPatient(inst.plane, px);
  }
  if (series && world && (!sop || !px)) {
    const inst = series.nearestInstance(world);
    if (inst?.plane) {
      sop = inst.sopInstanceUid;
      px = patientToImage(inst.plane, world).px;
    }
  }
  return { seriesUid: mark.seriesUid, sop, px, world };
}

// ------------------------------------------------------------------ measurement

export interface Measure {
  comparable: boolean;
  sliceDistanceMm: number; // distance from the nearest referenced plane / interval (0 = on it)
  inPlaneDistanceMm: number; // 0 = inside, else distance to the boundary on the nearest eligible plane
  planeSop: string | null;
}

const NOT_COMPARABLE: Measure = { comparable: false, sliceDistanceMm: Infinity, inPlaneDistanceMm: Infinity, planeSop: null };

function boxToPolygon(b: Box): Vec2[] {
  return [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[2], b[3]],
    [b[0], b[3]],
  ];
}

interface PlaneShapes {
  sop: string;
  polygonsPx?: Vec2[][]; // image_px
  holesPx?: Vec2[][];
  polygonsLps?: Vec3[][];
  holesLps?: Vec3[][];
}

function planesOf(geom: TargetGeometry): PlaneShapes[] {
  if (geom.geometryType === 'contour_set') {
    return geom.planes.map((p) =>
      geom.space === 'image_px'
        ? { sop: p.sopInstanceUid, polygonsPx: p.polygons as Vec2[][], holesPx: (p.holes ?? []) as Vec2[][] }
        : { sop: p.sopInstanceUid, polygonsLps: p.polygons as Vec3[][], holesLps: (p.holes ?? []) as Vec3[][] },
    );
  }
  if (geom.geometryType === 'box') return geom.boxes.map((b) => ({ sop: b.sopInstanceUid, polygonsPx: [boxToPolygon(b.box)] }));
  return [];
}

/** Measure a probe against one reference target on the probe's series. */
export function measureProbe(probe: Probe, target: LoadedTarget, series: SeriesIndex | undefined): Measure {
  if (!series || probe.seriesUid !== target.ref.seriesUid) return NOT_COMPARABLE;
  const g = target.geom;
  if (g.geometryType === 'slice_interval') {
    if (!probe.world) return NOT_COMPARABLE;
    const pos = dot(probe.world, normalize(g.normal));
    const d = pos < g.range[0] ? g.range[0] - pos : pos > g.range[1] ? pos - g.range[1] : 0;
    return { comparable: true, sliceDistanceMm: d, inPlaneDistanceMm: 0, planeSop: null };
  }
  if (g.geometryType === 'point') {
    if (g.space === 'patient_lps_mm' && probe.world && series.normal) {
      const tp = g.point as Vec3;
      const delta = sub(probe.world, tp);
      const along = Math.abs(dot(delta, series.normal));
      const total = Math.hypot(delta[0], delta[1], delta[2]);
      return { comparable: true, sliceDistanceMm: along, inPlaneDistanceMm: Math.sqrt(Math.max(0, total * total - along * along)), planeSop: g.sopInstanceUid };
    }
    if (g.space === 'image_px' && probe.sop === g.sopInstanceUid && probe.px) {
      const [mc, mr] = series.mmPerPx();
      const tp = g.point as Vec2;
      return {
        comparable: true,
        sliceDistanceMm: 0,
        inPlaneDistanceMm: Math.hypot((probe.px[0] - tp[0]) * mc, (probe.px[1] - tp[1]) * mr),
        planeSop: g.sopInstanceUid,
      };
    }
    return NOT_COMPARABLE;
  }
  if (g.geometryType === 'image_label') return NOT_COMPARABLE;

  let best: Measure = NOT_COMPARABLE;
  const [mmc, mmr] = series.mmPerPx();
  for (const plane of planesOf(g)) {
    const inst = series.bySop.get(plane.sop);
    if (!inst) continue;
    let sliceD: number;
    let probe2: Vec2;
    if (probe.world && inst.plane && series.normal) {
      sliceD = Math.abs(dot(sub(probe.world, inst.plane.ipp), series.normal));
      probe2 = patientToPlaneMm(inst.plane, probe.world);
    } else if (probe.sop === plane.sop && probe.px) {
      sliceD = 0;
      probe2 = [probe.px[0] * mmc, probe.px[1] * mmr];
    } else continue;
    const toMm = (poly: Vec2[] | Vec3[], isPx: boolean): Vec2[] =>
      isPx ? (poly as Vec2[]).map(([c, r]) => [c * mmc, r * mmr] as Vec2) : (poly as Vec3[]).map((p) => patientToPlaneMm(inst.plane!, p));
    const isPx = !!plane.polygonsPx;
    if (!isPx && !inst.plane) continue;
    const polys = (plane.polygonsPx ?? plane.polygonsLps ?? []).map((p) => toMm(p, isPx));
    const holes = (plane.holesPx ?? plane.holesLps ?? []).map((p) => toMm(p, isPx));
    let inPlane = Infinity;
    for (const poly of polys) inPlane = Math.min(inPlane, distanceToPolygon(probe2, poly));
    if (inPlane === 0) {
      // Inside a hole (e.g. a ring-shaped contour) counts as outside, at the hole-boundary distance.
      for (const hole of holes) if (pointInPolygon(probe2, hole)) inPlane = Math.max(inPlane, distanceToBoundary(probe2, hole));
    }
    // Prefer the nearest plane; break ties by in-plane distance.
    if (sliceD < best.sliceDistanceMm - 1e-6 || (Math.abs(sliceD - best.sliceDistanceMm) <= 1e-6 && inPlane < best.inPlaneDistanceMm)) {
      best = { comparable: true, sliceDistanceMm: sliceD, inPlaneDistanceMm: inPlane, planeSop: plane.sop };
    }
  }
  return best;
}

/** Best in-plane distance among planes within the slab tolerance (Infinity if none in slab). */
export function measureWithinSlab(probe: Probe, target: LoadedTarget, series: SeriesIndex | undefined, slabMm: number): Measure {
  const g = target.geom;
  if (g.geometryType !== 'contour_set' && g.geometryType !== 'box') return measureProbe(probe, target, series);
  if (!series || probe.seriesUid !== target.ref.seriesUid) return NOT_COMPARABLE;
  let nearest: Measure = NOT_COMPARABLE;
  let bestInSlab: Measure | null = null;
  for (const plane of planesOf(g)) {
    const single: LoadedTarget = {
      ref: target.ref,
      geom:
        g.geometryType === 'box'
          ? { geometryType: 'box', space: 'image_px', boxes: g.boxes.filter((b) => b.sopInstanceUid === plane.sop) }
          : { ...g, planes: g.planes.filter((p) => p.sopInstanceUid === plane.sop) },
    };
    const m = measureProbe(probe, single, series);
    if (!m.comparable) continue;
    if (m.sliceDistanceMm < nearest.sliceDistanceMm) nearest = m;
    if (m.sliceDistanceMm <= slabMm && (!bestInSlab || m.inPlaneDistanceMm < bestInSlab.inPlaneDistanceMm)) bestInSlab = m;
  }
  return bestInSlab ?? nearest;
}

// ------------------------------------------------------------------ helpers

export function normalizeLabel(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function labelMatches(label: string | null, name: string, accepted: string[] = []): boolean {
  const l = normalizeLabel(label);
  if (!l) return false;
  return [name, ...accepted].some((n) => normalizeLabel(n) === l);
}

const SIDE = /\b(left|right)\b/;
export function counterpartClassId(classId: string): string | null {
  if (/_left\b|\bleft\b|_l$/.test(classId)) return classId.replace(/_left\b/, '_right').replace(/\bleft\b/, 'right').replace(/_l$/, '_r');
  if (/_right\b|\bright\b|_r$/.test(classId)) return classId.replace(/_right\b/, '_left').replace(/\bright\b/, 'left').replace(/_r$/, '_l');
  return null;
}

function directionWords(normal: Vec3, signedDelta: number): string {
  // signedDelta > 0: learner is further along +normal than the target.
  const axis = [0, 1, 2].reduce((a, b) => (Math.abs(normal[b]) > Math.abs(normal[a]) ? b : a), 0);
  const positive = (normal[axis] > 0) === signedDelta > 0;
  const words = [
    ['to the patient’s left', 'to the patient’s right'],
    ['posterior', 'anterior'],
    ['superior (cranial)', 'inferior (caudal)'],
  ][axis];
  return positive ? words[0] : words[1];
}

const fmt = (mm: number) => (mm < 10 ? mm.toFixed(1) : mm.toFixed(0));

// ------------------------------------------------------------------ main

export function gradeTask(input: GradeInput): GradeResult {
  const { task } = input;
  const taskTargets = task.targets.map((t) => ({ ref: t, loaded: input.targets.get(t.targetId) }));
  const missing = taskTargets.filter((t) => !t.loaded).map((t) => t.ref.targetId);
  const allAuthoritative = taskTargets.every((t) => t.loaded && isAuthoritativeTarget(t.loaded.ref));
  const authoritative = task.scoring === 'authoritative' && allAuthoritative && missing.length === 0;
  const authorityNote = authoritative
    ? 'Scored against source-provided reference annotations.'
    : missing.length
      ? `Reference geometry missing for ${missing.join(', ')} — not scored.`
      : task.scoring !== 'authoritative'
        ? 'Exploratory task: compare your answer with the reference yourself.'
        : 'Draft / unreviewed reference: shown for comparison only, not an authoritative score.';

  const base: GradeResult = {
    gradingKind: task.grading.kind,
    authoritative,
    authorityNote,
    outcome: 'not_attempted',
    score: null,
    components: {},
    targets: [],
    marks: [],
    errors: [],
    messages: [],
  };

  const g = task.grading;
  let result: GradeResult;
  switch (g.kind) {
    case 'choice':
      result = gradeChoice(base, g, input.choice ?? []);
      result.authoritative = task.scoring === 'authoritative';
      break;
    case 'self_review':
      result = { ...base, outcome: 'self_review', authoritative: false, authorityNote: 'Self-review against the rubric (not automatically verified).' };
      break;
    case 'slice_interval':
      result = gradeSliceInterval(base, input, g.toleranceMm);
      break;
    case 'point_in_target':
      result = gradeLabelled(base, input, { slab: g.slabToleranceMm, inPlane: g.inPlaneToleranceMm, requireLabels: false, levelTargetId: null, shotgunPenalty: true });
      break;
    case 'labelled_points':
      result = gradeLabelled(base, input, { slab: g.slabToleranceMm, inPlane: g.inPlaneToleranceMm, requireLabels: g.requireLabels, levelTargetId: g.levelTargetId, shotgunPenalty: true });
      break;
    case 'findings':
      result = gradeFindings(base, input, g);
      break;
  }
  if (!result.authoritative && result.outcome !== 'not_attempted' && g.kind !== 'choice') {
    result.score = null;
    result.outcome = 'self_review';
  }
  result.errors = [...new Set(result.errors)];
  return result;
}

function gradeChoice(base: GradeResult, g: Extract<Task['grading'], { kind: 'choice' }>, chosen: string[]): GradeResult {
  if (!chosen.length) return base;
  const correct = new Set(g.options.filter((o) => o.correct).map((o) => o.id));
  const picked = new Set(chosen);
  const right = [...picked].filter((id) => correct.has(id)).length;
  const wrong = [...picked].filter((id) => !correct.has(id)).length;
  const ok = right === correct.size && wrong === 0;
  return {
    ...base,
    outcome: ok ? 'correct' : right > 0 ? 'partial' : 'incorrect',
    score: correct.size ? Math.max(0, (right - wrong) / correct.size) : 0,
    components: { choice: { ok, detail: g.options.filter((o) => picked.has(o.id)).map((o) => `${o.text}: ${o.why}`).join(' ') } },
    errors: ok ? [] : ['interpretation_error'],
  };
}

function gradeSliceInterval(base: GradeResult, input: GradeInput, tolMm: number): GradeResult {
  const pos = input.position;
  const t = input.task.targets[0];
  const loaded = t && input.targets.get(t.targetId);
  if (!pos || !loaded || loaded.geom.geometryType !== 'slice_interval') return base;
  const series = input.series.get(pos.seriesUid);
  let world = pos.worldLps;
  if (!world && pos.sopInstanceUid && series) {
    const inst = series.bySop.get(pos.sopInstanceUid);
    world = inst?.plane?.ipp ?? null;
  }
  if (!world) return base;
  const m = measureProbe({ seriesUid: pos.seriesUid, sop: pos.sopInstanceUid, px: null, world }, loaded, series);
  if (!m.comparable) return { ...base, messages: ['Your current view is not on the reference series — switch to the task series and try again.'] };
  const ok = m.sliceDistanceMm <= tolMm;
  const normal = normalize(loaded.geom.normal);
  const posAlong = dot(world, normal);
  const signed = posAlong < loaded.geom.range[0] ? posAlong - loaded.geom.range[0] : posAlong - loaded.geom.range[1];
  const detail = ok
    ? m.sliceDistanceMm === 0
      ? 'Your slice lies within the accepted interval.'
      : `Within tolerance (${fmt(m.sliceDistanceMm)} mm outside the interval core).`
    : `You are ${fmt(m.sliceDistanceMm)} mm ${directionWords(normal, signed)} of the accepted interval.`;
  return {
    ...base,
    outcome: ok ? 'correct' : 'incorrect',
    score: ok ? 1 : 0,
    components: { level: { ok, detail } },
    targets: [{ targetId: t.targetId, name: t.name, status: ok ? 'found' : 'off_level', markId: null, inPlaneDistanceMm: null, sliceDistanceMm: m.sliceDistanceMm, overlap: null, note: detail }],
    errors: ok ? [] : ['navigation_failure'],
    messages: [detail],
  };
}

interface LabelledOptions {
  slab: number;
  inPlane: number;
  requireLabels: boolean;
  levelTargetId: string | null;
  shotgunPenalty: boolean;
}

function gradeLabelled(base: GradeResult, input: GradeInput, o: LabelledOptions): GradeResult {
  const { task, marks } = input;
  if (!marks.length) return { ...base, messages: ['No marks placed.'] };
  const probes = new Map(marks.map((m) => [m.id, probeOfMark(m, input.series.get(m.seriesUid))]));
  const hits = (markId: string, targetId: string) => {
    const lt = input.targets.get(targetId);
    if (!lt) return null;
    const p = probes.get(markId)!;
    const m = measureWithinSlab(p, lt, input.series.get(p.seriesUid), o.slab);
    return { m, hit: m.comparable && m.sliceDistanceMm <= o.slab && m.inPlaneDistanceMm <= o.inPlane };
  };
  const levelTarget = o.levelTargetId ? input.targets.get(o.levelTargetId) : null;
  const onLevel = (markId: string): { ok: boolean; d: number } => {
    if (!levelTarget) return { ok: true, d: 0 };
    const p = probes.get(markId)!;
    const m = measureProbe(p, levelTarget, input.series.get(p.seriesUid));
    return { ok: m.comparable && m.sliceDistanceMm <= 0.5, d: m.sliceDistanceMm };
  };

  const targetOutcomes: TargetOutcome[] = [];
  const markOutcomes = new Map<string, MarkOutcome>();
  const used = new Set<string>();
  const required = task.targets.filter((t) => t.required !== false);

  // 1) one-to-one assignment: each target takes the closest qualifying, unused mark.
  for (const t of task.targets) {
    let best: { markId: string; d: number; slice: number } | null = null;
    for (const mk of marks) {
      if (used.has(mk.id)) continue;
      if (o.requireLabels && !labelMatches(mk.label, t.name, t.acceptedNames)) continue;
      const h = hits(mk.id, t.targetId);
      if (!h?.hit || !onLevel(mk.id).ok) continue;
      if (!best || h.m.inPlaneDistanceMm < best.d) best = { markId: mk.id, d: h.m.inPlaneDistanceMm, slice: h.m.sliceDistanceMm };
    }
    if (best) {
      used.add(best.markId);
      markOutcomes.set(best.markId, { markId: best.markId, status: 'matched', targetId: t.targetId, note: `Inside the reference for ${t.name}.` });
      targetOutcomes.push({ targetId: t.targetId, name: t.name, status: 'found', markId: best.markId, inPlaneDistanceMm: best.d, sliceDistanceMm: best.slice, overlap: null, note: best.d === 0 ? 'Mark lies inside the reference.' : `Within tolerance (${fmt(best.d)} mm from the edge).` });
    }
  }

  // 2) explain every unmatched mark using only validated references.
  // Only spatial structures can explain where a mark landed (not level intervals or image labels).
  const caseTargets = [...input.targets.values()].filter((c) => c.geom.geometryType === 'contour_set' || c.geom.geometryType === 'box' || c.geom.geometryType === 'point');
  for (const mk of marks) {
    if (markOutcomes.has(mk.id)) continue;
    const lvl = onLevel(mk.id);
    const labelledAs = task.targets.find((t) => labelMatches(mk.label, t.name, t.acceptedNames));
    const hitTask = task.targets.find((t) => hits(mk.id, t.targetId)?.hit);
    if (hitTask && used.size && targetOutcomes.some((x) => x.targetId === hitTask.targetId && x.status === 'found') && (!o.requireLabels || labelMatches(mk.label, hitTask.name, hitTask.acceptedNames))) {
      markOutcomes.set(mk.id, { markId: mk.id, status: 'duplicate', targetId: hitTask.targetId, note: `Second mark in ${hitTask.name} — counted once.` });
      continue;
    }
    if (hitTask && !lvl.ok) {
      markOutcomes.set(mk.id, { markId: mk.id, status: 'off_level', targetId: hitTask.targetId, note: `Lies in ${hitTask.name}, but ${fmt(lvl.d)} mm outside the requested level.` });
      continue;
    }
    if (labelledAs) {
      const lt = input.targets.get(labelledAs.targetId);
      const counterpartId = lt ? counterpartClassId(lt.ref.classId) : null;
      const counterpart = counterpartId ? caseTargets.find((c) => c.ref.classId === counterpartId && c.ref.seriesUid === lt!.ref.seriesUid) : undefined;
      if (counterpart && hits(mk.id, counterpart.ref.id)?.hit) {
        markOutcomes.set(mk.id, { markId: mk.id, status: 'wrong_side', targetId: labelledAs.targetId, note: `Labelled ${labelledAs.name}, but it lies in the opposite-side structure (${counterpart.ref.label}).` });
        continue;
      }
      if (hitTask && hitTask.targetId !== labelledAs.targetId) {
        markOutcomes.set(mk.id, { markId: mk.id, status: 'wrong_structure', targetId: hitTask.targetId, note: `Labelled ${labelledAs.name}, but it lies within the reference for ${hitTask.name}.` });
        continue;
      }
      const h = hits(mk.id, labelledAs.targetId);
      if (h?.m.comparable && h.m.sliceDistanceMm > o.slab) {
        markOutcomes.set(mk.id, { markId: mk.id, status: 'off_level', targetId: labelledAs.targetId, note: `${labelledAs.name} is not outlined on this slice; nearest reference slice is ${fmt(h.m.sliceDistanceMm)} mm away.` });
        continue;
      }
      if (h?.m.comparable && h.m.inPlaneDistanceMm <= o.inPlane * 2.5) {
        markOutcomes.set(mk.id, { markId: mk.id, status: 'near_miss', targetId: labelledAs.targetId, note: `Close: ${fmt(h.m.inPlaneDistanceMm)} mm outside ${labelledAs.name} (tolerance ${fmt(o.inPlane)} mm).` });
        continue;
      }
    } else if (hitTask) {
      markOutcomes.set(mk.id, {
        markId: mk.id,
        status: 'wrong_structure',
        targetId: hitTask.targetId,
        note: o.requireLabels ? `This lies in ${hitTask.name}, but the label ${mk.label ? `“${mk.label}”` : '(none)'} does not name it.` : `Lies in ${hitTask.name}.`,
      });
      continue;
    }
    // Did it land in some other validated structure of the case?
    const other = caseTargets.find((c) => !task.targets.some((t) => t.targetId === c.ref.id) && hits(mk.id, c.ref.id)?.hit);
    if (other) {
      markOutcomes.set(mk.id, { markId: mk.id, status: 'wrong_structure', targetId: other.ref.id, note: `This point lies in the reference for ${other.ref.label}.` });
      continue;
    }
    markOutcomes.set(mk.id, {
      markId: mk.id,
      status: 'unmatched_unscored',
      targetId: null,
      note: 'No validated reference label covers this point, so it is not scored (it may be correct or not — the reference is incomplete here).',
    });
  }

  // 3) target statuses for unfound targets.
  for (const t of task.targets) {
    if (targetOutcomes.some((x) => x.targetId === t.targetId)) continue;
    const related = [...markOutcomes.values()].find((m) => m.targetId === t.targetId && m.status !== 'duplicate');
    const status: TargetOutcome['status'] =
      related?.status === 'wrong_side' ? 'wrong_side' : related?.status === 'off_level' ? 'off_level' : related?.status === 'near_miss' ? 'near_miss' : related?.status === 'wrong_structure' && o.requireLabels ? 'wrong_label' : 'missed';
    targetOutcomes.push({ targetId: t.targetId, name: t.name, status, markId: related?.markId ?? null, inPlaneDistanceMm: null, sliceDistanceMm: null, overlap: null, note: related?.note ?? 'Not identified.' });
  }

  const found = targetOutcomes.filter((t) => t.status === 'found' && required.some((r) => r.targetId === t.targetId)).length;
  const wrongMarks = [...markOutcomes.values()].filter((m) => ['wrong_structure', 'wrong_side', 'off_level', 'near_miss'].includes(m.status)).length;
  const errors: ErrorCategory[] = [];
  const statuses = [...markOutcomes.values()].map((m) => m.status);
  if (statuses.includes('off_level')) errors.push('navigation_failure');
  if (statuses.includes('wrong_structure')) errors.push('wrong_structure');
  if (statuses.includes('wrong_side')) errors.push('wrong_laterality');
  if (statuses.includes('near_miss')) errors.push('inaccurate_contour');
  if (found < required.length) errors.push('missed_finding');
  const denom = required.length + (o.shotgunPenalty ? wrongMarks : 0);
  const score = denom ? found / denom : 0;
  const allFound = found === required.length;
  const outcome: GradeResult['outcome'] = allFound && wrongMarks === 0 ? 'correct' : found > 0 ? 'partial' : 'incorrect';

  const levelOk = !statuses.includes('off_level');
  const components: GradeResult['components'] = {
    localization: { ok: allFound, detail: `${found} of ${required.length} required ${required.length === 1 ? 'target' : 'targets'} localized.` },
    identity: { ok: !statuses.includes('wrong_structure'), detail: statuses.includes('wrong_structure') ? 'At least one mark names or hits a different structure.' : 'No identity confusions.' },
    laterality: { ok: !statuses.includes('wrong_side'), detail: statuses.includes('wrong_side') ? 'A left/right confusion was detected.' : 'No side errors detected.' },
  };
  if (levelTarget) components.level = { ok: levelOk, detail: levelOk ? 'Marks are on an accepted level.' : 'At least one mark is outside the requested level.' };
  const dups = statuses.filter((s) => s === 'duplicate').length;
  const messages = [components.localization!.detail];
  if (dups) messages.push(`${dups} duplicate mark(s) in an already-found structure were counted once.`);
  const unscored = statuses.filter((s) => s === 'unmatched_unscored').length;
  if (unscored) messages.push(`${unscored} mark(s) fall outside every validated reference and were left unscored.`);
  return { ...base, outcome, score, components, targets: targetOutcomes, marks: [...markOutcomes.values()], errors, messages };
}

function gradeFindings(base: GradeResult, input: GradeInput, g: Extract<Task['grading'], { kind: 'findings' }>): GradeResult {
  const { task, marks } = input;
  const loaded = task.targets.map((t) => ({ t, lt: input.targets.get(t.targetId)! })).filter((x) => x.lt);
  const wholeStudy = loaded.length > 0 && loaded.every((x) => x.lt.ref.completeness === 'whole_study_reviewed');
  if (!marks.length && !input.declaredNoFinding) return { ...base, messages: ['No marks placed.'] };
  if (input.declaredNoFinding && !marks.length) {
    if (!loaded.length) return { ...base, outcome: 'correct', score: 1, messages: ['You reported no target finding.'] };
    return {
      ...base,
      outcome: 'incorrect',
      score: 0,
      errors: ['missed_finding'],
      targets: loaded.map(({ t }) => ({ targetId: t.targetId, name: t.name, status: 'missed', markId: null, inPlaneDistanceMm: null, sliceDistanceMm: null, overlap: null, note: 'Present in the reference but not marked.' })),
      messages: [`The reference contains ${loaded.length} finding(s) you did not mark.`],
    };
  }
  const probes = new Map(marks.map((m) => [m.id, probeOfMark(m, input.series.get(m.seriesUid))]));
  const used = new Set<string>();
  const targets: TargetOutcome[] = [];
  const markOut: MarkOutcome[] = [];
  for (const { t, lt } of loaded) {
    let best: { id: string; m: ReturnType<typeof measureProbe>; iou: number | null } | null = null;
    for (const mk of marks) {
      if (used.has(mk.id)) continue;
      const p = probes.get(mk.id)!;
      const m = measureWithinSlab(p, lt, input.series.get(p.seriesUid), g.slabToleranceMm);
      const detected = m.comparable && m.sliceDistanceMm <= g.slabToleranceMm && m.inPlaneDistanceMm <= g.inPlaneToleranceMm;
      const iou = markIoU(mk, lt, m.planeSop);
      const ok = g.matchRule === 'iou' ? iou !== null && iou >= (g.iouThreshold ?? 0.3) : detected;
      if (ok && (!best || m.inPlaneDistanceMm < best.m.inPlaneDistanceMm)) best = { id: mk.id, m, iou };
    }
    if (best) {
      used.add(best.id);
      const precise = best.iou === null || g.iouThreshold === null || best.iou >= g.iouThreshold;
      markOut.push({ markId: best.id, status: 'matched', targetId: t.targetId, note: `Matches ${t.name}.` });
      targets.push({ targetId: t.targetId, name: t.name, status: 'found', markId: best.id, inPlaneDistanceMm: best.m.inPlaneDistanceMm, sliceDistanceMm: best.m.sliceDistanceMm, overlap: best.iou, note: precise ? 'Detected.' : `Detected; boundary overlap ${(best.iou! * 100).toFixed(0)}% is below the ${(g.iouThreshold! * 100).toFixed(0)}% outline target.` });
    } else targets.push({ targetId: t.targetId, name: t.name, status: 'missed', markId: null, inPlaneDistanceMm: null, sliceDistanceMm: null, overlap: null, note: 'Present in the reference but not marked.' });
  }
  for (const mk of marks) {
    if (used.has(mk.id)) continue;
    const dupOf = targets.find((t) => {
      const lt = input.targets.get(t.targetId);
      if (!lt || t.status !== 'found') return false;
      const p = probes.get(mk.id)!;
      const m = measureWithinSlab(p, lt, input.series.get(p.seriesUid), g.slabToleranceMm);
      return m.comparable && m.sliceDistanceMm <= g.slabToleranceMm && m.inPlaneDistanceMm <= g.inPlaneToleranceMm;
    });
    if (dupOf) markOut.push({ markId: mk.id, status: 'duplicate', targetId: dupOf.targetId, note: `Additional mark on ${dupOf.name} — counted once.` });
    else
      markOut.push(
        wholeStudy
          ? { markId: mk.id, status: 'false_positive', targetId: null, note: 'The whole-study reference contains no finding here.' }
          : { markId: mk.id, status: 'unmatched_unscored', targetId: null, note: 'Outside the referenced findings. The reference does not cover the whole study, so this is unscored rather than counted as a false positive.' },
      );
  }
  const found = targets.filter((t) => t.status === 'found').length;
  const fps = markOut.filter((m) => m.status === 'false_positive').length;
  const imprecise = targets.some((t) => t.overlap !== null && g.iouThreshold !== null && t.overlap < g.iouThreshold);
  const errors: ErrorCategory[] = [];
  if (found < loaded.length) errors.push('missed_finding');
  if (fps) errors.push('overcalling');
  if (imprecise) errors.push('inaccurate_contour');
  const score = loaded.length ? found / (loaded.length + fps) : 0;
  return {
    ...base,
    outcome: found === loaded.length && fps === 0 ? 'correct' : found > 0 ? 'partial' : 'incorrect',
    score,
    components: { detection: { ok: found === loaded.length, detail: `${found} of ${loaded.length} referenced finding(s) detected${wholeStudy ? `, ${fps} false positive(s)` : ''}.` } },
    targets,
    marks: markOut,
    errors,
    messages: [
      `${found} of ${loaded.length} referenced finding(s) detected.`,
      wholeStudy ? `False positives: ${fps}.` : 'False positives are not counted because the reference covers only the listed findings.',
    ],
  };
}

/** IoU between a box/outline mark and the target shape on the same plane (contract px), if computable. */
function markIoU(mk: LearnerMark, lt: LoadedTarget, planeSop: string | null): number | null {
  if (!mk.imagePx || !planeSop || mk.sopInstanceUid !== planeSop) return null;
  if (mk.tool !== 'box' || mk.imagePx.length < 2) return null;
  const markBox: Box = [mk.imagePx[0][0], mk.imagePx[0][1], mk.imagePx[1][0], mk.imagePx[1][1]];
  const g = lt.geom;
  if (g.geometryType === 'box') {
    const b = g.boxes.filter((x) => x.sopInstanceUid === planeSop);
    return b.length ? Math.max(...b.map((x) => boxIoU(markBox, x.box))) : null;
  }
  if (g.geometryType === 'contour_set' && g.space === 'image_px') {
    const plane = g.planes.find((p) => p.sopInstanceUid === planeSop);
    if (!plane) return null;
    return Math.max(...(plane.polygons as Vec2[][]).map((poly) => boxIoU(markBox, polygonBounds(poly))));
  }
  return null;
}

export const SIDE_WORD = SIDE;
