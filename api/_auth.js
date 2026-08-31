function checkAdmin(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return false;
  return auth.slice(7) === process.env.ADMIN_PASSWORD;
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

module.exports = { checkAdmin, setCors };
