// Zero-dependency server: static files from public/, JSON API from the
// `routes` table below. No npm install needed, so the first build is fast.
// Add express later if you actually need it.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// ── API routes ────────────────────────────────────────────────────────
// Key is "METHOD /path". Handlers get (req, res) and may be async.
// Anything not matched here falls through to the static files in public/.
//
//   const store = require('./lib/store');
//   'GET /api/items':  (req, res) => json(res, store.read('items')),
//   'POST /api/items': async (req, res) => {
//     const item = await readBody(req);
//     json(res, store.write('items', [...store.read('items'), item]), 201);
//   },
const routes = {
  'GET /health': (req, res) => json(res, { status: 'ok', uptime: process.uptime() }),
};

function json(res, data, status = 200) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// Big enough for a phone photo sent as base64 JSON (a 5 MB photo is ~7 MB
// encoded); still a cap, so one bad request can't exhaust memory. Shrink
// photos in the browser before upload (public/shrink-photo.js) rather than
// raising this.
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Parse a JSON request body: `const data = await readBody(req)`. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let tooLarge = false;
    // Decode as a stream: per-chunk decoding splits a multi-byte character
    // (any non-English text) that straddles two chunks into garbage.
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (tooLarge) return;
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) {
        // Reject with a status instead of destroying the socket: a dropped
        // connection reaches the person as a vague "could not post", a 413
        // lets the page say the file is too big.
        tooLarge = true;
        raw = '';
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function sendFile(res, file, data) {
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(data);
}

/**
 * Decode a URL path, or null when the client sent broken percent-encoding.
 *
 * decodeURIComponent THROWS on a malformed escape ('/%E0%A4%A'), and any
 * crawler or fuzzer sends those eventually. Unhandled, it took the whole app
 * down: one bad URL, process exits, the user's site is dead until something
 * restarts it. A truncated escape is a bad request, not a server fault, so it
 * gets a 400 and the server stays up.
 */
function safeDecode(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function serveStatic(req, res, pathname) {
  const decoded = pathname === '/' ? 'index.html' : safeDecode(pathname);
  if (decoded === null) return json(res, { error: 'Bad request' }, 400);
  const rel = decoded.replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  // Keep resolved paths inside public/ so `..` can't escape the web root.
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return json(res, { error: 'Not found' }, 404);

  fs.readFile(file, (err, data) => {
    if (!err) return sendFile(res, file, data);
    // Extensionless miss = a client-side route; hand back the entry page.
    if (path.extname(rel)) return json(res, { error: 'Not found' }, 404);
    const entry = path.join(PUBLIC, 'index.html');
    fs.readFile(entry, (e, html) => (e ? json(res, { error: 'Not found' }, 404) : sendFile(res, entry, html)));
  });
}

http.createServer(async (req, res) => {
  // EVERY path is inside the try, including static files. It used to early-
  // return into serveStatic before the boundary, so anything that threw there
  // was an uncaught exception and killed the process instead of failing one
  // request.
  let pathname = req.url || '/';
  try {
    ({ pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`));
    const handler = routes[`${req.method} ${pathname}`];
    if (handler) await handler(req, res);
    else serveStatic(req, res, pathname);
  } catch (err) {
    console.error(`${req.method} ${pathname} failed:`, err.message);
    if (res.headersSent) return;
    if (err.status === 413) json(res, { error: 'Too large: the limit is 10 MB. Try a smaller photo.' }, 413);
    else if (err.status === 400) json(res, { error: err.message }, 400);
    else json(res, { error: 'Server error' }, 500);
  }
}).listen(PORT, () => console.log(`Listening on port ${PORT}`));
