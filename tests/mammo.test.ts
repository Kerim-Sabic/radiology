import { describe, expect, it } from 'vitest';
import { hangMammograms, mammoView } from '../src/content/mammo';

describe('mammography hanging', () => {
  it('reads side and view from the DICOM tags first, then from an unambiguous description', () => {
    expect(mammoView('full mammogram images', { Laterality: 'L', PatientOrientation: 'CC' })).toEqual({ side: 'L', view: 'CC' });
    expect(mammoView('anything', { ImageLaterality: 'R', ViewPosition: 'MLO' })).toEqual({ side: 'R', view: 'MLO' });
    expect(mammoView('Calc-Training_P_00005_RIGHT_MLO', {})).toEqual({ side: 'R', view: 'MLO' });
    expect(mammoView('LEFT CC', {})).toEqual({ side: 'L', view: 'CC' });
    expect(mammoView('bilateral R and L CC', {})).toEqual({ side: null, view: 'CC' }); // both sides named: not guessed
    expect(mammoView('screening', {})).toEqual({ side: null, view: null });
  });

  it('hangs CC above MLO, right breast on the left, chest walls back to back', () => {
    const s = (uid: string, side: 'R' | 'L', view: 'CC' | 'MLO') => ({ uid, view: { side, view } });
    const hung = hangMammograms([s('lmlo', 'L', 'MLO'), s('rcc', 'R', 'CC'), s('rmlo', 'R', 'MLO'), s('lcc', 'L', 'CC')]);
    expect(hung.map((h) => h.uid)).toEqual(['rcc', 'lcc', 'rmlo', 'lmlo']);
    expect(hung.map((h) => h.chestWall)).toEqual(['right', 'left', 'right', 'left']);
  });
});
