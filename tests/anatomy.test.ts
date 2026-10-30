import { describe, expect, it } from 'vitest';
import { BOOK_ANATOMY, canonicalAnatomyKey, imageFamily } from '../src/content/bookAnatomy';
import { AI_CREDIT, AI_LABEL, cleanLabel, provenanceMethod, provenanceTag } from '../src/lib/provenance';
import { categoryFor } from '../src/components/ws/overlayShapes';

describe('provenance wording', () => {
  it('names every AI outline just "AI", credits Horalix.com in the sources, and never shows the dataset labels', () => {
    expect(AI_LABEL).toBe('AI');
    expect(provenanceTag('ai_draft')).toBe('AI');
    expect(AI_CREDIT.url).toBe('https://horalix.com');
    expect(provenanceTag('source_manual')).toBe('expert');
    expect(provenanceTag('source_automated')).toBe('dataset auto-label');
    const detail = { source: 'any tool', method: 'internal method text' };
    expect(provenanceMethod({ provenance: 'ai_draft', provenanceDetail: detail })).toBe('AI — automatic outline, not reviewed by a radiologist');
    expect(provenanceMethod({ provenance: 'source_manual', provenanceDetail: detail })).toBe('any tool — internal method text');
  });

  it('strips provenance suffixes from display names only', () => {
    expect(cleanLabel('Heart (AI)')).toBe('Heart');
    expect(cleanLabel('Diaphragm (domes) (AI)')).toBe('Diaphragm (domes)');
    expect(cleanLabel('Five-vessel level (AI-derived draft)')).toBe('Five-vessel level');
    expect(cleanLabel('Kidneys (KiTS SEG)')).toBe('Kidneys');
    expect(cleanLabel('Liver (expert contour)')).toBe('Liver');
    expect(cleanLabel('Heart (RT contour)')).toBe('Heart');
    expect(cleanLabel('Rib 5 left')).toBe('Rib 5 left');
  });
});

describe('anatomy keys and groups', () => {
  it('merges the same structure from different data packs', () => {
    expect(canonicalAnatomyKey('anatomy:adrenal_gland_left')).toBe(canonicalAnatomyKey('anatomy:adrenal_left'));
    expect(canonicalAnatomyKey('anatomy:urinary_bladder')).toBe('bladder');
    expect(canonicalAnatomyKey('anatomy:large_intestine')).toBe('colon');
    expect(canonicalAnatomyKey('anatomy:small_intestine')).toBe('small_bowel');
    expect(canonicalAnatomyKey('anatomy:clavicula_left')).toBe('clavicle_left');
    expect(canonicalAnatomyKey('anatomy:vertebrae_L1')).toBe(canonicalAnatomyKey('anatomy:l1_vertebra'));
    expect(canonicalAnatomyKey('anatomy:vertebrae_T12')).toBe('t12_vertebra');
    expect(canonicalAnatomyKey('anatomy:vertebrae_S1')).toBe('sacrum');
  });

  it('groups lungs with airways and the heart with vessels, otherwise trusts the pack', () => {
    expect(categoryFor({ classId: 'anatomy:lung_upper_lobe_left', category: 'organ' })).toBe('airway');
    expect(categoryFor({ classId: 'anatomy:heart', category: 'organ' })).toBe('vessel');
    expect(categoryFor({ classId: 'anatomy:atrial_appendage_left', category: 'organ' })).toBe('vessel');
    expect(categoryFor({ classId: 'anatomy:liver', category: 'organ' })).toBe('organ');
    expect(categoryFor({ classId: 'anatomy:rib_left_5' })).toBe('bone');
    expect(categoryFor({ classId: 'anatomy:heart_ventricle_left', category: 'organ' })).toBe('vessel');
    expect(categoryFor({ classId: 'anatomy:brain_ventricles', category: 'organ' })).toBe('organ');
  });

  it('book checklist patterns match the keys the packs produce', () => {
    const find = (name: string) => BOOK_ANATOMY.flatMap((g) => g.items).find((i) => i.name === name)!;
    expect(find('Ascending aorta').match.test('aorta_ascending')).toBe(true);
    expect(find('Aorta (whole)').match.test('aorta_ascending')).toBe(false);
    expect(find('Lumbar vertebrae (L1–L5)').match.test(canonicalAnatomyKey('anatomy:vertebrae_L3'))).toBe(true);
    expect(find('Adrenal glands').match.test(canonicalAnatomyKey('anatomy:adrenal_gland_right'))).toBe(true);
    expect(find('Ribs, numbered').match.test('rib_right_12')).toBe(true);
    expect(imageFamily('DX')).toBe('XR');
    expect(imageFamily('CR')).toBe('XR');
  });
});
