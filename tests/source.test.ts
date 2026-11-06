import { describe, expect, it } from 'vitest';
import { linkTag } from '../src/services/source';

describe('the campaign tag a link carries', () => {
  it('keeps two ads of one campaign apart by utm_content', () => {
    const base = '?task=starter-ct-chest-01%3Aheart&mode=learn&utm_source=meta&utm_medium=paid_social&utm_campaign=131slices';
    expect(linkTag(`${base}&utm_content=A_en`)).toBe('meta:131slices:a_en');
    expect(linkTag(`${base}&utm_content=B_inpkph`)).toBe('meta:131slices:b_inpkph');
  });

  it('reads a link without utm_content as before', () => {
    expect(linkTag('?utm_source=meta&utm_campaign=noarrow_a')).toBe('meta:noarrow_a');
    expect(linkTag('?utm_source=instagram')).toBe('instagram');
    expect(linkTag('?src=newsletter')).toBe('newsletter');
    expect(linkTag('?utm_campaign=find-it')).toBe('ad:find-it');
  });

  it('names the bio link and a Whop ad by their content', () => {
    expect(linkTag('?utm_source=ig&utm_medium=social&utm_content=link_in_bio')).toBe('ig:link_in_bio');
    expect(linkTag('?utm_campaign=131slices&wacid=1&utm_source=facebook&utm_medium=paid_social&utm_content=987654&utm_whop=true')).toBe(
      'facebook:131slices:987654',
    );
  });

  it('has no tag when the link has none, and stays short and clean', () => {
    expect(linkTag('')).toBeNull();
    expect(linkTag('?task=x&mode=learn')).toBeNull();
    expect(linkTag('?utm_source=x')).toBeNull();
    const long = linkTag(`?utm_source=Meta Ads&utm_campaign=${'c'.repeat(80)}&utm_content=x`);
    expect(long?.startsWith('meta-ads:ccc')).toBe(true);
    expect(long?.length).toBe(60);
  });
});
