// Minimal static server for dist/web (npm run serve).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(fileURLToPath(new URL('..', import.meta.url)), 'dist/web');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg', '.cur': 'image/x-icon', '.gif': 'image/gif' };
const port = Number(process.env.PORT ?? 8080);
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  try {
    const data = await readFile(join(dir, path.endsWith('/') ? path + 'index.html' : path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? (path.endsWith('/') ? types['.html'] : 'application/octet-stream') });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, () => console.log(`Visualizing Code: http://localhost:${port}/`));
