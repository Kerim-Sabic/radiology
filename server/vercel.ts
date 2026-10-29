import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handle } from './handler.js';
import { requestUrl } from './requestUrl.js';

export const config = { api: { bodyParser: false } };

export default async function api(req: VercelRequest, res: VercelResponse) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) { res.status(413).end(); return; }
    chunks.push(buffer);
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const request = new Request(requestUrl(req.url || '/', req.headers.host || 'localhost', req.query.__rvm_path), {
    method: req.method, headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });
  const response = await handle(request);
  res.status(response.status);
  response.headers.forEach((value, key) => { if (key !== 'set-cookie') res.setHeader(key, value); });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}
