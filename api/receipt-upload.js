const { getDb } = require('./db');
const { setCors, clientIp, checkAdmin } = require('./_auth');
const { allow } = require('./_ratelimit');
const { createSignedUploadUrl, isConfigured } = require('./_storage');

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Checkout happens before a booking exists, so this cannot require a
  // session. Capped per IP instead so nobody can fill the bucket.
  if (!isConfigured()) return res.status(503).json({ error: 'Storage not configured' });

  const sql = getDb();
  if (!checkAdmin(req)) {
    const ok = await allow(sql, 'receipt-upload:' + clientIp(req), 20, 60);
    if (!ok) return res.status(429).json({ error: 'Too many uploads. Please try again later.' });
  }

  try {
    const out = await createSignedUploadUrl('jpg');
    return res.status(200).json(out);
  } catch (e) {
    console.error('Receipt upload URL error:', e.message);
    return res.status(500).json({ error: 'Could not prepare upload' });
  }
};
