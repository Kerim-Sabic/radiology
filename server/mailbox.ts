import { createHash } from 'node:crypto';

/** One mailbox, however it is written: lower case, and for Gmail without dots or a +tag. */
export function mailbox(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  const [local, domain] = [e.slice(0, at), e.slice(at + 1)];
  return domain === 'gmail.com' || domain === 'googlemail.com' ? `${local.split('+')[0].replaceAll('.', '')}@gmail.com` : e;
}

/** SHA-256 of the mailbox, so this public repository and the store keys do not spell out addresses. */
export const mailboxKey = (email: string) => createHash('sha256').update(mailbox(email)).digest('hex');

/**
 * The sender of every email the site sends: always shown as "Radiology Monster", at the address in EMAIL_FROM
 * (which may be written "Name <address>" or just "address"). Null when EMAIL_FROM is not set.
 */
export function mailFrom(): string | null {
  const raw = process.env.EMAIL_FROM?.trim();
  if (!raw) return null;
  const address = /<([^<>\s]+@[^<>\s]+)>/.exec(raw)?.[1] ?? raw;
  return /^[^<>\s"]+@[^<>\s"]+$/.test(address) ? `Radiology Monster <${address}>` : raw;
}
