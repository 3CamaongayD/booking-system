const crypto = require('crypto');

const BUCKET = 'receipts';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key };
}

function isConfigured() {
  return !!config();
}

// Browsers upload straight to Supabase with this URL, so the file never
// passes through a Vercel function and its 4.5MB body cap does not apply.
async function createSignedUploadUrl(ext) {
  const cfg = config();
  if (!cfg) throw new Error('Storage not configured');

  const path = crypto.randomUUID() + '.' + ext;
  const resp = await fetch(
    cfg.url + '/storage/v1/object/upload/sign/' + BUCKET + '/' + path,
    { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.key } }
  );
  if (!resp.ok) {
    throw new Error('Sign upload failed: ' + resp.status + ' ' + (await resp.text()));
  }
  const body = await resp.json();
  return { path: path, uploadUrl: cfg.url + '/storage/v1' + body.url };
}

// The bucket is private, so reading needs a short-lived signed URL. Receipts
// show payment details and must not be guessable or permanently linkable.
async function createSignedDownloadUrl(path, expiresIn) {
  const cfg = config();
  if (!cfg) throw new Error('Storage not configured');

  const resp = await fetch(
    cfg.url + '/storage/v1/object/sign/' + BUCKET + '/' + path,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresIn || 300 })
    }
  );
  if (!resp.ok) {
    throw new Error('Sign download failed: ' + resp.status + ' ' + (await resp.text()));
  }
  const body = await resp.json();
  return cfg.url + '/storage/v1' + body.signedURL;
}

module.exports = { createSignedUploadUrl, createSignedDownloadUrl, isConfigured };
