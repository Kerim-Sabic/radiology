/**
 * CaseRepository: loads the pack index, pack manifests, authored lessons and reference
 * geometry; builds lookups; produces Cornerstone image ids. Only entries whose assets
 * exist reach the usable catalogue — missing packs are reported, never faked.
 */
import {
  LessonFile,
  PackIndex,
  PackManifest,
  TargetGeometry,
  type ReferenceTarget,
  type Series,
  type Study,
  type Subject,
  type Task,
  type TeachingCase,
  type SpatialLink,
} from '../schema/content';
import { SeriesIndex } from '../grading/seriesIndex';
import { sliceNormal } from '../lib/geometry';
import type { LoadedTarget } from '../grading/spatialGrader';
import type { SeriesSource } from '../viewer/engine';

export function packBaseUrl(): string {
  const configured = import.meta.env.VITE_PACK_BASE_URL as string | undefined;
  const base = configured && configured.trim() ? configured.trim() : `${import.meta.env.BASE_URL}packs/`;
  return base.endsWith('/') ? base : `${base}/`;
}

function absolute(url: string): string {
  return new URL(url, window.location.href).href;
}

export interface LoadedPack {
  id: string;
  root: string; // absolute URL of the pack folder
  manifest: PackManifest;
  lessons: LessonFile | null;
  distribution: string;
}

export interface PackStatus {
  id: string;
  title: string;
  status: 'loaded' | 'missing' | 'invalid';
  detail: string;
  bytes: number;
  distribution: string;
}

export class Catalog {
  packs: LoadedPack[] = [];
  status: PackStatus[] = [];
  subjects = new Map<string, Subject>();
  studies = new Map<string, Study>();
  series = new Map<string, Series>();
  seriesPack = new Map<string, LoadedPack>();
  targets = new Map<string, ReferenceTarget>();
  targetPack = new Map<string, LoadedPack>();
  links: SpatialLink[] = [];
  cases = new Map<string, TeachingCase>();
  tasks = new Map<string, Task>();
  tasksByCase = new Map<string, Task[]>();
  invalidCases: Array<{ id: string; reason: string }> = [];
  private geometryCache = new Map<string, Promise<TargetGeometry>>();
  private indexCache = new Map<string, SeriesIndex>();

  static async load(signal?: AbortSignal): Promise<Catalog> {
    const c = new Catalog();
    const base = packBaseUrl();
    let index: PackIndex;
    try {
      const res = await fetch(`${base}index.json`, { signal, cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      index = PackIndex.parse(await res.json());
    } catch (e) {
      c.status.push({ id: 'index', title: 'Pack index', status: 'missing', detail: `Could not load ${base}index.json (${String(e)})`, bytes: 0, distribution: 'repo' });
      return c;
    }
    await Promise.all(
      index.packs.map(async (entry) => {
        const root = absolute(`${base}${entry.manifest.replace(/pack\.json$/, '')}`);
        try {
          const res = await fetch(absolute(`${base}${entry.manifest}`), { signal, cache: 'no-cache' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const parsed = PackManifest.safeParse(await res.json());
          if (!parsed.success) {
            c.status.push({ id: entry.id, title: entry.title, status: 'invalid', detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), bytes: entry.bytes, distribution: entry.distribution });
            return;
          }
          let lessons: LessonFile | null = null;
          {
            // Authored lessons live beside pack.json unless the index names another file.
            const lessonsPath = entry.lessons ?? entry.manifest.replace(/pack\.json$/, 'lessons.json');
            const lr = await fetch(absolute(`${base}${lessonsPath}`), { signal, cache: 'no-cache' }).catch(() => null);
            // SPA hosts answer missing files with index.html — only accept real JSON.
            if (lr?.ok && (lr.headers.get('content-type') ?? '').includes('json')) {
              const body = await lr.json().catch(() => null);
              const lp = LessonFile.safeParse(body);
              if (lp.success) lessons = lp.data;
              else c.invalidCases.push({ id: `${entry.id}/lessons.json`, reason: lp.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
            }
          }
          // Every selectable study must open real assets: probe one DICOM file of the pack (cheap HEAD).
          const probe = parsed.data.series[0]?.instances[0]?.file;
          if (probe) {
            const h = await fetch(new URL(probe, root).href, { method: 'HEAD', signal }).catch(() => null);
            const ct = h?.headers.get('content-type') ?? '';
            if (!h || !h.ok || ct.includes('text/html')) {
              c.status.push({ id: entry.id, title: entry.title, status: 'missing', detail: `Manifest present but image files are not on this host — run: python scripts/data/packs.py fetch ${entry.id}, or set VITE_PACK_BASE_URL.`, bytes: entry.bytes, distribution: entry.distribution });
              return;
            }
          }
          c.packs.push({ id: entry.id, root, manifest: parsed.data, lessons, distribution: entry.distribution });
          c.status.push({ id: entry.id, title: entry.title, status: 'loaded', detail: entry.note, bytes: entry.bytes, distribution: entry.distribution });
        } catch (e) {
          c.status.push({ id: entry.id, title: entry.title, status: 'missing', detail: `${String(e)} — run: python scripts/data/packs.py fetch ${entry.id}`, bytes: entry.bytes, distribution: entry.distribution });
        }
      }),
    );
    c.packs.sort((a, b) => a.id.localeCompare(b.id));
    c.index();
    return c;
  }

  private index() {
    for (const p of this.packs) {
      const m = p.manifest;
      // A subject or study may be split across packs (e.g. radiograph in one, CT in another): merge, never overwrite.
      for (const s of m.subjects) {
        const cur = this.subjects.get(s.key);
        this.subjects.set(s.key, cur ? { ...cur, studyUids: [...new Set([...cur.studyUids, ...s.studyUids])] } : s);
      }
      for (const s of m.studies) {
        const cur = this.studies.get(s.uid);
        this.studies.set(s.uid, cur ? { ...cur, seriesUids: [...new Set([...cur.seriesUids, ...s.seriesUids])], modalities: [...new Set([...cur.modalities, ...s.modalities])] } : s);
      }
      for (const s of m.series) {
        this.series.set(s.uid, s);
        this.seriesPack.set(s.uid, p);
      }
      for (const t of m.referenceTargets) {
        this.targets.set(t.id, t);
        this.targetPack.set(t.id, p);
      }
      this.links.push(...m.spatialLinks);
    }
    // Two passes: every pack's cases first, so a pack may attach tasks to cases defined in another pack.
    for (const p of this.packs) {
      if (!p.lessons) continue;
      for (const kase of p.lessons.cases) {
        const problem = this.validateCase(kase);
        if (problem) {
          this.invalidCases.push({ id: kase.id, reason: problem });
          continue;
        }
        this.cases.set(kase.id, kase);
      }
    }
    for (const p of this.packs) {
      if (!p.lessons) continue;
      for (const t of p.lessons.tasks) {
        if (!this.cases.has(t.caseId)) continue;
        const problem = this.validateTask(t);
        if (problem) {
          this.invalidCases.push({ id: t.id, reason: problem });
          continue;
        }
        this.tasks.set(t.id, t);
        const arr = this.tasksByCase.get(t.caseId) ?? [];
        arr.push(t);
        this.tasksByCase.set(t.caseId, arr);
      }
    }
  }

  private validateCase(k: TeachingCase): string | null {
    if (!this.subjects.has(k.subjectKey)) return `subject ${k.subjectKey} not in any loaded pack`;
    if (!this.series.has(k.primarySeriesUid)) return `primary series ${k.primarySeriesUid} missing`;
    for (const s of k.studyUids) {
      const st = this.studies.get(s);
      if (!st) return `study ${s} missing`;
      if (st.subjectKey !== k.subjectKey) return `study ${s} belongs to another subject — refusing to merge patients`;
    }
    return null;
  }

  private validateTask(t: Task): string | null {
    for (const s of t.seriesUids) if (!this.series.has(s)) return `series ${s} missing`;
    if (!this.series.has(t.start.seriesUid)) return 'start series missing';
    for (const tt of t.targets) if (!this.targets.has(tt.targetId)) return `target ${tt.targetId} missing`;
    const kase = this.cases.get(t.caseId)!;
    for (const s of t.seriesUids) if (this.series.get(s)!.subjectKey !== kase.subjectKey) return `series ${s} is from a different subject`;
    return null;
  }

  /** Local (user-imported) studies: kept in memory for this session; files never leave the device. */
  localImageIds = new Map<string, string[]>();
  addLocalPack(manifest: PackManifest, lessons: LessonFile, imageIds: Map<string, string[]>) {
    const pack: LoadedPack = { id: manifest.packId, root: window.location.href, manifest, lessons, distribution: 'local' };
    this.packs = this.packs.filter((p) => p.id !== pack.id);
    this.packs.push(pack);
    for (const [k, v] of imageIds) this.localImageIds.set(k, v);
    this.subjects.clear();
    this.studies.clear();
    this.series.clear();
    this.seriesPack.clear();
    this.targets.clear();
    this.targetPack.clear();
    this.links = [];
    this.cases.clear();
    this.tasks.clear();
    this.tasksByCase.clear();
    this.invalidCases = [];
    this.indexCache.clear();
    this.index();
  }

  seriesIndex(uid: string): SeriesIndex | undefined {
    const s = this.series.get(uid);
    if (!s) return undefined;
    let idx = this.indexCache.get(uid);
    if (!idx) {
      idx = new SeriesIndex(s);
      this.indexCache.set(uid, idx);
    }
    return idx;
  }

  seriesSource(uid: string): SeriesSource | null {
    const s = this.series.get(uid);
    const p = this.seriesPack.get(uid);
    if (!s || !p) return null;
    const local = this.localImageIds.get(uid);
    if (local) {
      const preset = s.windowPresets[0];
      return {
        seriesUid: uid,
        imageIds: local,
        urls: local.map(() => ''),
        sopUids: s.instances.map((i) => i.sopInstanceUid),
        modality: s.modality,
        hasPatientGeometry: !!s.geometry.iop && s.instances.every((i) => i.ipp),
        patientOrientation: typeof s.acquisition['PatientOrientation'] === 'string' ? String(s.acquisition['PatientOrientation']).split('\\') : null,
        volumeEligible: s.geometry.volumeEligible,
        defaultWindow: preset ? { center: preset.center, width: preset.width } : null,
      };
    }
    // Display order: axial stacks run head → feet (index 0 = most superior), like a reading workstation.
    // Packs store ascending position along the slice normal; grading never depends on this order.
    const normal = s.geometry.iop ? sliceNormal(s.geometry.iop) : null;
    const instances = normal && Math.abs(normal[2]) > 0.7 && normal[2] > 0 ? [...s.instances].reverse() : s.instances;
    const urls = instances.map((i) => new URL(i.file, p.root).href);
    const imageIds: string[] = [];
    instances.forEach((inst, k) => {
      if (inst.frames > 1) for (let f = 1; f <= inst.frames; f++) imageIds.push(`wadouri:${urls[k]}?frame=${f}`);
      else imageIds.push(`wadouri:${urls[k]}`);
    });
    const preset = s.windowPresets[0];
    const po = s.acquisition['PatientOrientation'];
    return {
      seriesUid: uid,
      imageIds,
      urls: imageIds.map((id) => id.replace(/^wadouri:/, '').replace(/\?frame=\d+$/, '')),
      sopUids: instances.flatMap((i) => Array.from({ length: i.frames }, () => i.sopInstanceUid)),
      modality: s.modality,
      hasPatientGeometry: !!s.geometry.iop && s.instances.every((i) => i.ipp),
      patientOrientation: Array.isArray(po) ? po : typeof po === 'string' ? po.split('\\') : null,
      volumeEligible: s.geometry.volumeEligible,
      defaultWindow: preset ? { center: preset.center, width: preset.width } : null,
    };
  }

  thumbnailUrl(uid: string): string | null {
    const s = this.series.get(uid);
    const p = this.seriesPack.get(uid);
    return s?.thumbnail && p ? new URL(s.thumbnail, p.root).href : null;
  }

  async targetGeometry(targetId: string): Promise<TargetGeometry> {
    let pr = this.geometryCache.get(targetId);
    if (!pr) {
      const t = this.targets.get(targetId);
      const p = this.targetPack.get(targetId);
      if (!t || !p) throw new Error(`Unknown target ${targetId}`);
      pr = fetch(new URL(t.geometryFile, p.root).href)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((j) => TargetGeometry.parse(j));
      this.geometryCache.set(targetId, pr);
      pr.catch(() => this.geometryCache.delete(targetId));
    }
    return pr;
  }

  async loadTargets(ids: string[]): Promise<Map<string, LoadedTarget>> {
    const out = new Map<string, LoadedTarget>();
    await Promise.all(
      ids.map(async (id) => {
        const ref = this.targets.get(id);
        if (!ref) return;
        try {
          out.set(id, { ref, geom: await this.targetGeometry(id) });
        } catch {
          /* missing geometry → grader reports "not scored" */
        }
      }),
    );
    return out;
  }

  /** Task-layer targets on the series of a case (used for grading and to explain where a mark landed). */
  targetsForSeries(seriesUids: string[]): string[] {
    const set = new Set(seriesUids);
    return [...this.targets.values()].filter((t) => set.has(t.seriesUid) && t.layer !== 'atlas').map((t) => t.id);
  }

  /** How many anatomy labels a case has (from manifests only — nothing is downloaded). */
  anatomyCounts(caseId: string): { expert: number; ai: number; total: number } {
    const k = this.cases.get(caseId);
    if (!k) return { expert: 0, ai: 0, total: 0 };
    const ids = this.anatomyTargetsForSeries(this.seriesForCase(k).map((s) => s.uid));
    let expert = 0;
    let ai = 0;
    for (const id of ids) {
      const p = this.targets.get(id)?.provenance;
      if (p === 'ai_draft' || p === 'source_automated') ai++;
      else expert++;
    }
    return { expert, ai, total: expert + ai };
  }

  /**
   * Whole-anatomy labels for the Learn-mode layer: atlas-layer targets (expert or AI) plus expert
   * anatomical task references. Findings (nodules, tumours…) are excluded — they are answers, not anatomy.
   */
  anatomyTargetsForSeries(seriesUids: string[]): string[] {
    const set = new Set(seriesUids);
    const candidates = [...this.targets.values()].filter(
      (t) => set.has(t.seriesUid) && t.geometryType === 'contour_set' && (t.layer === 'atlas' || (t.classId.startsWith('anatomy:') && t.provenance !== 'ai_draft')),
    );
    // Expert labels win: hide an AI outline when an expert one exists for the same structure on the same series.
    const isAi = (p: string) => p === 'ai_draft' || p === 'source_automated';
    const expertKeys = new Set(candidates.filter((t) => !isAi(t.provenance)).map((t) => `${t.seriesUid}|${t.classId}`));
    // Named parts replace a machine-drawn whole: a series with "Aortic arch" etc. does not also draw one AI "Aorta" over them.
    // An expert whole outline is never hidden.
    const partOf = (c: string) => /^anatomy:(aorta|colon)_/.exec(c)?.[1] ?? (/^anatomy:heart_(atrium|ventricle)_/.test(c) ? 'heart' : null);
    const wholeOf = (c: string) => (c === 'anatomy:aorta' ? 'aorta' : c === 'anatomy:colon' || c === 'anatomy:large_intestine' ? 'colon' : c === 'anatomy:heart' ? 'heart' : null);
    const partsOn = new Set(candidates.flatMap((t) => (partOf(t.classId) ? [`${t.seriesUid}|${partOf(t.classId)}`] : [])));
    return candidates
      .filter((t) => !(isAi(t.provenance) && expertKeys.has(`${t.seriesUid}|${t.classId}`)))
      .filter((t) => !(isAi(t.provenance) && partsOn.has(`${t.seriesUid}|${wholeOf(t.classId)}`)))
      .map((t) => t.id);
  }

  seriesForCase(k: TeachingCase): Series[] {
    return k.studyUids.flatMap((st) => (this.studies.get(st)?.seriesUids ?? []).map((u) => this.series.get(u)).filter((s): s is Series => !!s));
  }

  /** Relationship between two series for comparison layouts (never inferred from resemblance). */
  relationship(a: string, b: string): { kind: SpatialLink['kind'] | 'same_series'; evidence: string } {
    if (a === b) return { kind: 'same_series', evidence: 'Same series' };
    const link = this.links.find((l) => (l.seriesA === a && l.seriesB === b) || (l.seriesA === b && l.seriesB === a));
    if (link) return { kind: link.kind, evidence: link.evidence };
    const sa = this.series.get(a);
    const sb = this.series.get(b);
    if (!sa || !sb) return { kind: 'independent', evidence: 'Unknown series' };
    if (sa.subjectKey !== sb.subjectKey) return { kind: 'different_patients', evidence: 'Different source subjects' };
    if (sa.frameOfReferenceUid && sa.frameOfReferenceUid === sb.frameOfReferenceUid && sa.studyUid === sb.studyUid)
      return { kind: 'common_frame', evidence: 'Same study and Frame of Reference UID' };
    return { kind: 'independent', evidence: `Same source subject (${sa.subjectKey}); separate acquisitions — independent controls` };
  }

  holdoutGroup(caseId: string): string {
    const k = this.cases.get(caseId);
    return k ? (this.subjects.get(k.subjectKey)?.holdoutGroup ?? k.subjectKey) : caseId;
  }
}
