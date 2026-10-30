import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { requestUrl } from '../server/requestUrl';

describe('single-function API routing', () => {
  it.each(['config','session','auth/session','auth/email','auth/callback','billing/checkout','billing/refresh','cron/daily','cron/weekly','email/prefs','email/unsubscribe','og/certificate','certificate','certificate-page','certificates','admin/stats','activity','track','referrals','book','access','logout'])('preserves %s on source and rewritten requests', route => {
    for (const raw of [`/api/${route}?id=abc`, `/api/index?__rvm_path=${route}&id=abc`]) {
      const url=requestUrl(raw,'www.radiology.monster',route);
      expect(url.pathname).toBe(`/api/${route}`);
      expect(url.searchParams.get('id')).toBe('abc');
      expect(url.searchParams.has('__rvm_path')).toBe(false);
    }
  });
  it('preserves OAuth state and code without letting a query change a public API route', () => {
    const url=requestUrl('/api/auth/callback?code=abc&state=xyz&__rvm_path=cron/daily','www.radiology.monster','cron/daily');
    expect(url.href).toBe('https://www.radiology.monster/api/auth/callback?code=abc&state=xyz');
  });
  it('never takes the request origin from the path', () => {
    expect(requestUrl('//evil.test/api/config','www.radiology.monster').origin).toBe('https://www.radiology.monster');
    expect(requestUrl('https://evil.test/api/config','www.radiology.monster').origin).toBe('https://www.radiology.monster');
  });
  it('preserves the public certificate route and preview parameters', () => {
    expect(requestUrl('/verify/RAD-2026-1234567890ABCDEF','www.radiology.monster').href).toBe('https://www.radiology.monster/api/certificate-page?id=RAD-2026-1234567890ABCDEF');
    expect(requestUrl('/certificate/cert123?format=square','www.radiology.monster').href).toBe('https://www.radiology.monster/api/certificate-page?format=square&id=cert123');
  });
  it.each(['../config','https://evil.test','//config',['config','session']])('rejects malformed internal route %s', route => {
    expect(requestUrl('/api/index','www.radiology.monster',route).pathname).toBe('/api/not-found');
  });
  it('keeps one deployed API function and leaves analytics out of the SPA rewrite', () => {
    const files=readdirSync('api',{recursive:true}).filter(name=>String(name).endsWith('.ts'));
    expect(files).toEqual(['index.ts']);
    const config=JSON.parse(readFileSync('vercel.json','utf8'));
    const fallback=config.rewrites.find((r:{destination:string})=>r.destination==='/index.html');
    const pattern=new RegExp(`^${fallback.source}$`);
    expect(pattern.test('/_vercel/insights/script.js')).toBe(false);
    expect(pattern.test('/read/abc')).toBe(true);
  });
});
