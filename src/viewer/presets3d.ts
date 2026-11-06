/** The 3D rendering a series opens with: bone for CT, the angiography ramp for MR angiograms, the default otherwise. */
export function default3DPreset(modality: string, angiography: boolean | undefined): string {
  if (modality === 'CT') return 'CT-Bone';
  return angiography ? 'MR-Angio' : 'MR-Default';
}
