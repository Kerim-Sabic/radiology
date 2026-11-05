import { createClerkClient, verifyToken } from '@clerk/backend';
import { appOrigin, required } from './config.js';

export async function clerkIdentity(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([\w.-]+)$/)?.[1];
  if (!token) throw new Error('Sign in required');
  const secretKey = required('CLERK_SECRET_KEY');
  const claims = await verifyToken(token, { secretKey, authorizedParties: [appOrigin(), new URL(request.url).origin] });
  if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string' || claims.sts === 'pending') throw new Error('Complete sign-in first');
  const client = createClerkClient({ secretKey });
  const [user, session] = await Promise.all([client.users.getUser(claims.sub), client.sessions.getSession(claims.sid)]);
  if (session.status !== 'active' || session.userId !== user.id || user.banned || user.locked) throw new Error('Session is no longer active');
  const email = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
  if (!email || email.verification?.status !== 'verified') throw new Error('Verify your email first');
  return { sub: user.id, sid: session.id, provider: 'clerk' as const, email: email.emailAddress.trim().toLowerCase(), emailVerified: true as const,
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || email.emailAddress };
}

/**
 * Ends every Clerk sign-in of this user except `keep`. Our own session already allows one device at a time, but a
 * browser Clerk still remembers could get back in with one click; now it needs a fresh code from the account's inbox.
 */
export async function revokeOtherClerkSessions(userId: string, keep: string) {
  const client = createClerkClient({ secretKey: required('CLERK_SECRET_KEY') });
  const list = await client.sessions.getSessionList({ userId, status: 'active', limit: 100 });
  await Promise.all(list.data.filter((s) => s.id !== keep).map((s) => client.sessions.revokeSession(s.id)));
}
