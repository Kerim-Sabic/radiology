/**
 * Systematic search patterns ("coach"): the order an experienced reader checks a study so nothing
 * is skipped. Each step says what to look at and, where labels exist, which structures to show.
 * `show` is matched against canonical anatomy keys (see canonicalAnatomyKey).
 */
import type { WindowName } from './structureNotes';

export interface CoachStep {
  id: string;
  title: string;
  look: string[];
  show?: RegExp;
  window?: WindowName;
  /**
   * Where to go for this step (first alternative whose anchor is labelled wins). Default: the slice
   * where most of the shown structures appear. With `anchor`: the anchor structure's largest slice, just above its top, just below its
   * bottom, or a fraction of its head-to-foot extent (0 = top, 1 = bottom).
   */
  level?: Array<{ anchor: RegExp; at: 'largest' | 'above' | 'below' | number }>;
  /** Book page (PDF page number) that teaches this step. */
  page?: number;
}

export interface SearchPattern {
  id: string;
  title: string;
  family: 'XR' | 'CT' | 'MR';
  /** Structures whose presence suggests this pattern fits the scan. */
  hint: RegExp;
  unit: string;
  steps: CoachStep[];
}

export const SEARCH_PATTERNS: SearchPattern[] = [
  {
    id: 'cxr',
    title: 'Chest X-ray (frontal)',
    family: 'XR',
    hint: /lung|heart|trachea|clavic|rib/,
    unit: 'ch02',
    steps: [
      {
        id: 'quality',
        title: 'Is the film good enough?',
        look: [
          'Rotation: medial clavicle ends equidistant from the spinous processes.',
          'Inspiration: about 10 posterior ribs above the right diaphragm.',
          'Projection: PA or AP? AP magnifies the heart and mediastinum.',
          'Exposure: vertebrae just visible through the heart.',
        ],
        show: /^clavicle_|^spine$|^rib_/,
      },
      { id: 'airway', title: 'Airway and mediastinum', look: ['Trachea midline.', 'Mediastinal width and contour, aortic knob.', 'Both hila: size, density, left slightly higher.'], show: /^trachea$|^mediastinum$|^hilum_|^aorta$/ },
      { id: 'heart', title: 'Heart', look: ['Size: under half the chest width on a PA film.', 'Both borders sharp (a blurred border points to the lobe beside it).'], show: /^heart$/ },
      { id: 'lungs', title: 'Lungs, zone by zone', look: ['Compare left and right in the upper, middle and lower zones.', 'Look for consolidation, nodules, masses, lines and lucency.'], show: /^lung_/ },
      { id: 'pleura', title: 'Pleura and diaphragm', look: ['Costophrenic angles sharp?', 'Pleural line at the edge of the lung (pneumothorax).', 'Diaphragm outlines; free gas under them.'], show: /^lung_/ },
      { id: 'bones', title: 'Bones and soft tissues', look: ['Ribs front and back, clavicles, shoulders, spine.', 'Soft tissues: breast shadows, surgical emphysema.'], show: /^rib_|^clavicle_|^scapula_|^humerus_|^spine$/ },
      {
        id: 'review',
        title: 'Review areas (where things hide)',
        look: ['Lung apices.', 'Behind the heart.', 'Below the diaphragm domes.', 'Hila.', 'Lines and tubes, if any.'],
        show: /^heart$|^hilum_/,
      },
    ],
  },
  {
    id: 'chest_ct',
    title: 'Chest CT',
    family: 'CT',
    hint: /lung|trachea|heart|aorta_(arch|ascending)|esophagus/,
    unit: 'ch02',
    steps: [
      { id: 'technique', title: 'Technique', look: ['With or without contrast? Which phase (pulmonary arterial, systemic)?', 'Slice thickness; reconstructions available.'] },
      { id: 'airways', title: 'Airways', window: 'Lung', look: ['Trachea and main bronchi: patent, no wall thickening or mass.', 'Follow lobar bronchi into each lobe.'], show: /^trachea$|^main_bronchus|^bronch/ },
      {
        id: 'lungs',
        title: 'Lungs, lobe by lobe',
        window: 'Lung',
        look: ['Scroll each lung top to bottom, then the other.', 'Nodules, consolidation, ground glass, emphysema, fibrosis.', 'Fissures: where one lobe ends and the next begins.'],
        show: /^lung_/,
      },
      { id: 'heart', title: 'Heart and pericardium', window: 'Soft tissue', look: ['Chamber size, wall, calcification.', 'Pericardial fluid or thickening.'], show: /^heart|^atrial_appendage/ },
      {
        id: 'vessels',
        title: 'Great vessels',
        window: 'Soft tissue',
        look: ['Aorta: ascending, arch, descending — calibre, wall, dissection flap.', 'Pulmonary arteries: emboli, trunk size.', 'SVC and brachiocephalic veins.'],
        show: /^aorta|^pulmonary|^superior_vena_cava$|^brachiocephalic|^common_carotid|^subclavian/,
      },
      {
        id: 'mediastinum',
        title: 'Mediastinum and neck base',
        window: 'Soft tissue',
        look: ['Thyroid, thymus, esophagus.', 'Lymph nodes: paratracheal, subcarinal, hilar, axillary.'],
        show: /^thyroid|^thymus$|^esophagus$/,
      },
      { id: 'pleura', title: 'Pleura, chest wall, breasts', window: 'Soft tissue', look: ['Effusions and pleural thickening.', 'Chest wall masses, breasts, axillae.'], show: /^breast_|^diaphragm$/ },
      {
        id: 'abdomen',
        title: 'Upper abdomen in view',
        window: 'Soft tissue',
        look: ['Liver, spleen, adrenals, kidneys, stomach — whatever the scan includes.'],
        show: /^liver$|^spleen$|^adrenal_|^kidney|^stomach$|^pancreas$|^gallbladder$/,
      },
      { id: 'bones', title: 'Bones', window: 'Bone', look: ['Spine: body heights, lytic or sclerotic lesions.', 'Ribs one by one, sternum, scapulae, clavicles.'], show: /^t\d+_vertebra|^rib_|^sternum$|^scapula_|^clavicle_|^costal/ },
    ],
  },
  {
    id: 'cardiac_levels',
    title: 'Heart and great vessels: the book’s six CT levels',
    family: 'CT',
    hint: /^aorta_arch$|^heart$|^pulmonary_(trunk|artery)|^brachiocephalic_trunk$/,
    unit: 'ch03',
    steps: [
      {
        id: 'five',
        title: 'Five-vessel level (Fig. 3.5)',
        window: 'Soft tissue',
        look: ['Just above the arch: brachiocephalic trunk, left common carotid and left subclavian arteries behind the two brachiocephalic veins.', 'The left brachiocephalic vein crosses in front, from left to right.'],
        show: /^brachiocephalic|^common_carotid|^subclavian_artery|^trachea$/,
        page: 39,
      },
      {
        id: 'arch',
        title: 'Aortic arch level (Fig. 3.6)',
        window: 'Soft tissue',
        look: ['The arch runs from front-right to back-left beside the trachea.', 'The SVC lies to the right of the trachea.'],
        show: /^aorta_arch$|^superior_vena_cava$|^trachea$|^esophagus$/,
        level: [{ anchor: /^aorta_arch$/, at: 'largest' }],
        page: 40,
      },
      {
        id: 'apw',
        title: 'Aortopulmonary window level (Fig. 3.7)',
        window: 'Soft tissue',
        look: ['Below the arch: ascending aorta in front, descending aorta behind, now two separate circles.', 'The fat between the arch and the pulmonary artery is the aortopulmonary window — a place where enlarged lymph nodes hide.'],
        show: /^aorta_(ascending|descending_thoracic)$|^superior_vena_cava$|^trachea$|^main_bronchus/,
        level: [{ anchor: /^aorta_arch$/, at: 'below' }],
        page: 41,
      },
      {
        id: 'mpa',
        title: 'Main pulmonary artery level (Fig. 3.8)',
        window: 'Soft tissue',
        look: ['The pulmonary trunk divides: the left pulmonary artery arches over the left main bronchus, the right passes behind the ascending aorta and SVC.', 'Compare the trunk with the ascending aorta: it should not be wider.'],
        show: /^pulmonary_(trunk|artery)|^aorta_(ascending|descending_thoracic)$|^superior_vena_cava$/,
        level: [
          { anchor: /^pulmonary_trunk$/, at: 'largest' },
          { anchor: /^atrial_appendage_left$/, at: 'above' },
        ],
        page: 41,
      },
      {
        id: 'high',
        title: 'High cardiac level (Fig. 3.9)',
        window: 'Soft tissue',
        look: ['Aortic root in the middle, left atrium at the back with the pulmonary veins entering it, left atrial appendage on the left.', 'The right atrium and SVC junction on the right.'],
        show: /^heart$|^heart_atrium|^atrial_appendage|^pulmonary_vein|^aorta_ascending$|^aorta_descending_thoracic$/,
        level: [
          { anchor: /^atrial_appendage_left$/, at: 'largest' },
          { anchor: /^heart_atrium_left$/, at: 'largest' },
        ],
        page: 42,
      },
      {
        id: 'low',
        title: 'Low cardiac level (Fig. 3.10)',
        window: 'Soft tissue',
        look: ['The ventricles: the right ventricle in front behind the sternum, the left ventricle to the left with its thick wall.', 'Check the pericardium and the fat around the heart.'],
        show: /^heart$|^heart_ventricle|^heart_myocardium$|^aorta_descending_thoracic$|^inferior_vena_cava$|^esophagus$/,
        level: [
          { anchor: /^heart_ventricle_left$/, at: 'largest' },
          { anchor: /^heart$/, at: 0.72 },
        ],
        page: 42,
      },
    ],
  },
  {
    id: 'abdomen_ct',
    title: 'Abdomen and pelvis CT',
    family: 'CT',
    hint: /liver|kidney|spleen|colon|bladder|pancreas/,
    unit: 'ch13',
    steps: [
      { id: 'technique', title: 'Technique', look: ['Oral or IV contrast? Which phase (arterial, portal venous, delayed)?'] },
      { id: 'liver', title: 'Liver, gallbladder, bile ducts', window: 'Soft tissue', look: ['Liver size and density; focal lesions.', 'Gallbladder wall and contents; duct calibre.'], show: /^liver$|^gallbladder$/ },
      { id: 'spleen', title: 'Spleen', window: 'Soft tissue', look: ['Size, focal lesions.'], show: /^spleen$/ },
      { id: 'pancreas', title: 'Pancreas', window: 'Soft tissue', look: ['Head, neck, body, tail; duct; surrounding fat.'], show: /^pancreas$|^portal|^duodenum$/ },
      { id: 'adrenals', title: 'Adrenal glands', window: 'Soft tissue', look: ['Thin limbs; nodules over 1 cm.'], show: /^adrenal_/ },
      { id: 'kidneys', title: 'Kidneys, ureters, bladder', window: 'Soft tissue', look: ['Size, enhancement, cysts and masses.', 'Hydronephrosis, stones (also on bone window).', 'Bladder wall and contents.'], show: /^kidney|^bladder$/ },
      {
        id: 'bowel',
        title: 'Bowel, in order',
        window: 'Soft tissue',
        look: ['Stomach → duodenum → small bowel.', 'Colon from cecum to rectum: ascending, transverse, descending, sigmoid.', 'Calibre, wall thickening, fat stranding.'],
        show: /^stomach$|^duodenum$|^small_bowel$|^colon|^rectum$/,
      },
      { id: 'vessels', title: 'Vessels', window: 'Soft tissue', look: ['Aorta calibre (aneurysm ≥ 3 cm), IVC.', 'Portal and splenic veins; iliac vessels.'], show: /^aorta_abdominal$|^aorta$|^inferior_vena_cava$|^portal|^iliac/ },
      { id: 'pelvis', title: 'Pelvic organs', window: 'Soft tissue', look: ['Prostate or uterus and ovaries.', 'Pelvic nodes and free fluid.'], show: /^prostate|^uterus|^gonads$|^rectum$/ },
      { id: 'peritoneum', title: 'Peritoneum and retroperitoneum', window: 'Soft tissue', look: ['Free fluid, free gas (check with the lung window), collections.', 'Lymph nodes along the vessels.'] },
      { id: 'bases', title: 'Lung bases', window: 'Lung', look: ['Nodules, consolidation and effusions at the bottom of the chest.'], show: /^lung_/ },
      { id: 'bones', title: 'Bones and muscles', window: 'Bone', look: ['Spine, pelvis, hips: fractures, lytic or sclerotic lesions.', 'Psoas and back muscles.'], show: /^l\d+_vertebra|^sacrum$|^hip_|^femur|^iliopsoas_|^gluteus/ },
    ],
  },
  {
    id: 'brain_mr',
    title: 'Brain (CT or MRI)',
    family: 'MR',
    hint: /^brain|^cerebrum|^skull/,
    unit: 'ch20',
    steps: [
      { id: 'ventricles', title: 'Ventricles and sulci', look: ['Size and symmetry; compare ventricles with sulci.'], show: /ventricle/ },
      { id: 'midline', title: 'Midline and mass effect', look: ['Midline shift, effaced sulci, herniation.'], show: /^brain$|^cerebrum$/ },
      { id: 'parenchyma', title: 'Brain tissue', look: ['Grey–white differentiation.', 'Focal abnormal density or signal.'], show: /^brain$|^cerebrum$/ },
      { id: 'posterior', title: 'Posterior fossa', look: ['Cerebellum, brainstem, fourth ventricle.'] },
      { id: 'extra', title: 'Outside the brain', look: ['Extra-axial collections, bone, sinuses and orbits.'], show: /^skull$/ },
    ],
  },
];

/** Patterns that fit a scan, best first. */
export function patternsFor(family: string, keys: Set<string>): SearchPattern[] {
  const score = (p: SearchPattern) => [...keys].filter((k) => p.hint.test(k)).length;
  const fits = SEARCH_PATTERNS.filter((p) => p.family === family || (p.id === 'brain_mr' && family === 'CT'));
  const matching = fits.filter((p) => score(p) > 0).sort((a, b) => score(b) - score(a));
  // Without labels we cannot tell the body part: offer every pattern for the modality.
  return matching.length || keys.size ? matching : fits.filter((p) => p.family === family);
}
