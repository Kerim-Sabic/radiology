/**
 * Structures a Learning Radiology reader is expected to recognise, grouped by the book's chapters.
 * Names and grouping are written for this app; `match` is tested against canonical anatomy keys
 * (see canonicalAnatomyKey) so one checklist item can be satisfied by labels from any data pack.
 */
export interface ChecklistItem {
  name: string;
  match: RegExp;
  /** Which kind of image the item is about; omit for any. */
  on?: 'XR' | 'CT' | 'MR';
}
export interface ChecklistGroup {
  unitId: string;
  title: string;
  items: ChecklistItem[];
}

export const BOOK_ANATOMY: ChecklistGroup[] = [
  {
    unitId: 'ch02',
    title: 'Chest radiograph: normal anatomy',
    items: [
      { name: 'Trachea', match: /^trachea$/, on: 'XR' },
      { name: 'Right and left lungs', match: /^lung_(left|right)$/, on: 'XR' },
      { name: 'Hila', match: /^hilum_/, on: 'XR' },
      { name: 'Heart', match: /^heart$/, on: 'XR' },
      { name: 'Aorta (aortic knob)', match: /^aorta$/, on: 'XR' },
      { name: 'Mediastinum', match: /^mediastinum$/, on: 'XR' },
      { name: 'Diaphragm', match: /^diaphragm$/, on: 'XR' },
      { name: 'Clavicles', match: /^clavicle_/, on: 'XR' },
      { name: 'Scapulae', match: /^scapula_/, on: 'XR' },
      { name: 'Thoracic spine', match: /^spine$/, on: 'XR' },
    ],
  },
  {
    unitId: 'ch02',
    title: 'Chest CT: airways and lungs',
    items: [
      { name: 'Trachea', match: /^trachea$/, on: 'CT' },
      { name: 'Main and lobar bronchi', match: /bronch/, on: 'CT' },
      { name: 'Right and left lungs', match: /^lung_(left|right)$/, on: 'CT' },
      { name: 'Right upper, middle and lower lobes', match: /^lung_(upper|middle|lower)_lobe_right$/, on: 'CT' },
      { name: 'Left upper and lower lobes', match: /^lung_(upper|lower)_lobe_left$/, on: 'CT' },
    ],
  },
  {
    unitId: 'ch03',
    title: 'Heart and great vessels on CT',
    items: [
      { name: 'Heart', match: /^heart$/, on: 'CT' },
      { name: 'Ascending aorta', match: /^aorta_ascending$/, on: 'CT' },
      { name: 'Aortic arch', match: /^aorta_arch$/, on: 'CT' },
      { name: 'Descending thoracic aorta', match: /^aorta_descending_thoracic$/, on: 'CT' },
      { name: 'Aorta (whole)', match: /^aorta$/, on: 'CT' },
      { name: 'Pulmonary trunk (main pulmonary artery)', match: /^pulmonary_trunk$/, on: 'CT' },
      { name: 'Right and left pulmonary arteries', match: /^pulmonary_artery_(left|right)$/, on: 'CT' },
      { name: 'Lobar and segmental pulmonary arteries', match: /^pulmonary_arteries_/, on: 'CT' },
      { name: 'Right atrium', match: /^heart_atrium_right$/, on: 'CT' },
      { name: 'Right ventricle', match: /^heart_ventricle_right$/, on: 'CT' },
      { name: 'Left atrium', match: /^heart_atrium_left$/, on: 'CT' },
      { name: 'Left ventricle', match: /^heart_ventricle_left$/, on: 'CT' },
      { name: 'Pulmonary veins', match: /^pulmonary_vein/, on: 'CT' },
      { name: 'Left atrial appendage', match: /^atrial_appendage_left$/, on: 'CT' },
      { name: 'Superior vena cava', match: /^superior_vena_cava$/, on: 'CT' },
      { name: 'Brachiocephalic veins', match: /^brachiocephalic_vein_/, on: 'CT' },
      { name: 'Brachiocephalic trunk (innominate artery)', match: /^brachiocephalic_trunk$/, on: 'CT' },
      { name: 'Common carotid arteries', match: /^common_carotid_artery_/, on: 'CT' },
      { name: 'Subclavian arteries', match: /^subclavian_artery_/, on: 'CT' },
      { name: 'Esophagus', match: /^esophagus$/, on: 'CT' },
      { name: 'Thymus (child)', match: /^thymus$/, on: 'CT' },
      { name: 'Thyroid gland', match: /^thyroid/, on: 'CT' },
      { name: 'Spinal cord / canal', match: /^spinal_(cord|canal)$/, on: 'CT' },
    ],
  },
  {
    unitId: 'ch13',
    title: 'Abdomen and pelvis on CT',
    items: [
      { name: 'Liver', match: /^liver$/, on: 'CT' },
      { name: 'Spleen', match: /^spleen$/, on: 'CT' },
      { name: 'Pancreas', match: /^pancreas$/, on: 'CT' },
      { name: 'Gallbladder', match: /^gallbladder$/, on: 'CT' },
      { name: 'Kidneys', match: /^kidney/, on: 'CT' },
      { name: 'Adrenal glands', match: /^adrenal_/, on: 'CT' },
      { name: 'Stomach', match: /^stomach$/, on: 'CT' },
      { name: 'Duodenum', match: /^duodenum$/, on: 'CT' },
      { name: 'Small bowel', match: /^small_bowel$/, on: 'CT' },
      { name: 'Colon (whole)', match: /^colon$/, on: 'CT' },
      { name: 'Cecum and ascending colon', match: /^colon_ascending$/, on: 'CT' },
      { name: 'Transverse colon', match: /^colon_transverse$/, on: 'CT' },
      { name: 'Descending colon', match: /^colon_descending$/, on: 'CT' },
      { name: 'Sigmoid colon', match: /^colon_sigmoid$/, on: 'CT' },
      { name: 'Rectum', match: /^rectum$/, on: 'CT' },
      { name: 'Urinary bladder', match: /^bladder$/, on: 'CT' },
      { name: 'Prostate', match: /^prostate$/, on: 'CT' },
      { name: 'Uterus and cervix', match: /^uterus/, on: 'CT' },
      { name: 'Abdominal aorta', match: /^aorta_abdominal$/, on: 'CT' },
      { name: 'Inferior vena cava', match: /^inferior_vena_cava$/, on: 'CT' },
      { name: 'Portal and splenic veins', match: /^portal_vein/, on: 'CT' },
      { name: 'Iliac arteries', match: /^iliac_artery_/, on: 'CT' },
      { name: 'Iliac veins', match: /^iliac_ve(na|in)_/, on: 'CT' },
      { name: 'Psoas (iliopsoas) muscles', match: /^(ilio)?psoas/, on: 'CT' },
    ],
  },
  {
    unitId: 'ch22',
    title: 'Spine and skeleton',
    items: [
      { name: 'Cervical vertebrae', match: /^c\d_vertebra$/, on: 'CT' },
      { name: 'Thoracic vertebrae (T1–T12)', match: /^t\d+_vertebra$/, on: 'CT' },
      { name: 'Lumbar vertebrae (L1–L5)', match: /^l\d_vertebra$/, on: 'CT' },
      { name: 'Sacrum', match: /^sacrum$/, on: 'CT' },
      { name: 'Ribs, numbered', match: /^rib_(left|right)_\d+$/, on: 'CT' },
      { name: 'Costal cartilages', match: /^costal_cartilages$/, on: 'CT' },
      { name: 'Sternum', match: /^sternum$/, on: 'CT' },
      { name: 'Clavicles', match: /^clavicle_/, on: 'CT' },
      { name: 'Scapulae', match: /^scapula_/, on: 'CT' },
      { name: 'Humeri', match: /^humerus_/, on: 'CT' },
      { name: 'Hip bones', match: /^hip_/, on: 'CT' },
      { name: 'Femurs / femoral heads', match: /^(femur_|femoral_head_)/, on: 'CT' },
    ],
  },
  {
    unitId: 'ch20',
    title: 'MRI anatomy',
    items: [
      { name: 'Prostate zones', match: /^prostate_(peripheral|transition)_zone$/, on: 'MR' },
      { name: 'Brain (cerebrum)', match: /^cerebrum$/, on: 'MR' },
      { name: 'Ventricles', match: /ventricles?$/, on: 'MR' },
    ],
  },
];

/** One key per structure across data packs, e.g. "adrenal_gland_left" and "adrenal_left" both become "adrenal_left". */
export function canonicalAnatomyKey(classId: string): string {
  let k = classId.replace(/^anatomy:/, '').toLowerCase();
  k = k.replace(/^adrenal_gland_/, 'adrenal_');
  k = k.replace(/^urinary_bladder$/, 'bladder');
  k = k.replace(/^large_intestine$/, 'colon');
  k = k.replace(/^small_intestine$/, 'small_bowel');
  k = k.replace(/^clavicula_/, 'clavicle_');
  k = k.replace(/^uterus_cervix$/, 'uterus_and_cervix');
  const v = /^vertebrae_([cstl])(\d+)$/.exec(k);
  if (v) k = v[1] === 's' ? 'sacrum' : `${v[1]}${v[2]}_vertebra`;
  return k;
}

/** Imaging family of a DICOM modality, as the checklist uses it. */
export function imageFamily(modality: string): 'XR' | 'CT' | 'MR' | 'other' {
  if (modality === 'CR' || modality === 'DX' || modality === 'MG') return 'XR';
  if (modality === 'CT') return 'CT';
  if (modality === 'MR') return 'MR';
  return 'other';
}
