import { describe, expect, it } from 'vitest';
import { default3DPreset } from '../src/viewer/presets3d';

describe('3D rendering a series opens with', () => {
  it('shows bone for CT, the angiography ramp for MR angiograms and the default for other MR', () => {
    expect(default3DPreset('CT', false)).toBe('CT-Bone');
    expect(default3DPreset('CT', true)).toBe('CT-Pulmonary-Arteries');
    expect(default3DPreset('MR', true)).toBe('MR-Angio');
    expect(default3DPreset('MR', false)).toBe('MR-Default');
    expect(default3DPreset('MR', undefined)).toBe('MR-Default');
  });
});
