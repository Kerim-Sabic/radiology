/**
 * Mammography hanging (book ch. 29): right breast on the viewer's left, left breast on the right, CC above MLO,
 * hung "back to back" so the chest walls meet in the middle. Side and view come from the DICOM tags when present
 * (ImageLaterality / Laterality, ViewPosition), otherwise from an unambiguous series description.
 */
type Acq = Record<string, string | number | string[] | null | undefined>;

export interface MammoView {
  side: 'R' | 'L' | null;
  view: 'CC' | 'MLO' | 'ML' | 'LM' | 'XCCL' | null;
}

export function mammoView(description: string, acq: Acq): MammoView {
  const tag = (k: string) => String(acq[k] ?? '').trim().toUpperCase();
  const d = ` ${description.toUpperCase().replace(/[^A-Z]+/g, ' ')} `;
  let side: MammoView['side'] = null;
  const lat = tag('ImageLaterality') || tag('Laterality');
  if (lat === 'R' || lat === 'L') side = lat;
  else if (/ (RIGHT|R) /.test(d) && !/ (LEFT|L) /.test(d)) side = 'R';
  else if (/ (LEFT|L) /.test(d) && !/ (RIGHT|R) /.test(d)) side = 'L';
  let view: MammoView['view'] = null;
  const vp = tag('ViewPosition') || (/^(CC|MLO|ML|LM|XCCL)$/.test(tag('PatientOrientation')) ? tag('PatientOrientation') : '');
  if (vp === 'CC' || vp === 'MLO' || vp === 'ML' || vp === 'LM' || vp === 'XCCL') view = vp;
  else if (/ MLO /.test(d)) view = 'MLO';
  else if (/ XCCL /.test(d)) view = 'XCCL';
  else if (/ CC /.test(d)) view = 'CC';
  return { side, view };
}

const VIEW_ORDER: Record<string, number> = { CC: 0, XCCL: 1, MLO: 2, ML: 3, LM: 4 };

/**
 * Hanging order for a set of mammogram series: CC row first, then MLO; right before left in each row.
 * Returns the series uids in panel order and, per uid, which side of its panel the chest wall should face.
 */
export function hangMammograms<T extends { uid: string; view: MammoView }>(series: T[]): Array<{ uid: string; chestWall: 'left' | 'right' | null }> {
  const sorted = [...series].sort(
    (a, b) => (VIEW_ORDER[a.view.view ?? ''] ?? 9) - (VIEW_ORDER[b.view.view ?? ''] ?? 9) || (a.view.side === 'R' ? 0 : a.view.side === 'L' ? 1 : 2) - (b.view.side === 'R' ? 0 : b.view.side === 'L' ? 1 : 2),
  );
  // Back to back: the right breast's chest wall is on its right edge, the left breast's on its left edge.
  return sorted.map((s) => ({ uid: s.uid, chestWall: s.view.side === 'R' ? 'right' : s.view.side === 'L' ? 'left' : null }));
}
