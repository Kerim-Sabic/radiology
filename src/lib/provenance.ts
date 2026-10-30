/** How the app names the origin of a reference label. One place, so every screen says the same thing. */
export const AI_LABEL = 'AI';

/** Who to thank for the AI outlines, with a link, in the sources and credits. */
export const AI_CREDIT = { name: 'Horalix.com', url: 'https://horalix.com', text: 'Thanks to Horalix.com, every structure in the anatomy layer is marked.' };

/** AI outlines: automatic segmentation that no radiologist has reviewed. */
export const isAiDraft = (p: string) => p === 'ai_draft';

/** Machine-made labels: AI outlines and automated labels shipped with a source dataset. */
export const isAutomatic = (p: string) => p === 'ai_draft' || p === 'source_automated';

/** Short tag for lists and tooltips. */
export function provenanceTag(p: string): string {
  if (p === 'ai_draft') return AI_LABEL;
  if (p === 'source_automated') return 'dataset auto-label';
  if (p === 'human_reviewed') return 'reviewed by you';
  return 'expert';
}

/** Where a label came from and how it was made, in words a learner can read. */
export function provenanceMethod(ref: { provenance: string; provenanceDetail: { source: string; method: string } }): string {
  if (ref.provenance === 'ai_draft') return `${AI_LABEL} — automatic outline, not reviewed by a radiologist`;
  return `${ref.provenanceDetail.source} — ${ref.provenanceDetail.method}`;
}

/** Display name without provenance suffixes (provenance is shown separately). */
export const cleanLabel = (label: string) =>
  label.replace(/\s*\((?:AI|AI draft|AI-derived draft|AI, unreviewed|[^()]*\bSEG|[^()]*\bcontour)\)\s*$/i, '').trim();

/** Name for questions and lists: no provenance suffix and no "(partially imaged)" note. */
export const plainName = (label: string) => cleanLabel(label).replace(/\s*\(partially imaged\)$/i, '').trim();
