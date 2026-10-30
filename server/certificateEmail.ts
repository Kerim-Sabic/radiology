import { db } from './store.js';
import { appOrigin } from './config.js';
import { publicCertificate, type Certificate } from './certificates.js';
import { credentialName } from '../shared/certificateLevels.js';
import { linkedinCredentialUrl, verificationUrl } from '../shared/credential.js';
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function certificateMail(c: Certificate) {
  const title = credentialName(c.title, c.level),
    url = verificationUrl(c.id, appOrigin());
  const li = linkedinCredentialUrl({ ...c, title }, appOrigin(), process.env.LINKEDIN_ORG_ID);
  const issued = new Date(c.issuedAt).toISOString().slice(0, 10);
  return {
    subject: `Your ${title} is ready`,
    text: `Congratulations, ${c.name}.\n${title}\nIssuer: radiology.monster\nIssued: ${issued}\nCredential ID: ${c.id}\nVerify and download: ${url}\nAdd to LinkedIn: ${li}\nLinkedIn may require you to copy the details manually.\nUnproctored education; not accredited CME or a professional qualification.`,
    html: `<div style="font:16px Arial,sans-serif;max-width:620px;margin:auto;padding:32px;color:#162033"><h1>Your certificate is ready</h1><p>Congratulations, ${escape(c.name)}.</p><h2>${escape(title)}</h2><p>Issued by radiology.monster on ${issued}</p><p>Credential ID: <b>${c.id}</b></p><p><a href="${escape(url)}">Verify and download your certificate</a></p><p><a href="${escape(li)}">Add to LinkedIn</a></p><p>LinkedIn may ask you to copy the details manually. They are all on your verification page.</p><small>Unproctored education. Not accredited CME or a professional qualification. You requested this email when claiming your certificate.</small></div>`,
  };
}
export async function queueCertificateEmail(c: Certificate, email: string) {
  if (c.status === 'revoked' || (await db().get(`rvm:cert-mail-sent:${c.id}`))) return;
  await db().set(`rvm:cert-mail:${c.id}`, { email, createdAt: Date.now() }, { nx: true, ex: 7 * 86400 });
  await db().sadd('rvm:cert-mail-queue', c.id);
}
export async function sendCertificateEmails(onlyId?: string) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return { sent: 0 };
  const ids = onlyId ? [onlyId] : (await db().smembers<string[]>('rvm:cert-mail-queue')).slice(0, 3);
  let sent = 0;
  for (const id of ids) {
    const job = await db().get<{ email: string; createdAt: number }>(`rvm:cert-mail:${id}`);
    const c = await publicCertificate(id);
    if (!job || !c || c.status === 'revoked' || (await db().get(`rvm:cert-mail-sent:${id}`))) {
      await db().srem('rvm:cert-mail-queue', id);
      continue;
    }
    if (!(await db().set(`rvm:cert-mail-lock:${id}`, '1', { nx: true, ex: 60 }))) continue;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `certificate-${id}`,
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: [job.email],
          ...certificateMail(c),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        await db().set(`rvm:cert-mail-sent:${id}`, true);
        await db().srem('rvm:cert-mail-queue', id);
        await db().del(`rvm:cert-mail:${id}`);
        sent++;
      }
    } catch {
      /* The existing daily cron retries pending completion emails. */
    } finally {
      await db().del(`rvm:cert-mail-lock:${id}`);
    }
  }
  return { sent };
}
