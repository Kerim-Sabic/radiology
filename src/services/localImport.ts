/**
 * Local DICOM import (files, folder, or ZIP). Files stay in this browser session; nothing is
 * uploaded. Series are grouped by Study/Series UID and orientation, sorted by geometry, and
 * checked for MPR safety exactly like the shipped packs.
 */
import { unzip } from 'fflate';
import { SCHEMA_VERSION, type LessonFile, type PackManifest, type Series } from '../schema/content';
import { sortSlicesGeometric, type Vec3 } from '../lib/geometry';

export interface ImportProgress {
  phase: 'reading' | 'unzipping' | 'parsing' | 'done';
  done: number;
  total: number;
  skipped: number;
  message?: string;
}

export const ZIP_MAX_EXPANDED = 1.5 * 1024 ** 3; // refuse ZIPs that expand beyond 1.5 GB
export const ZIP_MAX_ENTRIES = 20000;

type Nat = Record<string, unknown>;
const first = (n: Nat, k: string) => {
  const v = n[k];
  return Array.isArray(v) ? v[0] : v;
};
const arr = (n: Nat, k: string): number[] | null => {
  const v = n[k];
  if (v === undefined || v === null) return null;
  const a = (Array.isArray(v) ? v : String(v).split('\\')).map(Number);
  return a.every((x) => Number.isFinite(x)) ? a : null;
};
const str = (n: Nat, k: string) => {
  const v = first(n, k);
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') return (v as { Alphabetic?: string }).Alphabetic ?? JSON.stringify(v);
  return String(v);
};

export async function expandZip(file: File, signal: AbortSignal, onProgress: (p: ImportProgress) => void): Promise<File[]> {
  onProgress({ phase: 'unzipping', done: 0, total: 1, skipped: 0 });
  const buf = new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    let expanded = 0;
    let count = 0;
    const term = unzip(
      buf,
      {
        filter: (f) => {
          count++;
          expanded += f.originalSize;
          if (count > ZIP_MAX_ENTRIES || expanded > ZIP_MAX_EXPANDED) return false;
          return !f.name.endsWith('/') && !/(^|\/)(__MACOSX|\.)/.test(f.name);
        },
      },
      (err, files) => {
        if (err) return reject(err);
        if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
        if (count > ZIP_MAX_ENTRIES || expanded > ZIP_MAX_EXPANDED) return reject(new Error(`ZIP too large when expanded (limit ${(ZIP_MAX_EXPANDED / 1024 ** 3).toFixed(1)} GB / ${ZIP_MAX_ENTRIES} files).`));
        resolve(Object.entries(files).map(([name, data]) => new File([data as BlobPart], name.split('/').pop() || name)));
      },
    );
    signal.addEventListener('abort', () => {
      term();
      reject(new DOMException('Cancelled', 'AbortError'));
    });
  });
}

export async function importLocalFiles(files: File[], signal: AbortSignal, onProgress: (p: ImportProgress) => void, installedSeries: Set<string> = new Set()) {
  const { cs, dicomImageLoader, initCornerstone } = await import('../viewer/csInit');
  await initCornerstone();
  const items: Array<{ imageId: string; nat: Nat; bytes: number }> = [];
  let skipped = 0;
  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const f = files[i];
    onProgress({ phase: 'parsing', done: i, total: files.length, skipped });
    try {
      const buf = await f.arrayBuffer();
      const magic = new Uint8Array(buf, 128, 4);
      if (buf.byteLength < 132 || String.fromCharCode(...magic) !== 'DICM') {
        skipped++;
        continue;
      }
      const imageId = `dicomfile:${dicomImageLoader.wadouri.fileManager.add(f)}`;
      await dicomImageLoader.prefetchPart10Instance(imageId, buf);
      const nat = cs.metaData.get('naturalized', imageId) as Nat | undefined;
      if (!nat || !nat.PixelData) {
        skipped++;
        continue;
      }
      items.push({ imageId, nat, bytes: buf.byteLength });
    } catch {
      skipped++;
    }
  }
  onProgress({ phase: 'done', done: files.length, total: files.length, skipped });

  // Group by study / series / orientation.
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const iop = arr(it.nat, 'ImageOrientationPatient');
    const key = `${str(it.nat, 'StudyInstanceUID')}|${str(it.nat, 'SeriesInstanceUID')}|${iop ? iop.map((v) => v.toFixed(3)).join(',') : 'proj'}`;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const session = `local-${Date.now().toString(36)}`;
  const subjectKey = `local:${session}`;
  const series: Series[] = [];
  const imageIds = new Map<string, string[]>();
  const studies = new Map<string, { uid: string; date: string | null; description: string; series: string[]; modalities: Set<string> }>();
  let g = 0;
  for (const [, list] of groups) {
    g++;
    const n0 = list[0].nat;
    const studyUid = str(n0, 'StudyInstanceUID') ?? `${session}-study`;
    const baseUid = str(n0, 'SeriesInstanceUID') ?? `${session}-series-${g}`;
    const uid = groups.size > 1 && [...groups.keys()].filter((k) => k.includes(`|${baseUid}|`)).length > 1 ? `${baseUid}#${g}` : baseUid;
    const iop = arr(n0, 'ImageOrientationPatient');
    const sorted = sortSlicesGeometric(list.map((it) => ({ key: it.imageId, ipp: (arr(it.nat, 'ImagePositionPatient') as Vec3 | null) ?? null, iop: arr(it.nat, 'ImageOrientationPatient') })));
    const order = sorted.order.length === list.length && sorted.normal ? sorted.order : list.sort((a, b) => Number(first(a.nat, 'InstanceNumber') ?? 0) - Number(first(b.nat, 'InstanceNumber') ?? 0)).map((x) => x.imageId);
    const byId = new Map(list.map((x) => [x.imageId, x]));
    const modality = str(n0, 'Modality') ?? 'OT';
    const ps = arr(n0, 'PixelSpacing');
    const ips = arr(n0, 'ImagerPixelSpacing');
    const wc = arr(n0, 'WindowCenter');
    const ww = arr(n0, 'WindowWidth');
    const slope = Number(first(n0, 'RescaleSlope') ?? 1);
    const intercept = Number(first(n0, 'RescaleIntercept') ?? 0);
    const desc = str(n0, 'SeriesDescription') ?? '';
    const isScout = /locali[sz]er|scout|topogram|surview/i.test(desc) || /LOCALIZER/i.test(String(n0.ImageType ?? ''));
    series.push({
      uid,
      studyUid,
      subjectKey,
      modality,
      sopClassUid: str(n0, 'SOPClassUID') ?? '',
      frameOfReferenceUid: str(n0, 'FrameOfReferenceUID'),
      number: Number(first(n0, 'SeriesNumber') ?? 0) || null,
      description: desc,
      bodyPart: str(n0, 'BodyPartExamined'),
      role: isScout ? 'scout' : 'diagnostic',
      roleNote: isScout ? 'Localizer/scout by description or ImageType' : 'Imported locally',
      acquisition: {
        ProtocolName: str(n0, 'ProtocolName'),
        ScanningSequence: str(n0, 'ScanningSequence'),
        SequenceVariant: str(n0, 'SequenceVariant'),
        SequenceName: str(n0, 'SequenceName'),
        EchoTime: str(n0, 'EchoTime'),
        RepetitionTime: str(n0, 'RepetitionTime'),
        ContrastBolusAgent: str(n0, 'ContrastBolusAgent'),
        ViewPosition: str(n0, 'ViewPosition'),
        PatientOrientation: Array.isArray(n0.PatientOrientation) ? (n0.PatientOrientation as string[]).join('\\') : str(n0, 'PatientOrientation'),
      },
      geometry: {
        rows: Number(first(n0, 'Rows') ?? 0),
        columns: Number(first(n0, 'Columns') ?? 0),
        pixelSpacing: ps ? [ps[0], ps[1]] : ips ? [ips[0], ips[1]] : null,
        pixelSpacingSource: ps ? 'PixelSpacing' : ips ? 'ImagerPixelSpacing' : 'none',
        spacingCalibrated: !!ps && (modality === 'CT' || modality === 'MR'),
        iop: iop && iop.length === 6 ? iop : null,
        sliceSpacing: sorted.spacing,
        sliceSpacingUniform: sorted.issues.length === 0,
        volumeEligible: sorted.volumeEligible && list.length >= 3 && (modality === 'CT' || modality === 'MR' || modality === 'PT'),
        volumeIssues: sorted.issues,
        photometric: str(n0, 'PhotometricInterpretation') ?? 'MONOCHROME2',
        bitsStored: Number(first(n0, 'BitsStored') ?? 16),
        pixelRepresentation: Number(first(n0, 'PixelRepresentation') ?? 0),
        rescale: { slope, intercept, type: str(n0, 'RescaleType') },
        hu: modality === 'CT',
      },
      encoding: { transferSyntaxes: [str(n0, 'TransferSyntaxUID') ?? 'unknown'], reencodedFrom: null, lossless: true, note: 'Local file as provided' },
      instances: order.map((id) => {
        const it = byId.get(id)!;
        return {
          sopInstanceUid: str(it.nat, 'SOPInstanceUID') ?? id,
          file: id,
          bytes: it.bytes,
          sha256: '',
          frames: 1,
          instanceNumber: Number(first(it.nat, 'InstanceNumber') ?? 0) || null,
          ipp: (arr(it.nat, 'ImagePositionPatient') as Vec3 | null) ?? null,
        };
      }),
      thumbnail: null,
      bytes: list.reduce((a, x) => a + x.bytes, 0),
      windowPresets:
        modality === 'CT'
          ? [
              { label: 'Soft tissue', center: 40, width: 400 },
              { label: 'Lung', center: -600, width: 1500 },
              { label: 'Bone', center: 400, width: 1800 },
              { label: 'Brain', center: 40, width: 80 },
            ]
          : wc && ww
            ? [{ label: 'File default', center: wc[0], width: ww[0] }]
            : [],
    });
    imageIds.set(uid, order);
    const st = studies.get(studyUid) ?? { uid: studyUid, date: str(n0, 'StudyDate'), description: str(n0, 'StudyDescription') ?? 'Imported study', series: [], modalities: new Set<string>() };
    st.series.push(uid);
    st.modalities.add(modality);
    studies.set(studyUid, st);
  }
  if (!series.length) throw new Error(`No readable DICOM images found (${skipped} file(s) skipped).`);
  // DICOM UIDs are global: an imported copy of an installed series must never merge with it.
  // Namespace every local UID and report exact duplicates of installed series by Series Instance UID.
  const duplicates = series.filter((s) => installedSeries.has(s.uid.replace(/#\d+$/, ''))).map((s) => s.uid.replace(/#\d+$/, ''));
  const ns = (uid: string) => `${session}:${uid}`;
  for (const s of series) {
    const ids = imageIds.get(s.uid)!;
    imageIds.delete(s.uid);
    s.uid = ns(s.uid);
    s.studyUid = ns(s.studyUid);
    imageIds.set(s.uid, ids);
  }
  for (const st of [...studies.values()]) {
    studies.delete(st.uid);
    st.uid = ns(st.uid);
    st.series = st.series.map(ns);
    studies.set(st.uid, st);
  }
  const fmtDate = (d: string | null) => (d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d);
  const manifest: PackManifest = {
    schemaVersion: SCHEMA_VERSION,
    packId: session,
    version: '1',
    title: 'Local import',
    description: 'Studies imported from this device (not uploaded).',
    generatedAt: new Date().toISOString(),
    generator: 'browser local import',
    sources: [{ id: 'local', name: 'Local import', url: '', license: 'Your own files', citation: '' }],
    subjects: [{ key: subjectKey, sourceId: 'local', sourceSubjectId: session, linkageEvidence: 'All files imported together in one local session. Patient identity was not verified by the app.', holdoutGroup: subjectKey, studyUids: [...studies.keys()] }],
    studies: [...studies.values()].map((s) => ({ uid: s.uid, subjectKey, description: s.description, modalities: [...s.modalities], date: fmtDate(s.date), dateShifted: 'unknown', relativeDays: null, timingNote: 'From file headers', seriesUids: s.series })),
    series,
    spatialLinks: [],
    referenceTargets: [],
  };
  const primary = series.find((s) => s.role !== 'scout') ?? series[0];
  const caseId = `${session}-case`;
  const lessons: LessonFile = {
    schemaVersion: SCHEMA_VERSION,
    packId: session,
    version: '1',
    cases: [
      {
        id: caseId,
        packId: session,
        neutralTitle: `Imported · ${[...new Set(series.map((s) => s.modality))].join('/')}`,
        learnTitle: `Imported study (${series.length} series)`,
        subjectKey,
        studyUids: [...studies.keys()],
        primarySeriesUid: primary.uid,
        region: [],
        clinicalContext: null,
        contextSource: null,
        difficulty: 'exploratory',
        objectiveIds: [],
        bookAnchors: [],
        referenceSummary: duplicates.length
          ? `No reference annotations — free reading with self-review only. ${duplicates.length} imported series match series already installed in this app (same Series Instance UID); they are kept as a separate local copy.`
          : 'No reference annotations — free reading with self-review only.',
        learnNotes: 'Free reading of your own study. Nothing here is scored automatically.',
      },
    ],
    tasks: [
      {
        id: `${caseId}:read`,
        caseId,
        type: 'whole_study',
        title: 'Free read with self-review',
        prompt: 'Read the study systematically. Mark anything you consider abnormal and write findings and an impression.',
        modes: ['learn', 'practice'],
        seriesUids: series.map((s) => s.uid),
        start: { seriesUid: primary.uid, slice: 'first', windowPreset: null },
        targets: [],
        grading: { kind: 'self_review' },
        scoring: 'exploratory_self_review',
        hints: [],
        explanation: 'No reference exists for imported studies; compare with the original report if you have one.',
        bookAnchors: [],
        objectiveIds: [],
        skillDimensions: ['orientation', 'navigation_windowing', 'reporting'],
        allowUncertain: true,
      },
    ],
  };
  return { manifest, lessons, imageIds, caseId, skipped, seriesCount: series.length, duplicates };
}
