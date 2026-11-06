/** The 3D rendering a series opens with: bone for CT, the pulmonary-artery ramp for CT angiograms, the angiography ramp
 *  for MR angiograms, the default otherwise. */
export function default3DPreset(modality: string, angiography: boolean | undefined): string {
  if (modality === 'CT') return angiography ? 'CT-Pulmonary-Arteries' : 'CT-Bone';
  return angiography ? 'MR-Angio' : 'MR-Default';
}

/** The MIP slab the MPR views of an angiogram open with (vessels followed over several millimetres), in mm. */
export function defaultAngioSlabMm(modality: string): number {
  return modality === 'MR' ? 20 : 10;
}
