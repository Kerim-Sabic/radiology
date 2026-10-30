#!/usr/bin/env node
/**
 * Generates docs/CONTENT_INVENTORY.md and docs/COVERAGE.md from the files actually installed
 * (public/packs/*, public/content/*). Nothing here is typed by hand; planned sources are not counted.
 * Usage: node scripts/report/content-report.mjs
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const PACKS = join(ROOT, 'public', 'packs');
const read = (p) => JSON.parse(readFileSync(p, 'utf-8'));
const index = read(join(PACKS, 'index.json'));
const packs = [];
for (const e of index.packs) {
  const dir = join(PACKS, e.manifest.replace(/\/pack\.json$/, ''));
  if (!existsSync(join(dir, 'pack.json'))) continue;
  const manifest = read(join(dir, 'pack.json'));
  const lessons = existsSync(join(dir, 'lessons.json')) ? read(join(dir, 'lessons.json')) : { cases: [], tasks: [] };
  const firstFile = manifest.series[0]?.instances[0]?.file;
  const binariesPresent = !firstFile || existsSync(join(dir, firstFile));
  packs.push({ entry: e, manifest, lessons, binariesPresent });
}
const series = new Map(packs.flatMap((p) => p.manifest.series.map((s) => [s.uid, s])));
const studies = new Map(packs.flatMap((p) => p.manifest.studies.map((s) => [s.uid, s])));
const targets = new Map(packs.flatMap((p) => p.manifest.referenceTargets.map((t) => [t.id, t])));
const cases = packs.flatMap((p) => p.lessons.cases.map((c) => ({ ...c, binaries: p.binariesPresent })));
const caseIds = new Set(cases.map((c) => c.id));
const tasks = packs.flatMap((p) => p.lessons.tasks).filter((t) => caseIds.has(t.caseId));
const usableCases = cases.filter((c) => c.binaries);
const patients = new Set(usableCases.map((c) => c.subjectKey));
const curriculum = read(join(ROOT, 'public', 'content', 'curriculum.v1.json'));
const pageMap = read(join(ROOT, 'public', 'content', 'book', 'page-map.v1.json'));

const effective = (t) => {
  if (t.grading.kind === 'self_review' || t.scoring !== 'authoritative') return 'self-review (checklist)';
  if (t.grading.kind === 'choice') return 'auto-checked choice';
  const provs = t.targets.map((x) => targets.get(x.targetId)?.provenance);
  if (provs.length && provs.every((p) => p === 'source_manual')) return 'spatial · source manual reference';
  return 'spatial · AI outline / dataset auto-label reference (self-review until user review)';
};
const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const fmtMB = (b) => `${(b / 1048576).toFixed(1)} MB`;
const now = new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------- inventory
let md = `# Content inventory\n\n_Generated ${now} by \`scripts/report/content-report.mjs\` from the installed files. Counts are distinct real patients/studies/series — not slices, not repeated questions, not planned sources._\n\n`;
md += `## Totals\n\n| | count |\n|---|---|\n`;
md += `| Distinct patients with usable cases | **${patients.size}** |\n| Teaching cases | ${usableCases.length} |\n| Image-based tasks | **${tasks.length}** |\n`;
md += `| Studies | ${new Set(usableCases.flatMap((c) => c.studyUids)).size} |\n| Series (all packs) | ${series.size} |\n| DICOM instances | ${[...series.values()].reduce((a, s) => a + s.instances.length, 0)} |\n| Reference targets | ${targets.size} |\n\n`;
md += `### Tasks by scoring basis\n\n| basis | tasks |\n|---|---|\n` + Object.entries(count(tasks, effective)).sort().map(([k, v]) => `| ${k} | ${v} |`).join('\n') + '\n\n';
md += `### Tasks by type\n\n| type | tasks |\n|---|---|\n` + Object.entries(count(tasks, (t) => t.type)).sort().map(([k, v]) => `| ${k.replace(/_/g, ' ')} | ${v} |`).join('\n') + '\n\n';
md += `### Reference targets by provenance\n\n| provenance | targets |\n|---|---|\n` + Object.entries(count([...targets.values()], (t) => t.provenance)).sort().map(([k, v]) => `| ${k} | ${v} |`).join('\n') + '\n\n';
md += `## Packs\n\n| pack | distribution | binaries here | subjects | series | instances | bytes (index) | cases | tasks |\n|---|---|---|---|---|---|---|---|---|\n`;
for (const p of packs) md += `| ${p.entry.id} | ${p.entry.distribution} | ${p.binariesPresent ? 'yes' : 'no'} | ${p.manifest.subjects.length} | ${p.manifest.series.length} | ${p.manifest.series.reduce((a, s) => a + s.instances.length, 0)} | ${fmtMB(p.entry.bytes)} | ${p.lessons.cases.length} | ${p.lessons.tasks.length} |\n`;
md += `\n## Patients and cases\n\n| case | neutral title | subject (source namespace) | modalities | tasks |\n|---|---|---|---|---|\n`;
for (const c of usableCases) {
  const mods = [...new Set(c.studyUids.flatMap((st) => studies.get(st)?.modalities ?? []))].join('+');
  md += `| \`${c.id}\` | ${c.neutralTitle} | \`${c.subjectKey}\` | ${mods} | ${tasks.filter((t) => t.caseId === c.id).length} |\n`;
}
md += `\n## Same-patient multimodality comparisons\n\nOnly series from one source subject are combined; links are \`independent\` unless the files share a frame of reference. No registration is claimed.\n\n| subject | studies (modality, relative day) | relationship |\n|---|---|---|\n`;
for (const c of usableCases) {
  const sts = c.studyUids.map((u) => studies.get(u)).filter(Boolean);
  const mods = new Set(sts.flatMap((s) => s.modalities));
  if (sts.length < 2) continue;
  const ctDiagnostic = sts.some((st) => st.seriesUids.some((u) => series.get(u)?.modality === 'CT' && series.get(u)?.role !== 'scout'));
  const kind = mods.has('MR') && mods.has('CT') ? 'CT ↔ MRI' : (mods.has('CR') || mods.has('DX')) && mods.has('CT') ? (ctDiagnostic ? 'Radiograph ↔ diagnostic CT' : 'Radiograph ↔ CT scout only (no diagnostic CT in pack)') : [...mods].join(' ↔ ');
  md += `| \`${c.subjectKey}\` | ${sts.map((s) => `${s.modalities.join('+')} (day ${s.relativeDays ?? '?'})`).join('; ')} | ${kind} |\n`;
}
const ts = count([...series.values()].flatMap((s) => s.encoding.transferSyntaxes), (x) => x);
md += `\n## Transfer syntaxes present\n\n` + Object.entries(ts).map(([k, v]) => `- \`${k}\`: ${v} series`).join('\n') + '\n';
md += `\nMONOCHROME1 series: ${[...series.values()].filter((s) => s.geometry.photometric === 'MONOCHROME1').length}. Volume (MPR) eligible series: ${[...series.values()].filter((s) => s.geometry.volumeEligible).length}. Scouts/localizers: ${[...series.values()].filter((s) => s.role === 'scout').length}.\n`;
writeFileSync(join(ROOT, 'docs', 'CONTENT_INVENTORY.md'), md);

// ------------------------------------------------------------- coverage
const pageLabel = new Map(pageMap.pages.map((p) => [p.physical, p.printed]));
let cv = `# Curriculum coverage — Learning Radiology, 5th edition\n\n_Generated ${now} from \`public/content/curriculum.v1.json\` and the installed lessons. A unit is never "mastered" from text or quizzes; this map shows where real-scan practice exists and where it does not._\n\n`;
cv += `Book: ${pageMap.document.title}, ${pageMap.document.edition} edition, ${pageMap.document.physicalPageCount} PDF pages, SHA-256 \`${pageMap.document.sha256.slice(0, 16)}…\`.\n\n`;
cv += `| unit | title | printed pp. (PDF) | objectives | with real-scan tasks | patients | source-scored tasks | uncovered: open data / credentialed / book-only |\n|---|---|---|---|---|---|---|---|\n`;
let totObj = 0;
let totCovered = 0;
for (const u of curriculum.units) {
  const ids = new Set(u.objectives.map((o) => o.id));
  const ts2 = tasks.filter((t) => t.objectiveIds.some((o) => ids.has(o)));
  const covered = new Set(ts2.flatMap((t) => t.objectiveIds).filter((o) => ids.has(o)));
  const pts = new Set(ts2.map((t) => cases.find((c) => c.id === t.caseId)?.subjectKey));
  const scored = ts2.filter((t) => effective(t) === 'spatial · source manual reference').length;
  const unc = u.objectives.filter((o) => !covered.has(o.id));
  const f = count(unc, (o) => o.scanNeed?.feasibility ?? 'unknown');
  totObj += u.objectives.length;
  totCovered += covered.size;
  cv += `| ${u.kind === 'chapter' ? `Ch ${u.number}` : `App ${u.number}`} | ${u.title} | ${u.printedRange.join('–')} (${u.physicalRange.join('–')}) | ${u.objectives.length} | ${covered.size} | ${pts.size} | ${scored} | ${f.open_tcia ?? 0} / ${f.credentialed ?? 0} / ${(f.book_only ?? 0) + (f.not_dicom ?? 0)} |\n`;
}
cv += `\n**Totals:** ${totObj} objectives; ${totCovered} have at least one real-scan task (${((100 * totCovered) / totObj).toFixed(0)}%).\n\n`;
cv += `## Objectives with real-scan practice\n\n`;
for (const u of curriculum.units) {
  const rows = u.objectives
    .map((o) => ({ o, ts: tasks.filter((t) => t.objectiveIds.includes(o.id)) }))
    .filter((x) => x.ts.length);
  if (!rows.length) continue;
  cv += `### ${u.kind === 'chapter' ? 'Chapter' : 'Appendix'} ${u.number} — ${u.title}\n\n`;
  for (const { o, ts: t2 } of rows) {
    const a = o.anchors[0];
    cv += `- **${o.id}** (${a ? `p. ${pageLabel.get(a.physical) ?? '?'} / PDF ${a.physical}${a.figureId ? `, ${a.figureId}` : ''}` : 'no anchor'}): ${o.see} — ${t2.length} task(s) on ${new Set(t2.map((t) => cases.find((c) => c.id === t.caseId)?.subjectKey)).size} patient(s)\n`;
  }
  cv += '\n';
}
cv += `## Known gaps\n\nObjectives without installed real-scan tasks remain in the Course view with their book anchors. Their \`scanNeed.feasibility\` says whether open TCIA data could fill them (\`open_tcia\`), whether credentialed datasets are needed (\`credentialed\`: e.g. RSNA intracranial haemorrhage, VinDr-CXR, PediCXR, RSNA lumbar spine), or whether they are book-only for this app (ultrasound, fluoroscopy, nuclear medicine, history).\n`;
writeFileSync(join(ROOT, 'docs', 'COVERAGE.md'), cv);
console.log(`patients=${patients.size} cases=${usableCases.length} tasks=${tasks.length} objectives covered=${totCovered}/${totObj}`);
console.log(count(tasks, effective));
