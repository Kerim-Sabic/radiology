export const ISSUER = 'radiology.monster';
export const validCertificateId = (id: string) => /^[\w-]{12}$/.test(id) || /^RAD-\d{4}-[A-F0-9]{16}$/.test(id);
export const verificationUrl = (id: string, origin: string) => `${origin}/verify/${encodeURIComponent(id)}`;
export function linkedinCredentialUrl(c: { id: string; title: string; issuedAt: string }, origin: string, organizationId?: string) {
  const date = new Date(c.issuedAt);
  const q = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: c.title,
    issueYear: String(date.getUTCFullYear()),
    issueMonth: String(date.getUTCMonth() + 1),
    certId: c.id,
    certUrl: verificationUrl(c.id, origin),
  });
  if (organizationId && /^\d+$/.test(organizationId)) q.set('organizationId', organizationId);
  else q.set('organizationName', ISSUER);
  return `https://www.linkedin.com/profile/add?${q}`;
}
