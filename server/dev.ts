/**
 * Local server: serves /api with the same handler Vercel runs, plus the Vite dev
 * server (default) or the built files in dist/ (--prod).
 */
import '../scripts/env.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createApp } from './http/app.js';

const prod = process.argv.includes('--prod');
const port = Number(process.env.PORT ?? 3000);
const app = createApp();

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json',
};

async function api(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 10_000) return void res.writeHead(413).end();
    chunks.push(c as Buffer);
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  headers.set('x-real-ip', req.socket.remoteAddress ?? 'local');
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const response = await app(new Request(new URL(req.url!, `http://localhost:${port}`), { method: req.method, headers, body }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** Apply the production security headers from vercel.json so CSP issues show locally. */
const securityHeaders: [string, string][] = prod
  ? JSON.parse(readFileSync('vercel.json', 'utf8')).headers[0].headers.map((h: { key: string; value: string }) => [h.key, h.value])
  : [];

async function statics(req: IncomingMessage, res: ServerResponse) {
  const root = join(process.cwd(), 'dist');
  const path = normalize(decodeURIComponent(new URL(req.url!, 'http://x').pathname));
  let file = join(root, path);
  let data: Buffer | null = null;
  if (file.startsWith(root) && extname(file)) data = await readFile(file).catch(() => null);
  if (!data && !extname(path)) data = await readFile((file = join(root, 'index.html'))).catch(() => null);
  if (!data) return void res.writeHead(404).end('Not found');
  for (const [k, v] of securityHeaders) res.setHeader(k, v);
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(data);
}

const vite = prod
  ? null
  : await (await import('vite')).createServer({ server: { middlewareMode: true }, appType: 'spa' });

createServer((req, res) => {
  const fail = (e: unknown) => {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  };
  if (req.url?.startsWith('/api/')) return void api(req, res).catch(fail);
  if (vite) return void vite.middlewares(req, res);
  statics(req, res).catch(fail);
}).listen(port, () => console.log(`AZ Finance Intelligence → http://localhost:${port} (${prod ? 'production build' : 'dev'})`));
