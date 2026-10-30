import { mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { expect, it } from 'vitest';
import { certificatePdf } from '../server/certificatePdf';

it('creates a portable one-page A4 certificate with an embedded QR image and fonts', async () => {
  const bytes = await certificatePdf(
    {
      id: 'RAD-2026-1234567890ABCDEF',
      name: 'DEMO — Amélie Šabić',
      area: 'all',
      level: 3,
      title: 'General Radiology',
      patients: 200,
      judged: 220,
      accuracy: 0.92,
      issuedAt: '2026-10-30T12:00:00Z',
      verification: 'server-graded',
      status: 'active',
    },
    'https://www.radiology.monster',
  );
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getPage(0).getSize()).toEqual({ width: 842, height: 595 });
  expect(doc.getAuthor()).toBe('radiology.monster');
  expect(bytes.length).toBeGreaterThan(10000);
  mkdirSync('test-results/certificates', { recursive: true });
  writeFileSync('test-results/certificates/demo-certificate.pdf', bytes);
  const revoked = await certificatePdf(
    {
      id: 'RAD-2026-1234567890ABCDEF',
      name: 'DEMO — ' + 'A'.repeat(70),
      area: 'chest',
      level: 1,
      title: 'Chest Imaging',
      patients: 10,
      judged: 10,
      accuracy: 0.9,
      issuedAt: '2026-10-30T12:00:00Z',
      status: 'revoked',
    },
    'https://www.radiology.monster',
  );
  writeFileSync('test-results/certificates/demo-revoked.pdf', revoked);
});
