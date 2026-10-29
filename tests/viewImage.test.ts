import { describe, expect, it } from 'vitest';
import { fitText, shortLicense, slug } from '../src/lib/viewImage';

describe('saved view images', () => {
  it('credits the source with a short licence name', () => {
    expect(shortLicense('Creative Commons Attribution 4.0 International License')).toBe('CC BY 4.0');
    expect(shortLicense('Creative Commons Attribution 3.0 Unported License')).toBe('CC BY 3.0');
    expect(shortLicense('Creative Commons Attribution-NonCommercial 4.0 International License')).toBe('CC BY-NC 4.0');
    expect(shortLicense('Creative Commons Attribution-ShareAlike 4.0 International')).toBe('CC BY-SA 4.0');
    expect(shortLicense('CC BY 4.0')).toBe('CC BY 4.0');
    expect(shortLicense('Unrestricted use; link to the original download site, acknowledge the NIH Clinical Center')).toBe('Unrestricted use');
  });

  it('names the file from the case and series, and fits the footer to the image', () => {
    expect(slug('Patient A · CT chest')).toBe('patient-a-ct-chest');
    expect(slug('CT:P2B1 rcct 3.0 B30f 50% Ex')).toBe('ct-p2b1-rcct-3-0-b30f-50-ex');
    expect(slug('···')).toBe('view');
    const measure = (s: string) => s.length * 7;
    expect(fitText('short', 100, measure)).toBe('short');
    const cut = fitText('a rather long footer line that will not fit', 140, measure);
    expect(cut.endsWith('…')).toBe(true);
    expect(measure(cut)).toBeLessThanOrEqual(140);
  });
});
