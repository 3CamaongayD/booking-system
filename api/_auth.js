const crypto = require('crypto');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function checkAdmin(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected || token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function signingSecret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
}

// Player sessions are stateless: "<playerId>.<expiry>.<hmac>". Nothing is
// stored server-side, so a stolen token stays valid until it expires.
function signPlayerToken(playerId) {
  const secret = signingSecret();
  if (!secret) return null;
  const payload = playerId + '.' + (Date.now() + TOKEN_TTL_MS);
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return payload + '.' + sig;
}

function verifyPlayerToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const parts = auth.slice(7).split('.');
  if (parts.length !== 3) return null;

  const secret = signingSecret();
  if (!secret) return null;

  const [playerId, expiry, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(playerId + '.' + expiry).digest('hex');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (!Number(expiry) || Date.now() > Number(expiry)) return null;
  return playerId;
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

module.exports = { checkAdmin, setCors, signPlayerToken, verifyPlayerToken };
