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
  return { sub: user.id, provider: 'clerk' as const, email: email.emailAddress.trim().toLowerCase(), emailVerified: true as const,
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || email.emailAddress };
}
