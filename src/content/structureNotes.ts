/**
 * Short teaching notes for every labelled structure: how it looks, what it sits next to, and one
 * common pitfall. Written for this app in plain words (not copied from the book); each links to
 * the chapter that teaches it. Numbers are the usual textbook rules of thumb, not cut-offs for a
 * diagnosis.
 */
import { canonicalAnatomyKey } from './bookAnatomy';

export type WindowName = 'Lung' | 'Soft tissue' | 'Bone';

export interface StructureNote {
  look: string;
  near: string;
  pitfall?: string;
  /** Book chapter (curriculum unit id) that teaches it. */
  unit: string;
  /** Best CT window to examine it. */
  window: WindowName;
  /** Different wording for projection radiographs, where the structure looks different. */
  xr?: { look: string; near?: string; pitfall?: string };
}

/** Structure key without side or number: "rib_left_5" → "rib", "aorta_arch" stays. */
export function structureBase(classIdOrKey: string): string {
  const k = canonicalAnatomyKey(classIdOrKey);
  if (/^[c]\d+_vertebra$/.test(k)) return 'cervical_vertebra';
  if (/^t\d+_vertebra$/.test(k)) return 'thoracic_vertebra';
  if (/^l\d+_vertebra$/.test(k)) return 'lumbar_vertebra';
  if (/^rib_(left|right)_\d+$/.test(k)) return 'rib';
  return k.replace(/_(left|right)$/, '');
}

const N: Array<[RegExp, StructureNote]> = [
  // ------------------------------------------------------------- airways and lungs
  [
    /^trachea$/,
    {
      look: 'Air-filled tube, black on every window, in the midline just in front of the esophagus. The cartilage rings may calcify with age.',
      near: 'Divides at the carina (about T4–T5, the level of the sternal angle) into the right and left main bronchi.',
      pitfall: 'A slight bend to the right at the aortic arch is normal; real displacement suggests volume loss or a mass.',
      unit: 'ch02',
      window: 'Lung',
      xr: {
        look: 'Dark vertical column of air over the upper spine.',
        near: 'Should sit midway between the medial ends of the clavicles.',
        pitfall: 'Rotation of the patient makes a normal trachea look shifted — check the clavicle heads first.',
      },
    },
  ],
  [
    /^main_bronchus_right$/,
    {
      look: 'Right main bronchus: short (about 2–2.5 cm in adults), wide and steep. It gives off the right upper lobe bronchus and continues as the bronchus intermedius down to the middle and lower lobe bronchi.',
      near: 'The azygos vein arches over it into the SVC; the right pulmonary artery runs in front of it.',
      pitfall: 'Because it is straighter than the left, inhaled foreign bodies and aspiration go right more often.',
      unit: 'ch02',
      window: 'Lung',
    },
  ],
  [
    /^main_bronchus_left$/,
    {
      look: 'Left main bronchus: longer (about 4–5 cm) and more horizontal, running under the aortic arch to the left hilum.',
      near: 'The left pulmonary artery arches over it — which is why the left hilum sits higher than the right on a chest X-ray. The descending aorta and esophagus lie behind it.',
      pitfall: 'A large left atrium pushes it upwards and widens the angle under the carina.',
      unit: 'ch02',
      window: 'Lung',
    },
  ],
  [
    /^main_bronchus$|^bronch/,
    {
      look: 'Air-filled tubes running from the carina into each hilum.',
      near: 'The right main bronchus is shorter, wider and more vertical; the left passes under the aortic arch.',
      pitfall: 'Because the right bronchus is straighter, inhaled foreign bodies and aspiration go right more often.',
      unit: 'ch02',
      window: 'Lung',
    },
  ],
  [
    /^lung$/,
    {
      look: 'Very low density (about −850 HU) with branching white vessels; examine it in the lung window.',
      near: 'The right lung has three lobes (upper, middle, lower); the left has two (upper with the lingula, and lower).',
      pitfall: 'In a patient lying on their back the back of the lungs is slightly denser — that is gravity, not consolidation.',
      unit: 'ch02',
      window: 'Lung',
      xr: {
        look: 'The dark areas either side of the mediastinum, crossed by vessels that taper towards the edges.',
        near: 'Compare left with right in the upper, middle and lower zones.',
        pitfall: 'Breast shadows and overlying soft tissue make the lower zones look whiter; look for a matching change on the other side.',
      },
    },
  ],
  [
    /^lung_upper_lobe$/,
    {
      look: 'The lobe above and in front of the oblique fissure.',
      near: 'On the right it ends at the horizontal fissure; on the left it includes the lingula, which touches the left heart border.',
      pitfall: 'On a frontal radiograph the lower lobes reach high at the back — the “upper zone” is not the same as the upper lobe.',
      unit: 'ch02',
      window: 'Lung',
    },
  ],
  [
    /^lung_middle_lobe$/,
    {
      look: 'Right lung only: the wedge between the horizontal and oblique fissures, lying against the right heart border.',
      near: 'In front of the right lower lobe and below the right upper lobe.',
      pitfall: 'Disease here blurs the right heart border on a frontal X-ray (the silhouette sign).',
      unit: 'ch02',
      window: 'Lung',
    },
  ],
  [
    /^lung_lower_lobe$/,
    {
      look: 'The lobe behind the oblique fissure, reaching down into the deep posterior corners of the chest.',
      near: 'Sits on the diaphragm; its top (superior segment) reaches up to about the level of the hila.',
      pitfall: 'Lower-lobe disease blurs the outline of the diaphragm, not the heart border.',
      unit: 'ch02',
      window: 'Lung',
    },
  ],
  [
    /^hilum$/,
    {
      look: 'Mostly pulmonary arteries and veins, with the bronchi, where they enter each lung.',
      near: 'The left hilum normally sits slightly higher than the right.',
      pitfall: 'A bulky, lobulated or very dense hilum suggests enlarged lymph nodes or a mass.',
      unit: 'ch02',
      window: 'Soft tissue',
    },
  ],
  [
    /^mediastinum$/,
    {
      look: 'The central soft-tissue shadow between the lungs: heart, great vessels, trachea and esophagus.',
      near: 'Its right border is formed by the SVC and right atrium; the left by the aortic knob, pulmonary trunk and left ventricle.',
      pitfall: 'AP and supine films make the mediastinum look wider; judge its width on an upright PA film.',
      unit: 'ch02',
      window: 'Soft tissue',
    },
  ],
  [
    /^diaphragm$/,
    {
      look: 'Thin dome-shaped muscle separating chest from abdomen; the right dome is usually a little higher (the liver lies beneath).',
      near: 'The aorta passes behind it at about T12, the esophagus through it at about T10.',
      pitfall: 'On an upright film, air under the diaphragm is free gas until proved otherwise — do not confuse it with the stomach bubble on the left.',
      unit: 'ch02',
      window: 'Soft tissue',
      xr: {
        look: 'Two smooth domes; the costophrenic angles at their outer edges should be sharp.',
        pitfall: 'A blunted costophrenic angle suggests fluid in the pleural space.',
      },
    },
  ],
  [
    /^breast$/,
    {
      look: 'Soft-tissue cone on the front of the chest wall; glandular tissue is denser than the surrounding fat.',
      near: 'In front of the pectoral muscles; the axilla lies at its upper outer edge.',
      pitfall: 'On a frontal X-ray breast shadows make the lower zones whiter; after a mastectomy one side looks darker.',
      unit: 'ch02',
      window: 'Soft tissue',
    },
  ],
  // ------------------------------------------------------------- heart and vessels
  [
    /^heart$/,
    {
      look: 'Soft-tissue density; after contrast the chambers are bright and the heart muscle greyer.',
      near: 'The right ventricle is the most anterior chamber, behind the sternum; the left atrium is the most posterior, in front of the esophagus.',
      pitfall: 'Fat around the heart is normal; fluid density around it suggests a pericardial effusion.',
      unit: 'ch03',
      window: 'Soft tissue',
      xr: {
        look: 'Right border = right atrium; left border = left ventricle, with the pulmonary trunk and left atrial appendage above it.',
        near: 'On a PA film the heart should be less than about half the width of the chest (cardiothoracic ratio under 0.5).',
        pitfall: 'AP and supine films magnify the heart — do not call it enlarged on those alone.',
      },
    },
  ],
  [
    /^atrial_appendage$/,
    {
      look: 'Small ear-shaped pouch of the atrium; the left one lies beside the pulmonary trunk.',
      near: 'Opens into the body of the atrium.',
      pitfall: 'The commonest place for clot in atrial fibrillation — but on early-phase CT slow flow can look like a filling defect.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^heart_atrium_right$/,
    {
      look: 'Right atrium: forms the right border of the heart; after contrast it often shows swirling mixed bright and dark blood from the SVC and IVC.',
      near: 'Receives the SVC from above and the IVC from below; lies to the right of the left atrium and in front of and to the right of it.',
      pitfall: 'Mixing of contrast-filled and unopacified blood here is normal and must not be called a clot.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^heart_ventricle_right$/,
    {
      look: 'Right ventricle: the most anterior chamber, lying directly behind the sternum, with a thinner wall than the left ventricle.',
      near: 'Its outflow tract leads up into the pulmonary trunk; the interventricular septum separates it from the left ventricle.',
      pitfall: 'A right ventricle larger than the left (RV:LV over 1 on an axial image) is a sign of right heart strain, e.g. from a large pulmonary embolus.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^heart_atrium_left$/,
    {
      look: 'Left atrium: the most posterior chamber, a smooth-walled box at the back of the heart.',
      near: 'The four pulmonary veins enter it; the esophagus and descending aorta lie right behind it; its appendage reaches forward on the left.',
      pitfall: 'An enlarged left atrium pushes the esophagus backwards and splays the carina — signs you can also see on a chest X-ray.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^heart_ventricle_left$/,
    {
      look: 'Left ventricle: the chamber on the left of the heart, wrapped in the thickest muscle wall; it forms the left heart border.',
      near: 'The mitral valve opens into it from the left atrium; it pumps into the aortic root in the middle of the heart.',
      pitfall: 'The wall looks thicker when the heart is caught in systole; judge thickness on more than one image.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^heart_myocardium$/,
    {
      look: 'Left ventricular myocardium: the ring of muscle around the left ventricular cavity, greyer than the bright blood after contrast.',
      near: 'Includes the interventricular septum on its right side.',
      pitfall: 'A thin, dark segment of wall that does not enhance can be an old infarct; fat in the wall is also seen after infarction.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^pulmonary_arteries_/,
    {
      look: 'Lobar and segmental pulmonary arteries: the branches inside each lobe, running beside the bronchi and dividing with them.',
      near: 'Each artery has a bronchus of the same size next to it; the veins run separately, between the segments.',
      pitfall: 'On a pulmonary-arterial-phase CT, emboli in these branches are dark filling defects — check every lobe, not just the central arteries.',
      unit: 'ch03',
      window: 'Lung',
    },
  ],
  [
    /^pulmonary_artery_interlobar/,
    {
      look: 'Interlobar pulmonary artery: the descending part of the right or left pulmonary artery after the upper-lobe branches leave it.',
      near: 'On the right it runs down beside the bronchus intermedius; on the left behind the left main bronchus.',
      pitfall: 'On a frontal X-ray an enlarged right interlobar artery (wider than about 16 mm) suggests pulmonary hypertension.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^aorta$/,
    {
      look: 'Round, bright tube after contrast; wall calcification is common in older people.',
      near: 'Rises from the left ventricle, arches over the left main bronchus, runs down left of the spine and passes behind the diaphragm at about T12.',
      pitfall: 'Measure the diameter at right angles to the vessel — an oblique cut overestimates it.',
      unit: 'ch03',
      window: 'Soft tissue',
      xr: {
        look: 'The “aortic knob”: the arch seen end-on at the upper left border of the mediastinum.',
        pitfall: 'A widened or indistinct knob in trauma raises concern for aortic injury — CT is needed.',
      },
    },
  ],
  [
    /^aorta_ascending$/,
    {
      look: 'Round, bright vessel rising from the aortic valve, in front of and to the right of the pulmonary trunk.',
      near: 'The SVC lies just to its right; the pulmonary trunk wraps in front and to its left.',
      pitfall: 'Normal diameter is up to about 4 cm. Pulsation can blur its wall on non-gated CT and mimic a dissection flap.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^aorta_arch$/,
    {
      look: 'On axial CT a sausage-shaped vessel running from front-right to back-left, beside and in front of the trachea.',
      near: 'Gives off three branches: brachiocephalic trunk, left common carotid and left subclavian arteries.',
      pitfall: 'This is the “aortic knob” on a chest X-ray. Below the arch you normally see two round aortas on one slice (ascending in front, descending behind).',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^aorta_descending_thoracic$/,
    {
      look: 'Round vessel to the left of the spine.',
      near: 'Behind the left main bronchus and the left atrium, beside the esophagus; leaves the chest through the aortic hiatus at about T12.',
      pitfall: 'Mural thrombus and calcification are common; a crescent of high density in the wall on non-contrast CT suggests intramural hematoma.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^aorta_abdominal$/,
    {
      look: 'Round vessel in front of the lumbar spine, usually just left of the midline.',
      near: 'The IVC lies to its right. It gives off the coeliac trunk, SMA and renal arteries and divides into the common iliac arteries at about L4.',
      pitfall: 'A diameter of 3 cm or more is an abdominal aortic aneurysm.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^pulmonary_trunk$/,
    {
      look: 'The main pulmonary artery: leaves the right ventricle in front of and to the left of the ascending aorta, runs up and backwards, and divides under the aortic arch.',
      near: 'It divides just below the level of the carina; the ascending aorta lies to its right. This is the book’s “main pulmonary artery level”.',
      pitfall: 'A trunk wider than the ascending aorta at the same level (or over about 3 cm) suggests pulmonary hypertension. A clot straddling the bifurcation is a saddle embolus.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^pulmonary_artery$/,
    {
      look: 'Right pulmonary artery: long and horizontal, passing behind the ascending aorta and SVC to the right hilum. Left pulmonary artery: short, arching over the left main bronchus to the left hilum.',
      near: 'The right one runs in front of the right main bronchus; the left one sits above the left main bronchus — which is why the left hilum is higher on a chest X-ray.',
      pitfall: 'On CT pulmonary angiography, emboli are dark filling defects inside these bright arteries; follow each branch out into the lobes.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^pulmonary_vein$/,
    {
      look: 'Usually four veins, two from each lung, entering the back of the left atrium.',
      near: 'Veins run between lung segments; arteries run beside the bronchi.',
      pitfall: 'To tell a vessel apart, follow it back: arteries lead to the hilum with a bronchus, veins lead to the left atrium.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^superior_vena_cava$/,
    {
      look: 'Oval vein to the right of the ascending aorta.',
      near: 'Formed by the two brachiocephalic veins and drains into the right atrium; the azygos vein arches into it from behind, over the right main bronchus.',
      pitfall: 'Dense contrast mixing with unopacified blood during an arm injection is normal and is not clot.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^inferior_vena_cava$/,
    {
      look: 'Large vein to the right of the aorta, running behind the liver in the upper abdomen.',
      near: 'Receives the renal veins and hepatic veins and enters the right atrium. The left renal vein reaches it by crossing in front of the aorta, under the SMA.',
      pitfall: 'In early-phase scans, unopacified blood from the legs mixing with bright blood from the kidneys can mimic clot.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^brachiocephalic_trunk$/,
    {
      look: 'The brachiocephalic trunk (the book calls it the innominate artery): the first and largest branch of the aortic arch, in front of and to the right of the trachea.',
      near: 'Divides behind the right sternoclavicular joint into the right subclavian and right common carotid arteries.',
      pitfall: 'Only the right side has a brachiocephalic artery; on the left the carotid and subclavian come straight off the arch.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^brachiocephalic_vein$/,
    {
      look: 'The left brachiocephalic vein crosses in front of the arch branches from left to right; the right one is short and vertical.',
      near: 'They join to form the SVC behind the right first costal cartilage.',
      pitfall: 'Very dense contrast in the left brachiocephalic vein after an arm injection causes streak artefact over the arch branches.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^common_carotid_artery$/,
    {
      look: 'Paired round arteries beside the trachea and thyroid in the lower neck.',
      near: 'Inside the carotid sheath with the internal jugular vein lateral to it. The right arises from the brachiocephalic trunk, the left directly from the arch.',
      pitfall: 'Asymmetric jugular veins are common and normal; compare the arteries with each other, not with the veins.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^subclavian_artery$/,
    {
      look: 'Arches over the top of the lung behind the clavicle.',
      near: 'The right arises from the brachiocephalic trunk; the left is the last branch of the arch.',
      pitfall: 'An aberrant right subclavian artery arising last from the arch and passing behind the esophagus is the commonest arch variant.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  // ------------------------------------------------------------- brain arteries (Circle of Willis)
  [
    /^basilar_artery$/,
    {
      look: 'Single midline artery, bright on MR angiography, running up the front of the pons in the prepontine cistern.',
      near: 'Formed by the two vertebral arteries at the lower border of the pons; it ends above the dorsum sellae by dividing into the two posterior cerebral arteries.',
      pitfall: 'The basilar tip is a classic site for an aneurysm: look at it on every angiogram. A tortuous basilar artery in older people is normal.',
      unit: 'ch26',
      window: 'Soft tissue',
    },
  ],
  [
    /^internal_carotid_artery$/,
    {
      look: 'On MR angiography inside the skull: an S-shaped curve (the siphon) beside the sella in the cavernous sinus, then up through the dura to its end below the anterior perforated substance.',
      near: 'Ends by dividing into the anterior and middle cerebral arteries; the ophthalmic and posterior communicating arteries leave it just before that.',
      pitfall: 'Aneurysms at the origin of the posterior communicating artery are common; the funnel-shaped origin of a normal Pcom (an infundibulum, under 3 mm, with the artery leaving its tip) is not an aneurysm.',
      unit: 'ch26',
      window: 'Soft tissue',
    },
  ],
  [
    /^middle_cerebral_artery(_m1)?$/,
    {
      look: 'The largest branch of the internal carotid artery. M1 runs laterally from the carotid end to its division, usually into two (sometimes three) M2 trunks.',
      near: 'M1 lies in front of the temporal lobe; the M2 branches turn up into the Sylvian fissure over the insula.',
      pitfall: 'The division of the middle cerebral artery is a common aneurysm site; follow each M2 branch from its origin on both sides.',
      unit: 'ch26',
      window: 'Soft tissue',
    },
  ],
  [
    /^middle_cerebral_artery_m2$/,
    {
      look: 'The trunks beyond the division of the middle cerebral artery, running up and back in the Sylvian fissure over the insula.',
      near: 'They supply most of the lateral surface of the frontal, parietal and temporal lobes.',
      pitfall: 'A blocked M2 branch causes a cortical stroke that can look small on diffusion MRI.',
      unit: 'ch26',
      window: 'Soft tissue',
    },
  ],
  [
    /^anterior_cerebral_artery(_a1)?$/,
    {
      look: 'A1 runs medially and forwards from the carotid end above the optic chiasm; at the anterior communicating artery the A2 segment turns up between the hemispheres.',
      near: 'The two A1 segments are joined by the anterior communicating artery; the A2s run side by side in the interhemispheric fissure.',
      pitfall: 'One A1 is often small or not seen: both anterior cerebral arteries then fill from the other side through the anterior communicating artery.',
      unit: 'ch26',
      window: 'Soft tissue',
    },
  ],
  [
    /^anterior_cerebral_artery_a2$/,
    {
      look: 'The part of the anterior cerebral artery beyond the anterior communicating artery, running up in front of the corpus callosum.',
      near: 'The two A2 segments lie side by side in the interhemispheric fissure.',
      pitfall: 'Aneurysms further along the anterior cerebral artery (the pericallosal artery) are uncommon and easy to miss on axial images.',
      unit: 'ch26',
      window: 'Soft tissue',
    },
  ],
  [
    /^anterior_communicating_artery$/,
    {
      look: 'A short midline artery, a few millimetres long, joining the two anterior cerebral arteries above the optic chiasm.',
      near: 'Lies where the two A1 segments meet and the A2 segments start.',
      pitfall: 'The commonest site of intracranial aneurysms. It can be absent, doubled or too small to see on MR angiography.',
      unit: 'ch26',
      window: 'Soft tissue',
    },
  ],
  [
    /^posterior_communicating_artery$/,
    {
      look: 'A thin artery running backwards from the internal carotid artery to the posterior cerebral artery, beside the optic tract.',
      near: 'Joins the front (carotid) and back (basilar) halves of the circle on each side; the oculomotor nerve runs just below it.',
      pitfall: 'Often too small to see. When it is as large as the posterior cerebral artery and the P1 segment is small or absent, the PCA is "fetal-type" and fills from the carotid.',
      unit: 'ch26',
      window: 'Soft tissue',
    },
  ],
  [
    /^posterior_cerebral_artery(_p1)?$/,
    {
      look: 'From the basilar tip, P1 runs laterally to the posterior communicating artery; beyond it P2 curves back around the midbrain.',
      near: 'Lies above the superior cerebellar artery, separated from it by the oculomotor nerve.',
      pitfall: 'A small or missing P1 with a large posterior communicating artery is a common normal variant (fetal-type posterior cerebral artery).',
      unit: 'ch26',
      window: 'Soft tissue',
    },
  ],
  [
    /^posterior_cerebral_artery_p2$/,
    {
      look: 'The part of the posterior cerebral artery beyond the posterior communicating artery, curving around the midbrain towards the occipital lobe.',
      near: 'Runs in the ambient cistern beside the midbrain, above the tentorium.',
      pitfall: 'Its branches supply the occipital lobe: a blocked posterior cerebral artery causes a visual field defect.',
      unit: 'ch26',
      window: 'Soft tissue',
    },
  ],
  [
    /^third_a2$/,
    {
      look: 'A third, midline artery running up between the two A2 segments from the anterior communicating artery (median artery of the corpus callosum).',
      near: 'Lies between the right and left A2 segments in the interhemispheric fissure.',
      pitfall: 'A normal variant; do not mistake it for a duplicated or displaced anterior cerebral artery.',
      unit: 'ch26',
      window: 'Soft tissue',
    },
  ],
  [
    /^portal_vein_and_splenic_vein$|^portal_vein$|^splenic_vein$/,
    {
      look: 'The splenic vein runs along the back of the pancreas and joins the superior mesenteric vein behind the pancreatic neck to form the portal vein, which runs up to the liver.',
      near: 'The portal vein enters the liver at the porta hepatis, with the hepatic artery and bile duct.',
      pitfall: 'These veins are brightest in the portal venous phase (about 60–70 s); in the arterial phase they can look falsely filled in.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^iliac_artery$/,
    {
      look: 'The common iliac arteries start at the aortic bifurcation (about L4) and divide into external and internal iliac arteries in front of the sacroiliac joints.',
      near: 'They lie in front of, and slightly lateral to, the iliac veins.',
      pitfall: 'Calcified plaque is common and can look like a small bone fragment on the bone window.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^iliac_vena$|^iliac_vein$/,
    {
      look: 'Large veins behind and medial to the iliac arteries.',
      near: 'They join at about L5, to the right of the aorta, to form the IVC.',
      pitfall: 'The left common iliac vein passes under the right common iliac artery; compression there (May–Thurner) predisposes to left leg DVT.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  // ------------------------------------------------------------- mediastinum and neck
  [
    /^esophagus$/,
    {
      look: 'Muscular tube that may hold a little air or fluid, behind the trachea and then behind the left atrium.',
      near: 'Passes through the diaphragm at about T10, left of the midline, to join the stomach.',
      pitfall: 'A collapsed esophagus can look like a lymph node — scroll up and down: a tube continues, a node does not.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^thyroid_gland$/,
    {
      look: 'Bright gland wrapped around the front of the trachea in the lower neck; it is dense even without contrast because it stores iodine.',
      near: 'Two lobes joined by the isthmus; the common carotid arteries lie just outside it.',
      pitfall: 'Small thyroid nodules are very common and usually benign; a gland extending into the chest is a goitre.',
      unit: 'ch03',
      window: 'Soft tissue',
    },
  ],
  [
    /^thymus$/,
    {
      look: 'Soft tissue in the front of the mediastinum, in front of the great vessels: large and triangular in children, replaced by fat in adults.',
      near: 'Behind the sternum, in front of the aortic arch and pulmonary trunk.',
      pitfall: 'In a child a large thymus is normal — not a mass. The “sail sign” on a child’s chest X-ray is the normal thymus.',
      unit: 'ch27',
      window: 'Soft tissue',
    },
  ],
  // ------------------------------------------------------------- abdomen
  [
    /^liver$/,
    {
      look: 'The largest solid organ, in the right upper abdomen; even density, brightest in the portal venous phase.',
      near: 'The gallbladder sits under it, the IVC runs behind it and the hepatic veins drain into the IVC at its top.',
      pitfall: 'Without contrast the liver should be at least as dense as the spleen; a liver darker than the spleen suggests fatty liver.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^gallbladder$/,
    {
      look: 'Pear-shaped sac of fluid (near water density) under the liver.',
      near: 'In the gallbladder fossa between the right and left lobes; its neck points to the porta hepatis.',
      pitfall: 'Some gallstones have the same density as bile and are invisible on CT — ultrasound is the test for stones.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^spleen$/,
    {
      look: 'Crescent-shaped organ in the left upper abdomen, against the diaphragm and the lower left ribs.',
      near: 'Behind the stomach and above the left kidney; the splenic vein leaves at its hilum.',
      pitfall: 'In the arterial phase the spleen enhances in stripes (a “zebra” pattern) — normal, not infarcts.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^pancreas$/,
    {
      look: 'Lobulated gland lying across the spine behind the stomach: head in the curve of the duodenum, neck, body and tail towards the spleen.',
      near: 'The splenic vein runs along its back; the SMV and, to its left, the SMA lie behind the neck.',
      pitfall: 'Unopacified duodenum or jejunum next to the head can mimic a mass; it becomes more lobulated and fatty with age.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^kidney$/,
    {
      look: 'Bean-shaped organs either side of the spine at about T12–L3; the right is a little lower than the left.',
      near: 'At the hilum, from front to back: renal vein, renal artery, renal pelvis.',
      pitfall: 'In the early (corticomedullary) phase the medulla looks dark — do not mistake it for a mass; look again in a later phase.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^kidney_cyst$/,
    {
      look: 'Round, sharply edged, water density (0–20 HU), not enhancing: a simple cyst.',
      near: 'Usually in the cortex, often bulging from the kidney outline.',
      pitfall: 'Enhancement after contrast, thick walls, septa or nodules mean it is not a simple cyst.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^adrenal$/,
    {
      look: 'Thin inverted Y or V shapes above and in front of the upper poles of the kidneys.',
      near: 'The right adrenal lies directly behind the IVC; the left lies beside the aorta, in front of the upper pole of the left kidney.',
      pitfall: 'Small incidental nodules are common; under 10 HU on a non-contrast scan means a benign fat-rich adenoma.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^stomach$/,
    {
      look: 'J-shaped organ in the left upper abdomen holding gas, fluid or food.',
      near: 'Under the left diaphragm, in front of the pancreas and spleen; joins the duodenum at the pylorus.',
      pitfall: 'A collapsed stomach wall looks thick — judge the wall only when the stomach is distended.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^duodenum$/,
    {
      look: 'C-shaped loop around the head of the pancreas: bulb, descending, horizontal and ascending parts.',
      near: 'The horizontal part crosses between the aorta behind and the SMA in front.',
      pitfall: 'Collapsed duodenum beside the pancreatic head can mimic a mass — follow the loop.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^small_bowel$/,
    {
      look: 'Jejunum (left upper abdomen, feathery folds) and ileum (right lower abdomen, smoother), hanging on the mesentery.',
      near: 'The ileum joins the cecum at the ileocecal valve in the right lower abdomen.',
      pitfall: 'Small bowel wider than about 2.5–3 cm suggests obstruction — look for the point where dilated bowel becomes collapsed.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^colon$/,
    {
      look: 'Large bowel framing the abdomen, holding gas and mottled stool: cecum, ascending, transverse, descending and sigmoid colon, then rectum.',
      near: 'The ascending and descending colon are fixed to the back wall; the transverse and sigmoid colon hang on mesenteries and move.',
      pitfall: 'Colon over about 6 cm wide (cecum over about 9 cm) is dilated.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^colon_ascending$|^c(a)?ecum$/,
    {
      look: 'Cecum and ascending colon: the right-sided colon, from the right iliac fossa up to the hepatic flexure under the liver.',
      near: 'The terminal ileum and the appendix join the cecum low in the right abdomen.',
      pitfall: 'In right lower abdominal pain, find the appendix from the cecum below the ileocecal valve.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^colon_transverse$/,
    {
      look: 'Runs across the upper abdomen from the hepatic flexure (right) to the splenic flexure (left), below the stomach.',
      near: 'Hangs on the transverse mesocolon, in front of the duodenum and pancreas.',
      pitfall: 'Very mobile — in thin people it can dip down into the pelvis.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^colon_descending$/,
    {
      look: 'Left-sided colon running down from the splenic flexure to the left iliac fossa.',
      near: 'Fixed to the back wall, beside the left kidney and in front of the left psoas and quadratus lumborum.',
      pitfall: 'Often collapsed and easy to miss — follow it down from the splenic flexure.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^colon_sigmoid$/,
    {
      look: 'S-shaped loop in the left lower abdomen and pelvis, on its own mesentery.',
      near: 'Joins the rectum at about the level of S3.',
      pitfall: 'The commonest site of diverticula; look for small outpouchings and fat stranding in left lower abdominal pain.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^rectum$/,
    {
      look: 'The last 12–15 cm of bowel, in the pelvis in front of the sacrum.',
      near: 'Behind the bladder and the prostate or uterus.',
      pitfall: 'The wall can be judged only when the rectum is distended; gas and stool here are normal.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^bladder$/,
    {
      look: 'Fluid-filled sac behind the pubic symphysis, with a thin wall when full.',
      near: 'In front of the rectum (and, in women, the uterus); the prostate sits under it in men.',
      pitfall: 'An empty bladder has a thick-looking wall; layering contrast on delayed scans can mimic a mass.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^prostate$/,
    {
      look: 'Rounded gland under the bladder, in front of the rectum.',
      near: 'The urethra runs through its centre.',
      pitfall: 'CT cannot reliably show the zones inside it — MRI can.',
      unit: 'ch20',
      window: 'Soft tissue',
    },
  ],
  [
    /^prostate_transition_zone$/,
    {
      look: 'The central part around the urethra; it enlarges with benign prostatic hyperplasia, with a nodular “organised chaos” look on T2 MRI.',
      near: 'Surrounded at the back and sides by the peripheral zone.',
      pitfall: 'BPH nodules are expected here; a smudgy dark area without a capsule is more suspicious.',
      unit: 'ch20',
      window: 'Soft tissue',
    },
  ],
  [
    /^prostate_peripheral_zone$/,
    {
      look: 'The back and sides of the gland; normally bright on T2 MRI.',
      near: 'Lies against the rectum — which is why it can be felt on rectal examination.',
      pitfall: 'Most cancers arise here and appear as a dark focus on T2 with restricted diffusion.',
      unit: 'ch20',
      window: 'Soft tissue',
    },
  ],
  [
    /^prostate_anterior_fibromuscular_stroma$/,
    {
      look: 'Band at the front of the gland that is normally dark on T2 MRI.',
      near: 'In front of the transition zone.',
      pitfall: 'Its normal darkness should not be mistaken for a tumour.',
      unit: 'ch20',
      window: 'Soft tissue',
    },
  ],
  [
    /^prostatic_urethra$/,
    {
      look: 'Thin channel running through the centre of the prostate.',
      near: 'Surrounded by the transition zone.',
      pitfall: 'A catheter in it causes artefact; note it before describing the central gland.',
      unit: 'ch20',
      window: 'Soft tissue',
    },
  ],
  [
    /^uterus_and_cervix$|^uterus$/,
    {
      look: 'Pear-shaped muscular organ in the pelvis; the cervix is its lower part.',
      near: 'Between the bladder in front and the rectum behind; the ovaries lie at its sides.',
      pitfall: 'It enhances unevenly in early phases — do not over-call masses on a single phase.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^gonads$|^ovary$|^testis$/,
    {
      look: 'Ovaries: small ovals at the pelvic side walls. Testes: in the scrotum, below the pelvis.',
      near: 'The ovaries lie beside the uterus near the iliac vessels.',
      pitfall: 'Small follicles are normal cysts in the ovaries of younger women.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  // ------------------------------------------------------------- muscles
  [
    /^iliopsoas$|^psoas/,
    {
      look: 'Psoas runs beside the lumbar spine and joins iliacus to form iliopsoas, which crosses in front of the hip.',
      near: 'The kidneys lie in front of and lateral to the psoas; the ureters run down over it.',
      pitfall: 'Asymmetry or fluid in the psoas suggests a hematoma or abscess.',
      unit: 'ch13',
      window: 'Soft tissue',
    },
  ],
  [
    /^autochthon$|^erector_spinae$/,
    {
      look: 'The deep back muscles (erector spinae) either side of the spinous processes.',
      near: 'Behind the transverse processes and laminae.',
      pitfall: 'Fatty replacement increases with age and is not a disease on its own.',
      unit: 'ch22',
      window: 'Soft tissue',
    },
  ],
  [
    /^gluteus_maximus$/,
    {
      look: 'The largest and most superficial buttock muscle.',
      near: 'Covers the gluteus medius and minimus and the sciatic nerve.',
      pitfall: 'Injection granulomas in the buttock fat and muscle are common incidental findings.',
      unit: 'ch22',
      window: 'Soft tissue',
    },
  ],
  [
    /^gluteus_medius$/,
    {
      look: 'Fan-shaped muscle on the outer surface of the iliac wing, under gluteus maximus.',
      near: 'Inserts on the greater trochanter of the femur.',
      pitfall: 'Tears at its insertion are a common cause of lateral hip pain.',
      unit: 'ch22',
      window: 'Soft tissue',
    },
  ],
  [
    /^gluteus_minimus$/,
    {
      look: 'The deepest of the three gluteal muscles, lying directly on the iliac bone.',
      near: 'Under gluteus medius; also inserts on the greater trochanter.',
      pitfall: 'Easily confused with gluteus medius — minimus is the one touching the bone.',
      unit: 'ch22',
      window: 'Soft tissue',
    },
  ],
  // ------------------------------------------------------------- skeleton
  [
    /^cervical_vertebra$/,
    {
      look: 'Small vertebrae with holes in the transverse processes (transverse foramina) for the vertebral arteries.',
      near: 'C1 (atlas) has no body; C2 (axis) carries the dens. C7 has the long spinous process you can feel.',
      pitfall: 'On a lateral X-ray you must see down to the top of T1, or the study is incomplete.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^thoracic_vertebra$/,
    {
      look: 'Each has a body in front and an arch behind, with joints for the ribs.',
      near: 'The ribs attach to their sides; T12 carries the last rib.',
      pitfall: 'Count from the first rib or from C7 — counting up from the sacrum fails when there is a transitional vertebra.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^lumbar_vertebra$/,
    {
      look: 'The five largest vertebrae, without ribs.',
      near: 'The line joining the tops of the iliac crests usually crosses L4 or the L4–L5 disc.',
      pitfall: 'A lumbarised S1 or sacralised L5 makes level counting unreliable — say how you counted.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^vertebra/,
    {
      look: 'A body in front (weight-bearing) and an arch behind (pedicles, laminae, spinous process) around the spinal canal.',
      near: 'Discs between the bodies; the facet joints behind.',
      pitfall: 'Check the height of each body: loss of height means a compression fracture.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^spine$/,
    {
      look: 'On a frontal chest film the vertebral bodies should be just visible through the heart when exposure is right.',
      near: 'Spinous processes should sit midway between the medial ends of the clavicles if the patient is not rotated.',
      pitfall: 'If the spine is invisible behind the heart, the film is under-penetrated and the lower lobes cannot be judged.',
      unit: 'ch02',
      window: 'Bone',
    },
  ],
  [
    /^sacrum$/,
    {
      look: 'Five fused vertebrae forming the back of the pelvis, with holes (foramina) for the sacral nerves.',
      near: 'Joins the iliac bones at the sacroiliac joints on each side.',
      pitfall: 'Insufficiency fractures in older people run vertically through the sacral wings and are easy to miss.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^rib$/,
    {
      look: 'Curved bones; on CT trace each one around the chest on the bone window.',
      near: 'Ribs 1–7 join the sternum through their costal cartilages; ribs 11 and 12 float free.',
      pitfall: 'Fractures are easily missed on a frontal X-ray — look along every rib, front and back.',
      unit: 'ch22',
      window: 'Bone',
      xr: {
        look: 'Posterior ribs run nearly horizontal and are easiest to count; anterior ribs slope down towards the sternum.',
        near: 'A good inspiration shows about 10 posterior ribs above the right diaphragm.',
      },
    },
  ],
  [
    /^costal_cartilages$/,
    {
      look: 'Cartilage joining the front ends of the ribs to the sternum.',
      near: 'Between the anterior rib ends and the sternum.',
      pitfall: 'They calcify with age and can look like lung nodules on a chest X-ray.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^sternum$/,
    {
      look: 'Flat bone in the front of the chest: manubrium, body and xiphoid.',
      near: 'The sternal angle (manubrium–body joint) is at the second rib and the T4–T5 level, the level of the carina.',
      pitfall: 'Sternal fractures are best seen on sagittal images or a lateral view.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^clavicle$/,
    {
      look: 'S-shaped bone across the top of the chest.',
      near: 'Joins the sternum medially and the acromion of the scapula laterally.',
      pitfall: 'On a frontal chest film, the medial ends should be the same distance from the spinous processes — otherwise the patient is rotated.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^scapula$/,
    {
      look: 'Triangular flat bone on the back of the chest wall.',
      near: 'Its glenoid forms the shoulder joint with the humeral head.',
      pitfall: 'On a PA chest film the scapulae are rotated off the lungs; on AP films their edges overlap the lungs and mimic pleural lines.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^humerus$/,
    {
      look: 'Upper arm bone; its head forms the shoulder joint with the glenoid.',
      near: 'The surgical neck, just below the head, is the commonest fracture site in older people.',
      pitfall: 'A posterior shoulder dislocation is easy to miss on a single frontal view — the head looks like a light bulb.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^femoral_head$|^femur$/,
    {
      look: 'The femoral head sits deep in the acetabulum; the neck joins it to the shaft.',
      near: 'The greater trochanter lies lateral, where the gluteal muscles insert.',
      pitfall: 'Hip fractures can be subtle on X-ray; check Shenton’s line and the cortex of the neck.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^hip$/,
    {
      look: 'The hip bone: ilium, ischium and pubis, fused at the acetabulum.',
      near: 'Joins the sacrum at the sacroiliac joint and the other hip bone at the pubic symphysis.',
      pitfall: 'The pelvis is a ring — if you find one break, look for a second.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^skull$/,
    {
      look: 'Inner and outer tables of bone with the diploë between them.',
      near: 'Sutures are normal lines between the bones; vascular grooves branch.',
      pitfall: 'Sutures and vascular markings can mimic fractures — fractures are sharper and do not branch.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^bones$/,
    {
      look: 'Bright cortex around a spongy (trabecular) interior; examine it in the bone window.',
      near: 'Check every bone on the scan, not just the area asked about.',
      pitfall: 'Small lytic or sclerotic lesions are invisible in the soft-tissue window.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  // ------------------------------------------------------------- nervous system
  [
    /^spinal_cord$/,
    {
      look: 'Rounded cord inside the spinal canal, surrounded by CSF; much clearer on MRI than CT.',
      near: 'Ends at about L1–L2 (the conus medullaris); nerve roots continue below as the cauda equina.',
      pitfall: 'CT barely separates cord from CSF — use MRI to judge the cord.',
      unit: 'ch22',
      window: 'Soft tissue',
    },
  ],
  [
    /^spinal_canal$/,
    {
      look: 'The bony canal formed by the vertebral bodies in front and the arches behind.',
      near: 'Contains the cord, CSF and nerve roots.',
      pitfall: 'Narrowing from discs, facets and ligaments (stenosis) is judged best on MRI or on the bone window on CT.',
      unit: 'ch22',
      window: 'Bone',
    },
  ],
  [
    /^brain$|^cerebrum$/,
    {
      look: 'Grey matter (cortex and deep nuclei) is slightly denser than white matter on CT and has a different signal on MRI.',
      near: 'The cerebral hemispheres sit above the tentorium; the cerebellum and brainstem below.',
      pitfall: 'Loss of the grey–white difference is an early sign of infarction.',
      unit: 'ch20',
      window: 'Soft tissue',
    },
  ],
  [
    /^brain_ventricles$|^ventricle/,
    {
      look: 'CSF-filled spaces: two lateral ventricles, the third and the fourth ventricle.',
      near: 'The lateral ventricles drain through the third ventricle and the aqueduct to the fourth.',
      pitfall: 'Large ventricles with small sulci suggest hydrocephalus; large ventricles with large sulci suggest volume loss.',
      unit: 'ch20',
      window: 'Soft tissue',
    },
  ],
  // ------------------------------------------------------------- obstetric ultrasound
  [
    /^fetal_head$/,
    {
      look: 'On ultrasound the fetal skull is a bright (echogenic) smooth oval, because bone reflects most of the sound; the brain inside is darker.',
      near: 'Head circumference is measured on an axial plane through the thalami and the cavum septi pellucidi, with an ellipse on the outer edge of the skull.',
      pitfall: 'An oblique plane or an ellipse on the inner edge of the skull gives a wrong head circumference.',
      unit: 'ch18',
      window: 'Soft tissue',
    },
  ],
  // ------------------------------------------------------------- brain (MRI)
  ...brainNote(/^frontal_lobe$/, 'The largest lobe, in front of the central sulcus and above the Sylvian fissure.', 'Behind it the parietal lobe (across the central sulcus), below and behind it the temporal lobe (across the Sylvian fissure).', 'Frontal lesions may cause personality change and, on the dominant side, expressive aphasia; the motor strip is its back edge.'),
  ...brainNote(/^parietal_lobe$/, 'Between the central sulcus in front and the parieto-occipital sulcus behind, above the temporal lobe.', 'The postcentral gyrus (sensory cortex) is its front edge.', 'On axial images the central sulcus is found by its "hand knob" bend in the precentral gyrus just in front of it.'),
  ...brainNote(/^temporal_lobe$/, 'Below the Sylvian fissure, in the middle cranial fossa, with the hippocampus along its inner side.', 'Above it the frontal and parietal lobes; behind it the occipital lobe.', 'Herpes encephalitis and post-traumatic contusions favour the temporal lobes.'),
  ...brainNote(/^occipital_lobe$/, 'The back of each hemisphere, above the tentorium, with the visual cortex along the calcarine sulcus.', 'In front of it the parietal and temporal lobes; below it, across the tentorium, the cerebellum.', 'A posterior cerebral artery infarct affects it and causes a visual field defect.'),
  ...brainNote(/^insula$/, 'Cortex folded deep inside the Sylvian fissure, covered by the frontal, parietal and temporal opercula.', 'The middle cerebral artery branches run over it; the claustrum and putamen lie deep to it.', 'Loss of the insular ribbon (grey and white matter becoming the same density) is an early CT sign of a middle cerebral artery infarct.'),
  ...brainNote(/^cingulate_gyrus$/, 'The gyrus on the inner (medial) surface of each hemisphere that curves around the corpus callosum.', 'The pericallosal branch of the anterior cerebral artery runs between it and the corpus callosum.', 'Subfalcine herniation pushes the cingulate gyrus under the falx to the other side.'),
  ...brainNote(/^precentral_gyrus$/, 'The motor cortex: the gyrus just in front of the central sulcus.', 'Behind it, across the central sulcus, the postcentral gyrus.', 'On high axial slices its "hand knob" (an inverted omega) marks the motor area of the hand.'),
  ...brainNote(/^postcentral_gyrus$/, 'The primary sensory cortex: the gyrus just behind the central sulcus.', 'In front of it, across the central sulcus, the precentral gyrus.', 'It is usually thinner than the precentral gyrus on axial images.'),
  ...brainNote(/^superior_temporal_gyrus$/, 'The top gyrus of the temporal lobe, forming the lower lip of the Sylvian fissure.', 'The transverse temporal gyri (hearing cortex) lie on its upper surface.', 'On the dominant side its back part is Wernicke’s area (receptive language).'),
  ...brainNote(/^lateral_ventricle$/, 'CSF-filled chambers in each hemisphere: dark on T1 and FLAIR, bright on T2 and on the ADC map.', 'The caudate nucleus forms the side wall of the frontal horn; the temporal horn runs along the hippocampus.', 'Enlarged ventricles with normal sulci suggest hydrocephalus; with large sulci, atrophy. Slight asymmetry is normal.'),
  ...brainNote(/^third_ventricle$/, 'A thin midline slit of CSF between the two thalami.', 'Connected to the lateral ventricles by the foramina of Monro and to the fourth ventricle by the cerebral aqueduct.', 'It widens early in hydrocephalus; its walls are the thalami.'),
  ...brainNote(/^fourth_ventricle$/, 'A tent-shaped CSF space behind the pons and medulla, in front of the cerebellum.', 'The aqueduct enters from above; it drains into the cisterns around the brainstem.', 'Effacement by a swollen cerebellum (infarct, haemorrhage) can block the CSF and cause acute hydrocephalus.'),
  ...brainNote(/^caudate_nucleus$/, 'Grey matter that bulges into the frontal horn of the lateral ventricle (its head) and tapers back along it (body and tail).', 'The anterior limb of the internal capsule separates it from the putamen.', 'Its head shrinks in Huntington disease, widening the frontal horns.'),
  ...brainNote(/^putamen$/, 'The outer part of the lentiform nucleus, lateral to the internal capsule.', 'Lateral to it the external capsule, claustrum and insula; medial to it the globus pallidus.', 'The commonest site of hypertensive haemorrhage.'),
  ...brainNote(/^globus_pallidus$/, 'The inner, paler part of the lentiform nucleus, medial to the putamen.', 'The internal capsule runs medial to it.', 'It is damaged symmetrically in carbon monoxide poisoning; it may calcify with age.'),
  ...brainNote(/^thalamus$/, 'Paired grey-matter masses either side of the third ventricle.', 'The posterior limb of the internal capsule lies lateral to it; the midbrain below it.', 'A small infarct here causes a pure sensory stroke; thalamic haemorrhage is a hypertensive bleed.'),
  ...brainNote(/^hippocampus$/, 'A curled strip of grey matter along the floor of the temporal horn of the lateral ventricle.', 'The amygdala lies just in front of it.', 'Shrinkage with a widened temporal horn suggests Alzheimer disease or mesial temporal sclerosis.'),
  ...brainNote(/^amygdala$/, 'An almond-shaped grey-matter nucleus at the front of the medial temporal lobe.', 'Just in front of the hippocampus and the tip of the temporal horn.', 'It is hard to separate from the hippocampus on thick slices.'),
  ...brainNote(/^brainstem$/, 'Midbrain, pons and medulla in the midline, in front of the fourth ventricle and cerebellum.', 'The basilar artery runs on the front of the pons; the cerebellum lies behind.', 'Small brainstem infarcts are easy to miss on CT and are best seen on diffusion MRI.'),
  ...brainNote(/^cerebellum$/, 'The two cerebellar hemispheres in the posterior fossa, below the tentorium, with a finely folded (foliated) cortex.', 'In front of it the fourth ventricle and brainstem; above it, across the tentorium, the occipital lobes.', 'A swollen cerebellar infarct can compress the fourth ventricle and brainstem within hours.'),
];

/** A brain-structure note (MRI and CT, Learning Radiology ch. 26). */
function brainNote(match: RegExp, look: string, near: string, pitfall: string): Array<[RegExp, StructureNote]> {
  return [[match, { look, near, pitfall, unit: 'ch26', window: 'Soft tissue' }]];
}

/** Teaching note for a label's class id (or canonical key); `family` picks the X-ray wording. */
export function noteFor(classIdOrKey: string, family?: string): StructureNote | null {
  // Side-specific notes first (e.g. right vs left atrium), then the note for the structure family.
  const key = canonicalAnatomyKey(classIdOrKey);
  const base = structureBase(key);
  const hit = N.find(([re]) => re.test(key)) ?? N.find(([re]) => re.test(base));
  if (!hit) return null;
  const n = hit[1];
  return family === 'XR' && n.xr ? { ...n, look: n.xr.look, near: n.xr.near ?? n.near, pitfall: n.xr.pitfall ?? n.pitfall } : n;
}
