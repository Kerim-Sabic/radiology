"""Quality rules for the anatomy atlas (coordinator rules 1-6, 2026-10-27). Pure functions / tables, no I/O.

Rule 1 fragments : 3D 26-connected components per class; keep only the largest, except naturally multipart classes
                   (MULTIPART: max number of components kept); any kept extra component must be >= 5 % of the
                   class volume. costal_cartilages consist of ~20 separate cartilages by anatomy, so for that class
                   components >= 0.5 ml are kept (documented exception). Per slice, rings (components / holes)
                   < 10 mm2 are dropped (CT); < 0.2 % of the image area (CXR). No morphological smoothing.
Rule 2 density   : median HU of the published voxels on the original CT, by class group (density_rule):
                   ribs / vertebrae / sternum / sacrum >= 100 and humerus / femur >= 100 (owner decision), other bones >= 150;
                   SVC, brachiocephalic veins and pulmonary trunk / arteries [-50, 3000] in contrast studies; air (lung lobes, trachea) <= -300; soft tissue / organ / muscle in [-50, 250];
                   vessels, kidneys, heart in [-50, 250] without contrast, [-50, 450] in contrast studies.
Rule 3 coverage  : a structure whose mask reaches the first/last slice (boundary slice area >= 10 % of its largest
                   slice) or the in-plane image edge is "partially imaged"; it is dropped if its volume is < 20 % of the
                   typical volume of that class (median volume of the complete instances in this dataset), else its
                   label gets " (partially imaged)". Without a complete reference instance it is kept and labelled.
Rule 4 order     : every *_left/*_right pair compared per shared slice (centroid LPS x, >= 5 mm2 each) and by 3D
                   centroid; ribs per slice on the correct side of the midline (spinal cord / vertebra centroid on that
                   slice); lateral organs/bones/muscles by 3D centroid vs midline; vertebrae C1..S1 must be strictly
                   craniocaudal in LPS z (structures outside the longest consistent sequence are dropped).
"""
from __future__ import annotations

import re

MULTIPART = {
    "lung_upper_lobe_left": 2, "lung_lower_lobe_left": 2, "lung_upper_lobe_right": 2, "lung_middle_lobe_right": 2,
    "lung_lower_lobe_right": 2, "colon": 4, "small_bowel": 8, "duodenum": 2, "pulmonary_vein": 4,
    "portal_vein_and_splenic_vein": 2, "kidney_cyst_left": 4, "kidney_cyst_right": 4,
    "thyroid_gland": 2,  # two lobes; the isthmus is often too thin to connect them
}
COSTAL_MIN_ML = 0.5
FRAGMENT_MIN_FRACTION = 0.05
CT_MIN_RING_MM2 = 10.0
CXR_MIN_RING_FRACTION = 0.002
CXR_MIN_AREA_FRACTION = 0.001

BONE = re.compile(r"^(vertebrae_|rib_|sacrum$|sternum$|humerus_|scapula_|clavicula_|femur_|hip_|skull$)")
LONG_BONE = re.compile(r"^(humerus_|femur_)")
# owner decision 2026-10-27: ribs, vertebrae, sternum and sacrum use 100 HU (older non-contrast patients keep them)
LOW_BONE = re.compile(r"^(vertebrae_|rib_|sternum$|sacrum$)")
# veins carrying undiluted contrast and the pulmonary arteries of CT angiograms may be very dense
INTRAPULMONARY_ARTERY = re.compile(r"^pulmonary_arteries_(left|right)_(upper|middle|lower)_lobe$")
DENSE_CONTRAST = re.compile(r"^(superior_vena_cava|brachiocephalic_vein_(left|right)|pulmonary_trunk|pulmonary_artery_(left|right)|"
                            r"heart_atrium_(left|right)|heart_ventricle_(left|right))$")
AIR = re.compile(r"^(lung_(upper|middle|lower)_lobe_|trachea$|main_bronchus_)")
SOFT = re.compile(r"^(liver|spleen|pancreas|gallbladder|adrenal_gland_.*|thyroid_gland|prostate|brain|spinal_cord|heart_myocardium|"
                  r"gluteus_.*|autochthon_.*|iliopsoas_.*|kidney_cyst_.*)$")
ENHANCING = re.compile(r"^(kidney_left|kidney_right|heart|atrial_appendage_left|aorta|aorta_\w+|pulmonary_vein|brachiocephalic_trunk|"
                       r"subclavian_artery_.*|common_carotid_artery_.*|brachiocephalic_vein_.*|superior_vena_cava|"
                       r"inferior_vena_cava|portal_vein_and_splenic_vein|iliac_artery_.*|iliac_vena_.*)$")


def density_rule(name: str, median_hu: float, contrast: bool):
    """Returns (group, ok, allowed-range text)."""
    if LONG_BONE.match(name):
        # long bones contain a fatty marrow cavity: median of the whole bone is lower than for ribs / vertebrae
        return "long bone", median_hu >= 100, ">= 100"
    if LOW_BONE.match(name):
        return "bone (rib / vertebra / sternum / sacrum)", median_hu >= 100, ">= 100"
    if BONE.match(name):
        return "bone", median_hu >= 150, ">= 150"
    if AIR.match(name):
        return "air", median_hu <= -300, "<= -300"
    if INTRAPULMONARY_ARTERY.match(name):
        # small vessels inside aerated lung: partial volume with air lowers the median, hence -300
        hi = 3000 if contrast else 250
        return ("intrapulmonary artery" + (" (contrast)" if contrast else "")), -300 <= median_hu <= hi, f"[-300, {hi}]"
    if DENSE_CONTRAST.match(name):
        hi = 3000 if contrast else 250
        return ("vein / pulmonary artery" + (" (contrast)" if contrast else "")), -50 <= median_hu <= hi, f"[-50, {hi}]"
    if ENHANCING.match(name):
        hi = 450 if contrast else 250
        return ("vessel/kidney/heart" + (" (contrast)" if contrast else "")), -50 <= median_hu <= hi, f"[-50, {hi}]"
    if SOFT.match(name):
        return "soft tissue", -50 <= median_hu <= 250, "[-50, 250]"
    return "not checked", True, "n/a (hollow / mixed-content organ or cartilage)"


MIDLINE_LATERAL = re.compile(r"^(kidney_(left|right)|adrenal_gland_(left|right)|lung_(upper|middle|lower)_lobe_(left|right)|"
                             r"clavicula_(left|right)|scapula_(left|right)|humerus_(left|right)|femur_(left|right)|hip_(left|right)|"
                             r"gluteus_\w+_(left|right)|iliopsoas_(left|right)|autochthon_(left|right)|"
                             r"pulmonary_arteries_(left|right)_(upper|middle|lower)_lobe|atrial_appendage_left|kidney_cyst_(left|right))$")
RIB = re.compile(r"^rib_(left|right)_\d+$")
VERTEBRA_ORDER = ([f"vertebrae_C{i}" for i in range(1, 8)] + [f"vertebrae_T{i}" for i in range(1, 13)] +
                  [f"vertebrae_L{i}" for i in range(1, 6)] + ["vertebrae_S1"])


def side_of(name: str):
    if "_left" in name or name.startswith("left"):
        return "left"
    if "_right" in name:
        return "right"
    return None


def longest_decreasing(names_z):
    """names_z: [(name, z)] in anatomical (cranial->caudal) order. Returns the set of names in the longest strictly
    decreasing-z subsequence (LPS z points superior, so caudal structures must have smaller z)."""
    n = len(names_z)
    best = [1] * n
    prev = [-1] * n
    for i in range(n):
        for j in range(i):
            if names_z[j][1] > names_z[i][1] and best[j] + 1 > best[i]:
                best[i], prev[i] = best[j] + 1, j
    if not n:
        return set()
    i = max(range(n), key=lambda t: best[t])
    keep = set()
    while i != -1:
        keep.add(names_z[i][0])
        i = prev[i]
    return keep


# ---------------------------------------------------------------- labels (rule 6: plain anatomical names)
LABELS = {
    "spleen": "Spleen", "liver": "Liver", "gallbladder": "Gallbladder", "stomach": "Stomach", "pancreas": "Pancreas",
    "esophagus": "Esophagus", "trachea": "Trachea", "thyroid_gland": "Thyroid gland", "small_bowel": "Small bowel",
    "duodenum": "Duodenum", "colon": "Colon", "urinary_bladder": "Urinary bladder", "prostate": "Prostate",
    "sacrum": "Sacrum", "heart": "Heart", "aorta": "Aorta", "pulmonary_vein": "Pulmonary veins",
    "pulmonary_artery": "Pulmonary arteries", "main_bronchus_left": "Left main bronchus", "main_bronchus_right": "Right main bronchus",
    "brachiocephalic_trunk": "Brachiocephalic trunk (innominate artery)", "superior_vena_cava": "Superior vena cava",
    "inferior_vena_cava": "Inferior vena cava", "portal_vein_and_splenic_vein": "Portal and splenic veins",
    "atrial_appendage_left": "Left atrial appendage", "spinal_cord": "Spinal cord", "brain": "Brain", "skull": "Skull",
    "sternum": "Sternum", "costal_cartilages": "Costal cartilages",
    "aorta_ascending": "Ascending aorta", "aorta_arch": "Aortic arch", "aorta_descending_thoracic": "Descending thoracic aorta",
    "aorta_abdominal": "Abdominal aorta", "pulmonary_trunk": "Pulmonary trunk (main pulmonary artery)",
    "pulmonary_artery_right": "Right pulmonary artery", "pulmonary_artery_left": "Left pulmonary artery",
    "heart_atrium_right": "Right atrium", "heart_atrium_left": "Left atrium", "heart_ventricle_right": "Right ventricle",
    "heart_ventricle_left": "Left ventricle", "heart_myocardium": "Left ventricular myocardium",
    "pulmonary_arteries_right_upper_lobe": "Right upper lobe arteries (lobar and segmental)",
    "pulmonary_arteries_right_middle_lobe": "Right middle lobe arteries (lobar and segmental)",
    "pulmonary_arteries_right_lower_lobe": "Right lower lobe arteries (lobar and segmental)",
    "pulmonary_arteries_left_upper_lobe": "Left upper lobe arteries, incl. lingula (lobar and segmental)",
    "pulmonary_arteries_left_lower_lobe": "Left lower lobe arteries (lobar and segmental)", "colon_ascending": "Cecum and ascending colon", "colon_transverse": "Transverse colon",
    "colon_descending": "Descending colon", "colon_sigmoid": "Sigmoid colon", "rectum": "Rectum",
    # radiograph classes
    "lung_left": "Left lung", "lung_right": "Right lung", "hilum_left": "Left hilum", "hilum_right": "Right hilum",
    "diaphragm": "Diaphragm", "mediastinum": "Mediastinum", "spine": "Spine",
}
SIDE_BASE = {
    "kidney": "kidney", "adrenal_gland": "adrenal gland", "kidney_cyst": "kidney cyst", "humerus": "humerus",
    "scapula": "scapula", "clavicula": "clavicle", "femur": "femur", "hip": "hip bone",
    "gluteus_maximus": "gluteus maximus", "gluteus_medius": "gluteus medius", "gluteus_minimus": "gluteus minimus",
    "autochthon": "erector spinae", "iliopsoas": "iliopsoas", "iliac_artery": "common iliac artery",
    "iliac_vena": "common iliac vein", "subclavian_artery": "subclavian artery", "common_carotid_artery": "common carotid artery",
    "brachiocephalic_vein": "brachiocephalic vein",
}


def clean_label(name: str) -> str:
    if name in LABELS:
        return LABELS[name]
    m = re.match(r"^rib_(left|right)_(\d+)$", name)
    if m:
        return f"Rib {m.group(2)} {m.group(1)}"
    m = re.match(r"^vertebrae_([CTLS]\d+)$", name)
    if m:
        return f"{m.group(1)} vertebra"
    m = re.match(r"^lung_(upper|middle|lower)_lobe_(left|right)$", name)
    if m:
        return f"{m.group(2).capitalize()} {m.group(1)} lobe"
    m = re.match(r"^(.+)_(left|right)$", name)
    if m and m.group(1) in SIDE_BASE:
        return f"{m.group(2).capitalize()} {SIDE_BASE[m.group(1)]}"
    return name.replace("_", " ").capitalize()
