// Small single-process account store. The workspace-mounted JSON files persist
// across restarts/deploys; use a database if the app grows beyond one process.
const crypto = require('crypto');
const { promisify } = require('util');
const store = require('./store');
const scrypt = promisify(crypto.scrypt);
const TTL = 30 * 24 * 60 * 60 * 1000;
const attempts = new Map();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const userView = user => ({ id: user.id, email: user.email });

function cookie(req) {
  const part = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('lr_session='));
  return part ? part.slice('lr_session='.length) : '';
}
function setCookie(req, res, token, maxAge) {
  const secure = req.socket.encrypted || (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  res.setHeader('Set-Cookie', `lr_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}
function current(req) {
  const token = cookie(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const session = store.read('sessions').find(s => s.tokenHash === hash(token) && s.expires > Date.now());
  return session ? store.read('accounts').find(u => u.id === session.userId) || null : null;
}
function requireUser(req) { const user = current(req); if (!user) fail(401, 'Please sign in.'); return user; }
function loginSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = store.read('sessions').filter(s => s.expires > Date.now());
  sessions.push({ tokenHash: hash(token), userId: user.id, expires: Date.now() + TTL });
  store.write('sessions', sessions);
  setCookie(req, res, token, TTL / 1000);
}
function checkOrigin(req) {
  // SameSite cookies and a same-origin check protect authenticated writes.
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { fail(403, 'Invalid origin.'); }
    if (host !== req.headers.host) fail(403, 'Invalid origin.');
  }
}
function credentials(body) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
  if (password.length < 8 || Buffer.byteLength(password) > 1024) fail(400, 'Password must be at least 8 characters.');
  return { email, password };
}
function limit(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  for (const [key, value] of attempts) if (value.reset <= now) attempts.delete(key);
  const entry = attempts.get(ip) || { count: 0, reset: now + 15 * 60 * 1000 };
  if (++entry.count > 30) fail(429, 'Too many attempts. Try again later.');
  attempts.set(ip, entry);
}
module.exports = (readBody, json) => ({
  'POST /api/auth/signup': async (req, res) => {
    checkOrigin(req); limit(req);
    const { email, password } = credentials(await readBody(req));
    if (store.read('accounts').some(u => u.email === email)) fail(409, 'An account with that email already exists.');
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = (await scrypt(password, salt, 64)).toString('hex');
    const accounts = store.read('accounts');
    if (accounts.some(u => u.email === email)) fail(409, 'An account with that email already exists.');
    const user = { id: crypto.randomUUID(), email, salt, passwordHash: derived };
    accounts.push(user); store.write('accounts', accounts);
    loginSession(req, res, user); json(res, { user: userView(user) }, 201);
  },
  'POST /api/auth/login': async (req, res) => {
    checkOrigin(req); limit(req);
    const { email, password } = credentials(await readBody(req));
    const user = store.read('accounts').find(u => u.email === email);
    const derived = await scrypt(password, user?.salt || '00000000000000000000000000000000', 64);
    const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64);
    if (!user || expected.length !== derived.length || !crypto.timingSafeEqual(expected, derived)) fail(401, 'Incorrect email or password.');
    loginSession(req, res, user); json(res, { user: userView(user) });
  },
  'POST /api/auth/logout': (req, res) => {
    checkOrigin(req);
    const token = cookie(req);
    if (token) store.write('sessions', store.read('sessions').filter(s => s.tokenHash !== hash(token)));
    setCookie(req, res, '', 0); json(res, { ok: true });
  },
  'GET /api/auth/me': (req, res) => { const user = current(req); json(res, { user: user ? userView(user) : null }); },
  'GET /api/users': (req, res) => {
    const user = requireUser(req);
    const email = new URL(req.url, 'http://localhost').searchParams.get('q')?.trim().toLowerCase() || '';
    if (!email || email.length > 254) return json(res, { users: [] });
    const match = store.read('accounts').find(u => u.email === email && u.id !== user.id);
    json(res, { users: match ? [userView(match)] : [] });
  },
  'GET /api/room': (req, res) => {
    const user = requireUser(req);
    json(res, { room: store.read('last-rooms', {})[user.id] || null });
  },
  'PUT /api/room': async (req, res) => {
    checkOrigin(req); const user = requireUser(req); const body = await readBody(req);
    const room = body.room;
    if (!room || typeof room.code !== 'string' || !/^[A-Za-z0-9]{6}$/.test(room.code) || !Array.isArray(room.messages) || room.messages.length > 500) fail(400, 'Invalid room or message history.');
    const messages = room.messages.map(m => {
      if (!m || typeof m.id !== 'string' || m.id.length > 100 || typeof m.sender !== 'string' || m.sender.length > 100 || typeof m.text !== 'string' || m.text.length > 2000 || !Number.isFinite(m.time) || !Number.isFinite(m.order)) fail(400, 'Invalid message.');
      return { id: m.id, sender: m.sender, text: m.text, time: m.time, order: m.order };
    });
    const rooms = store.read('last-rooms', {});
    rooms[user.id] = { code: room.code.toUpperCase(), messages };
    store.write('last-rooms', rooms); json(res, { room: rooms[user.id] });
  },
});
