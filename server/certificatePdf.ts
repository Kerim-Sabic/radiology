import { readFileSync } from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import type { Certificate } from './certificates.js';
import { LEVEL_STYLE, credentialName, levelLabel } from '../shared/certificateLevels.js';
import { verificationUrl } from '../shared/credential.js';

/** A portable, searchable PDF with a scannable URL; the live record remains authoritative. */
export async function certificatePdf(c: Certificate, origin: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(credentialName(c.title, c.level));
  pdf.setAuthor('radiology.monster');
  pdf.setSubject('Unaccredited educational course completion');
  // Full font embedding avoids missing glyphs in PDF viewers when these Inter fonts are subset.
  const font = await pdf.embedFont(readFileSync(new URL('./fonts/Inter-Regular.ttf', import.meta.url)));
  const bold = await pdf.embedFont(readFileSync(new URL('./fonts/Inter-SemiBold.ttf', import.meta.url)));
  const page = pdf.addPage([842, 595]);
  const color = LEVEL_STYLE[c.level ?? 1].accent;
  const accent = rgb(parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255);
  const ink = rgb(0.09, 0.13, 0.2),
    muted = rgb(0.35, 0.39, 0.46);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 842,
    height: 595,
    color: rgb(0.98, 0.985, 0.995),
  });
  page.drawRectangle({
    x: 22,
    y: 22,
    width: 798,
    height: 551,
    borderColor: accent,
    borderWidth: 2,
  });
  page.drawRectangle({
    x: 31,
    y: 31,
    width: 780,
    height: 533,
    borderColor: rgb(0.82, 0.86, 0.91),
    borderWidth: 0.6,
  });
  const center = (text: string, y: number, size: number, strong = false, tone = ink) => {
    const f = strong ? bold : font;
    while (f.widthOfTextAtSize(text, size) > 710 && size > 10) size--;
    page.drawText(text, {
      x: (842 - f.widthOfTextAtSize(text, size)) / 2,
      y,
      size,
      font: f,
      color: tone,
    });
  };
  const logo = await pdf.embedPng(readFileSync(new URL('./brand/icon.png', import.meta.url)));
  page.drawImage(logo, { x: 299, y: 508, width: 26, height: 26 });
  page.drawText('radiology.monster', {
    x: 336,
    y: 513,
    size: 22,
    font: bold,
    color: ink,
  });
  center('CERTIFICATE OF COMPLETION', 467, 16, true, accent);
  center('This certifies that', 428, 12, false, muted);
  center(c.name, 380, 34, true);
  center('has completed the study requirements for', 346, 12, false, muted);
  center(c.title, 307, 26, true);
  center(levelLabel(c.level), 279, 15, true, accent);
  center(`${c.patients} patients  |  ${c.judged} graded tasks  |  ${Math.round(c.accuracy * 100)}% correct`, 241, 13);
  center(`Issued ${new Date(c.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })} by radiology.monster`, 208, 11);
  const url = verificationUrl(c.id, origin);
  const qr = await pdf.embedPng(
    await QRCode.toBuffer(url, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
    }),
  );
  page.drawImage(qr, { x: 666, y: 100, width: 96, height: 96 });
  page.drawText('Scan to verify current status', {
    x: 648,
    y: 88,
    size: 8,
    font,
    color: muted,
  });
  page.drawText(`Credential ID: ${c.id}`, {
    x: 65,
    y: 163,
    size: 11,
    font: bold,
    color: ink,
  });
  page.drawText(url, { x: 65, y: 139, size: 10, font, color: accent });
  page.drawText(
    c.verification === 'server-graded' ? 'Completion checked against server-graded study records.' : 'Legacy certificate: completion was reported by the learner’s app.',
    { x: 65, y: 114, size: 10, font, color: muted },
  );
  center('Unproctored education. Not accredited CME, a professional licence, or proof of clinical competence.', 61, 9, false, muted);
  if (c.status === 'revoked') center('REVOKED - NO LONGER VALID', 188, 18, true, rgb(0.72, 0.12, 0.12));
  return pdf.save();
}
