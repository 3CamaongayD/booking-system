const { setCors, checkAdmin } = require('./_auth');
const { createSignedDownloadUrl, isConfigured } = require('./_storage');

// Paths are UUID + extension, generated server-side. Anchored so no caller
// can walk out of the bucket with traversal segments.
const SAFE_PATH = /^[A-Za-z0-9-]{1,64}\.[A-Za-z0-9]{1,8}$/;

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!isConfigured()) return res.status(503).json({ error: 'Storage not configured' });

  const path = String((req.body && req.body.path) || '');
  if (!SAFE_PATH.test(path)) return res.status(400).json({ error: 'Invalid path' });

  try {
    const url = await createSignedDownloadUrl(path, 300);
    return res.status(200).json({ url });
  } catch (e) {
    console.error('Receipt view URL error:', e.message);
    return res.status(500).json({ error: 'Could not load receipt' });
  }
};
