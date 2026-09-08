// Local preview only. Resolve both lexical and real paths before reading.
import { createServer } from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, extname } from 'node:path';

// Everything below is served with nosniff, so a type missing from this map is
// not a guess by the browser - it is a refusal. An .mjs module script came back
// as application/octet-stream and never ran, and the sky's GLB would have too.
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.txt': 'text/plain' };
function inside(root, file) {
  const rel = relative(root, file);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'));
}
export function startServer(dir, port) {
  const root = realpathSync(resolve(dir));
  const server = createServer((req, res) => {
    const fail = (status) => { res.writeHead(status); res.end(); };
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return fail(405); }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replaceAll('\\', '/');
      if (pathname.includes('\0')) return fail(400);
    } catch { return fail(400); }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const candidate = resolve(root, '.' + pathname);
    if (!inside(root, candidate)) return fail(404);
    try {
      const file = realpathSync(candidate);
      if (!inside(root, file) || !statSync(file).isFile()) return fail(404);
      const body = req.method === 'HEAD' ? null : readFileSync(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
    } catch { fail(404); }
  });
  server.listen(port, '127.0.0.1');
  server.unref();
  return server;
}
