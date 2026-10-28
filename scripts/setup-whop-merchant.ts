// Run locally with: npx tsx --env-file=.env.local scripts/setup-whop-merchant.ts
// Opens a one-time, limited-scope merchant authorization. Never logs credentials.
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { exchange, identity, encrypt } from '../server/oauth.js';
import { db } from '../server/store.js';
import { required } from '../server/config.js';

const state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
const redirect = 'http://localhost:13338/callback';
const params = new URLSearchParams({ client_id: required('WHOP_APP_ID'), response_type: 'code', redirect_uri: redirect,
  scope: 'openid profile email company:basic:read member:basic:read member:manage payment:basic:read plan:basic:read checkout_configuration:create',
  company_id: required('WHOP_ACCOUNT_ID'), state, nonce,
  code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
writeFileSync('../whop-merchant-login-url.txt', `https://api.whop.com/oauth/authorize?${params}`);
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', redirect);
  if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
  try {
    const received = url.searchParams.get('state') || '';
    if (received.length !== state.length || !timingSafeEqual(Buffer.from(received), Buffer.from(state)) || !url.searchParams.get('code')) throw new Error('Invalid authorization state');
    const tokens = await exchange({ grant_type: 'authorization_code', code: url.searchParams.get('code')!, redirect_uri: redirect, code_verifier: verifier });
    const profile = await identity(tokens, nonce);
    if (profile.sub !== required('WHOP_OWNER_USER_ID')) throw new Error('Please authorize using the business owner account');
    await db().set('rvm:merchant', encrypt(tokens));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<h1>Radiology payments connected</h1><p>You can close this window. No payment was made.</p>');
    console.log('Merchant authorization saved securely.');
    server.close();
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Authorization failed. Return to Codex to retry.');
    console.error(error instanceof Error ? error.message : 'Authorization failed');
  }
});
server.listen(13338, '127.0.0.1', () => console.log('Waiting for Whop authorization in the browser.'));
setTimeout(() => { console.error('Authorization timed out.'); server.close(); }, 15 * 60 * 1000).unref();
