import { describe, expect, it } from 'vitest';
import { classifySequence } from '../src/content/mriSequences';

const id = (description: string, acq: Record<string, string | number | null> = {}) => classifySequence(description, acq)?.id ?? null;

describe('MRI sequence guide', () => {
  it('recognises the installed series by name', () => {
    expect(id('t2_tse_tra')).toBe('T2');
    expect(id('Axial FSE/T1 - RESEARCH')).toBe('T1');
    expect(id('Axial FSE/T2 Fatsat - RESEARCH')).toBe('T2');
    expect(id('2D_AX_T2_FLAIR')).toBe('FLAIR');
    expect(id('2D_AX_T2_BLADE')).toBe('T2');
    expect(id('3D_AX_T1_postcontrast')).toBe('T1C');
    expect(id('DWI trace, b=1000 (ISLES 2022, converted from NIfTI)')).toBe('DWI');
    expect(id('ADC map, 10^-6 mm2/s (ISLES 2022, converted from NIfTI)')).toBe('ADC');
    expect(id('t1_mpr_tra_gk_v4', { SequenceName: '*tfl3d1' })).toBe('T1');
    expect(id('t2_ci3d_tra_1.5mm_v1', { ContrastBolusAgent: 'DOTAREM' })).toBe('T2');
  });

  it('marks T1 as post-contrast only when the series says so', () => {
    expect(id('AX T1', { ContrastBolusAgent: 'GADAVIST' })).toBe('T1C');
    expect(id('T1 SE post gad')).toBe('T1C');
    expect(id('AX T1 - RESEARCH')).toBe('T1');
  });

  it('falls back on unambiguous TR/TE/TI and otherwise says nothing', () => {
    expect(id('series 4', { RepetitionTime: 500, EchoTime: 12 })).toBe('T1');
    expect(id('series 5', { RepetitionTime: 4000, EchoTime: 100 })).toBe('T2');
    expect(id('series 6', { RepetitionTime: 3000, EchoTime: 20 })).toBe('PD');
    expect(id('series 7', { RepetitionTime: 9000, EchoTime: 90, InversionTime: 2500 })).toBe('FLAIR');
    expect(id('series 8', { RepetitionTime: 4000, EchoTime: 40, InversionTime: 160 })).toBe('STIR');
    expect(id('AX IR - RESEARCH')).toBeNull(); // inversion recovery of unknown kind: not guessed
    expect(id('localizer', { RepetitionTime: 1200, EchoTime: 40 })).toBeNull();
  });

  it('teaches the book rule: T1 fluid dark, T2 fluid bright, DWI restriction bright and ADC dark', () => {
    expect(classifySequence('T1', {})!.dark).toMatch(/CSF/);
    expect(classifySequence('T2', {})!.bright).toMatch(/CSF/);
    expect(classifySequence('DWI', {})!.bright).toMatch(/infarct/);
    expect(classifySequence('ADC map', {})!.dark).toMatch(/infarct/);
    expect(classifySequence('FLAIR', {})!.dark).toMatch(/CSF/);
  });
});
