import { z } from 'zod';
import { appOrigin, required } from './config.js';
import { db } from './store.js';
import { random, type Session } from './auth.js';
import { myCertificates, publicCertificate } from './certificates.js';
import { certificateImage } from './certificateShare.js';
import { credentialName, type CertLevel } from '../shared/certificateLevels.js';
import { validCertificateId } from '../shared/credential.js';

/**
 * "Post it for me": the learner allows radiology.monster to post once (LinkedIn's sign-in with the Share on LinkedIn
 * permission), and the server publishes their certificate picture with their text to their feed. The LinkedIn token is
 * used for that one post and never stored. LinkedIn does not let apps add to a profile's Licenses & certifications
 * (that API is for partners it approves), so the learner still saves that section themselves.
 */
export const linkedinReady = () => !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
// LinkedIn supports each monthly API version for about a year.
const apiVersion = () => process.env.LINKEDIN_API_VERSION || '202610';
const redirectUri = () => `${appOrigin()}/api/linkedin/callback`;
const pendingKey = (state: string) => `rvm:li:${state}`;
const TEN_MINUTES = 600;

interface Pending {
  userId: string;
  certId: string;
  text: string;
}

const Start = z.object({ id: z.string().refine(validCertificateId), text: z.string().trim().min(1).max(3000) }).strict();

/** LinkedIn's sign-in page, after the post to make is saved for ten minutes under a one-time state. */
export async function startLinkedInPost(user: Session, body: unknown): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const parsed = Start.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'Write a post of up to 3,000 characters.' };
  const { id, text } = parsed.data;
  if (!(await myCertificates(user)).some((c) => c.id === id && c.status !== 'revoked')) return { ok: false, error: 'You can post only your own valid certificates.' };
  const state = random();
  await db().set<Pending>(pendingKey(state), { userId: user.userId, certId: id, text }, { ex: TEN_MINUTES });
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: required('LINKEDIN_CLIENT_ID'),
    redirect_uri: redirectUri(),
    state,
    scope: 'openid profile w_member_social',
  });
  return { ok: true, url: `https://www.linkedin.com/oauth/v2/authorization?${q}` };
}

/**
 * Where LinkedIn sends the learner back: post, then return to the certificate with the result. The state is used once,
 * and only by the account that started it, so nobody can get someone else's certificate posted.
 */
export async function finishLinkedInPost(url: URL, user: Session | null): Promise<string> {
  const state = url.searchParams.get('state') ?? '';
  const pending = /^[\w-]{43}$/.test(state) ? await db().getdel<Pending>(pendingKey(state)) : null;
  if (!pending) return '/certificates';
  const back = (result: 'posted' | 'cancelled' | 'failed', post?: string) =>
    `/certificate/${pending.certId}?linkedin=${result}${post ? `&post=${encodeURIComponent(post)}` : ''}#add-to-linkedin`;
  if (!user || user.userId !== pending.userId) return back('failed');
  if (url.searchParams.get('error')) return back('cancelled');
  const code = url.searchParams.get('code');
  if (!code) return back('failed');
  try {
    return back('posted', await publish(code, pending));
  } catch (error) {
    // Never log tokens or LinkedIn's answers; the step and status are enough to see what to fix.
    console.error('LinkedIn post failed', error instanceof LinkedInError ? { step: error.step, status: error.status } : { kind: error instanceof Error ? error.name : 'UnknownError' });
    return back('failed');
  }
}

class LinkedInError extends Error {
  constructor(
    readonly step: string,
    readonly status: number,
  ) {
    super(`LinkedIn ${step} failed`);
    this.name = 'LinkedInError';
  }
}

async function call(step: string, input: string, init: RequestInit): Promise<Response> {
  const r = await fetch(input, { ...init, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new LinkedInError(step, r.status);
  return r;
}

/** Sign-in code → token → member → picture upload → post. Returns the post's URN. */
async function publish(code: string, pending: Pending): Promise<string> {
  const cert = await publicCertificate(pending.certId);
  if (!cert || cert.status === 'revoked') throw new LinkedInError('certificate', 404);
  const token = await call('token', 'https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: required('LINKEDIN_CLIENT_ID'),
      client_secret: required('LINKEDIN_CLIENT_SECRET'),
    }),
  }).then((r) => r.json());
  if (typeof token?.access_token !== 'string') throw new LinkedInError('token', 502);
  const auth = { Authorization: `Bearer ${token.access_token}` };
  const rest = { ...auth, 'LinkedIn-Version': apiVersion(), 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' };

  const me = await call('userinfo', 'https://api.linkedin.com/v2/userinfo', { headers: auth }).then((r) => r.json());
  if (typeof me?.sub !== 'string' || !/^[\w-]+$/.test(me.sub)) throw new LinkedInError('userinfo', 502);
  const author = `urn:li:person:${me.sub}`;

  const init = await call('image', 'https://api.linkedin.com/rest/images?action=initializeUpload', {
    method: 'POST',
    headers: rest,
    body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
  }).then((r) => r.json());
  const uploadUrl: unknown = init?.value?.uploadUrl;
  const image: unknown = init?.value?.image;
  // The upload carries the token, so it goes only to LinkedIn.
  if (typeof uploadUrl !== 'string' || typeof image !== 'string' || !/^https:\/\/([\w-]+\.)*linkedin\.com\//.test(uploadUrl)) throw new LinkedInError('image', 502);
  const png = await (await certificateImage(cert, appOrigin(), 'wide')).arrayBuffer();
  await call('upload', uploadUrl, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: png });

  const posted = await call('post', 'https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: rest,
    body: JSON.stringify({
      author,
      commentary: littleText(pending.text),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { id: image, altText: `${cert.name}'s ${credentialName(cert.title, (cert.level ?? 1) as CertLevel)}, issued by radiology.monster` } },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  });
  const id = posted.headers.get('x-restli-id') ?? '';
  return /^urn:li:(share|ugcPost):\d+$/.test(id) ? id : '';
}

/**
 * Plain text in LinkedIn's "little" format: every reserved character escaped, and hashtags (a # at the start of a
 * word) kept as hashtags.
 */
export function littleText(text: string): string {
  return text.replace(/#[\p{L}\p{N}]+|[\\|{}@[\]()<>#*_~]/gu, (m, offset: number, whole: string) => {
    if (m.length === 1) return `\\${m}`;
    return offset === 0 || /\s/.test(whole[offset - 1]) ? `{hashtag|\\#|${m.slice(1)}}` : `\\${m}`;
  });
}
