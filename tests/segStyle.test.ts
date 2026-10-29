import { describe, expect, it } from 'vitest';
import { colorOf, DEFAULT_SEG_STYLE, isDefault, lookOf, parseSegStyle, withAtlasColors, withGroup, withLookAll, withStructure } from '../src/viewer/segStyle';
import { colorFor, GROUP_ORDER, groupFor } from '../src/viewer/anatomyMask';

describe('structure colours and fill', () => {
  it('uses atlas colours until the learner picks one, structure over group over atlas', () => {
    const s0 = DEFAULT_SEG_STYLE;
    expect(colorOf(s0, 'aorta_arch')).toBe(colorFor('aorta_arch'));
    const s1 = withGroup(s0, 'arteries', { color: '#FF0000' });
    expect(colorOf(s1, 'aorta_arch')).toBe('#ff0000');
    expect(colorOf(s1, 'common_carotid_artery_left')).toBe('#ff0000');
    expect(colorOf(s1, 'superior_vena_cava')).toBe(colorFor('superior_vena_cava')); // veins untouched
    const s2 = withStructure(s1, 'aorta_arch', '#00ff00');
    expect(colorOf(s2, 'aorta_arch')).toBe('#00ff00');
    expect(colorOf(s2, 'aorta_ascending')).toBe('#ff0000');
    expect(colorOf(withStructure(s2, 'aorta_arch', null), 'aorta_arch')).toBe('#ff0000');
  });

  it('a new group colour replaces single-structure colours of that group only', () => {
    const s = withStructure(withStructure(DEFAULT_SEG_STYLE, 'aorta_arch', '#00ff00'), 'liver', '#123456');
    const t = withGroup(s, 'arteries', { color: '#ff0000' });
    expect(t.structures).toEqual({ liver: '#123456' });
  });

  it('outline or filled per group, and for every group at once', () => {
    const s = withGroup(DEFAULT_SEG_STYLE, 'arteries', { look: 'fill', color: '#ff0000' });
    expect(lookOf(s, 'arteries')).toBe('fill');
    expect(lookOf(s, 'veins')).toBe('outline');
    const all = withLookAll(s, 'fill');
    expect(GROUP_ORDER.every((g) => lookOf(all, g) === 'fill')).toBe(true);
    expect(colorOf(all, 'aorta')).toBe('#ff0000'); // colours kept
    const none = withLookAll(all, 'outline');
    expect(GROUP_ORDER.every((g) => lookOf(none, g) === 'outline')).toBe(true);
    expect(none.groups).toEqual({ arteries: { color: '#ff0000' } });
    // Clearing both colour and look drops the group entry.
    expect(withGroup(withGroup(s, 'arteries', { look: null }), 'arteries', { color: null }).groups).toEqual({});
  });

  it('atlas colours reset keeps fill choices', () => {
    const s = withStructure(withGroup(DEFAULT_SEG_STYLE, 'veins', { color: '#0000ff', look: 'fill' }), 'liver', '#123456');
    const t = withAtlasColors(s);
    expect(t.groups).toEqual({ veins: { look: 'fill' } });
    expect(t.structures).toEqual({});
    expect(isDefault(DEFAULT_SEG_STYLE)).toBe(true);
    expect(isDefault(t)).toBe(false);
  });

  it('reads a stored style defensively', () => {
    expect(parseSegStyle(null)).toEqual(DEFAULT_SEG_STYLE);
    expect(parseSegStyle('nonsense')).toEqual(DEFAULT_SEG_STYLE);
    const s = parseSegStyle({
      groups: { arteries: { color: '#AA0000', look: 'fill' }, veins: { color: 'red', look: 'zigzag' }, bogus: { color: '#ffffff' } },
      structures: { liver: '#00ff00', spleen: 'javascript:alert(1)' },
      fill: 5,
      line: -2,
    });
    expect(s.groups).toEqual({ arteries: { color: '#aa0000', look: 'fill' } });
    expect(s.structures).toEqual({ liver: '#00ff00' });
    expect(s.fill).toBe(0.8);
    expect(s.line).toBe(1);
  });

  it('groups cover the anatomy in the packs: brain, glands and whole bones have their own groups', () => {
    expect(groupFor('brain')).toBe('brain');
    expect(groupFor('brain_ventricles')).toBe('brain');
    expect(groupFor('spinal_cord')).toBe('brain');
    expect(groupFor('thyroid_gland')).toBe('glands');
    expect(groupFor('adrenal_left')).toBe('glands');
    expect(groupFor('prostate_peripheral_zone')).toBe('glands');
    expect(groupFor('femoral_head_left')).toBe('bones');
    expect(groupFor('bones')).toBe('bones');
    expect(groupFor('finding:pulmonary_embolism')).toBe('findings');
    // Every group's colour is a plain hex the colour picker can show.
    for (const k of ['brain', 'thymus', 'breast', 'gonads', 'fetal_head', 'spinal_canal']) expect(colorFor(k)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
