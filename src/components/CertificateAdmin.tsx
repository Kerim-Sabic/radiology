import { useState } from 'react';
import type { IssuedCertificate } from '../services/certificates';

/** Two deliberate steps: look up the exact record, then confirm permanent revocation. */
export function CertificateAdmin() {
  const [id, setId] = useState('');
  const [record, setRecord] = useState<IssuedCertificate | null>(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function act(revoke: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(
        revoke ? '/api/admin/certificates/revoke' : `/api/certificate?id=${encodeURIComponent(id.trim())}`,
        revoke
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: record!.id, reason }),
            }
          : { cache: 'no-store' },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
      setRecord(data.certificate);
      if (revoke) setMessage('Certificate revoked. The public page now shows that it is invalid.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack" aria-labelledby="certificate-admin-title">
      <h2 id="certificate-admin-title">Certificate records</h2>
      <p className="muted">Find a credential before revoking it. Revocation is permanent; the original record remains available for verification.</p>
      <label>
        Credential ID
        <input
          className="input"
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setRecord(null);
            setConfirmed(false);
            setReason('');
          }}
        />
      </label>
      <button className="btn" disabled={busy || !id.trim()} onClick={() => void act(false)}>
        Look up certificate
      </button>
      {record ? (
        <>
          <p>
            <strong>{record.name}</strong> · {record.title} · Level {record.level ?? 1} · {record.status === 'revoked' ? 'Revoked' : 'Active'} ·{' '}
            <a href={`/verify/${record.id}`} target="_blank" rel="noopener noreferrer">
              View public record
            </a>
          </p>
          {record.status !== 'revoked' ? (
            <>
              <label>
                Private reason for revocation
                <textarea className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <label>
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I have checked this record and want to permanently revoke it.
              </label>
              <button className="btn" disabled={busy || !confirmed || reason.trim().length < 5} onClick={() => void act(true)}>
                Revoke this certificate
              </button>
            </>
          ) : null}
        </>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
