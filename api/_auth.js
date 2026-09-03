const crypto = require('crypto');

const PLAYER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;

function signingSecret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Only /api/admin-auth should ever see the password. Everything else
// authenticates with the session token issued below.
function checkAdminPassword(password) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected || !password) return false;
  return safeEqual(password, expected);
}

function bearer(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

// Tokens are "<id>.<expiry>.<hmac>". The signed message carries a role tag so
// an admin token can never validate as a player token, or vice versa.
function sign(role, id, ttl) {
  const secret = signingSecret();
  if (!secret) return null;
  const expiry = Date.now() + ttl;
  const message = role + ':' + id + ':' + expiry;
  const sig = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return id + '.' + expiry + '.' + sig;
}

function verify(role, token) {
  const secret = signingSecret();
  if (!secret || !token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [id, expiry, sig] = parts;
  const message = role + ':' + id + ':' + expiry;
  const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
  if (!safeEqual(sig, expected)) return null;
  if (!Number(expiry) || Date.now() > Number(expiry)) return null;
  return id;
}

function signAdminToken() {
  return sign('admin', 'adm', ADMIN_TTL_MS);
}

function checkAdmin(req) {
  return verify('admin', bearer(req)) === 'adm';
}

function signPlayerToken(playerId) {
  return sign('player', playerId, PLAYER_TTL_MS);
}

function verifyPlayerToken(req) {
  const id = verify('player', bearer(req));
  return id === 'adm' ? null : id;
}

// Vercel's proxy sets x-real-ip / x-vercel-forwarded-for and clients cannot
// forge them. x-forwarded-for is only a last resort since its leftmost entry
// can be attacker-supplied.
function clientIp(req) {
  return req.headers['x-real-ip']
    || req.headers['x-vercel-forwarded-for']
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || 'unknown';
}

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (origin === 'https://booking.keplerinsightschool.com' || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

module.exports = {
  checkAdmin,
  checkAdminPassword,
  signAdminToken,
  signPlayerToken,
  verifyPlayerToken,
  clientIp,
  setCors
};
