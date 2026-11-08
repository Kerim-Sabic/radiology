import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AI_CREDIT, MAKER } from '../src/lib/provenance';
import { MadeBy, MakerLine } from '../src/components/MadeBy';

const root = join(__dirname, '..');
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;|&#39;/g, "'").trim();

describe('made by Horalix', () => {
  it('ships Horalix’s own mark from horalix.com, light and dark, small enough for every page', () => {
    for (const logo of [MAKER.logoOnDark, MAKER.logoOnLight]) {
      const file = join(root, 'public', logo);
      expect(statSync(file).size).toBeLessThanOrEqual(20 * 1024);
      expect(readFileSync(file).subarray(1, 4).toString()).toBe('PNG');
    }
  });

  it('says the same sentence wherever the about line appears', () => {
    expect(text(renderToStaticMarkup(createElement(MakerLine)))).toBe(MAKER.line);
  });

  it('links "Made by Horalix.com" to horalix.com in a new tab, with the mark as decoration', () => {
    const html = renderToStaticMarkup(createElement(MadeBy));
    expect(html).toContain(`href="${MAKER.url}"`);
    expect(html).toContain('rel="noopener"');
    expect(html).toContain('alt=""');
    expect(text(html).replace(/\s+/g, ' ')).toBe('Made by Horalix.com');
  });

  it('keeps the anatomy credit, which agrees with "made by" (Horalix makes the app and drew the outlines)', () => {
    expect(AI_CREDIT.url).toBe(MAKER.url);
    expect(AI_CREDIT.text).toBe('Thanks to Horalix.com, every structure in the anatomy layer is marked.');
  });
});
