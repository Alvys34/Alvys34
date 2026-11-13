// Tiny static server for the audio test page (port 5181). Serves only src/audio/** and
// tools/audio/** from the project root, so it never depends on the rest of the project.
//   node tools/audio/server.mjs            -> http://localhost:5181/tools/audio/test.html
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALLOWED = ['src/audio/', 'tools/audio/'];
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.wav': 'audio/wav', '.css': 'text/css' };

export function startServer(port = 5181) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(ROOT, rel);
      if (!file.startsWith(ROOT + path.sep) || !ALLOWED.some((a) => rel.startsWith(a))) { res.writeHead(404); res.end('not found'); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(data);
      });
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startServer(Number(process.env.PORT) || 5181);
  console.log('audio test server: http://localhost:' + s.address().port + '/tools/audio/test.html');
}
