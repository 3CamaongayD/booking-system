const { getDb } = require('./db');
const { setCors, checkAdminPassword, signAdminToken, clientIp } = require('./_auth');

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;
const LOG_RETENTION_DAYS = 90;

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getDb();
  const ip = clientIp(req);
  const { password } = req.body || {};

  try {
    const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

    // Rate limiting degrades rather than failing closed: if the table is
    // missing the admin must still be able to log in and fix it. A warning
    // in the Vercel logs is the signal that protection is not active.
    let failures = 0;
    let limiterUp = true;
    try {
      const recent = await sql`
        SELECT COUNT(*)::int AS failures
        FROM admin_login_attempts
        WHERE ip = ${ip} AND success = false AND attempted_at > ${since}
      `;
      failures = (recent[0] && recent[0].failures) || 0;
    } catch (e) {
      limiterUp = false;
      console.error('WARNING: admin rate limiting inactive (admin_login_attempts missing?):', e.message);
    }

    if (limiterUp && failures >= MAX_FAILURES) {
      // Not counted again — repeated probing would otherwise extend the
      // lockout indefinitely and let an attacker keep the admin locked out.
      return res.status(429).json({
        error: 'Too many failed attempts. Try again in ' + WINDOW_MINUTES + ' minutes.'
      });
    }

    const ok = checkAdminPassword(password);

    if (limiterUp) {
      await sql`
        INSERT INTO admin_login_attempts (ip, success)
        VALUES (${ip}, ${ok})
      `;
    }

    if (!ok) {
      const remaining = MAX_FAILURES - failures - 1;
      return res.status(401).json({
        valid: false,
        remaining: remaining > 0 ? remaining : 0
      });
    }

    if (limiterUp) {
      // A successful login clears this IP's failures so the counter resets.
      await sql`
        DELETE FROM admin_login_attempts
        WHERE ip = ${ip} AND success = false
      `;
      const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      await sql`DELETE FROM admin_login_attempts WHERE attempted_at < ${cutoff}`;
    }

    const token = signAdminToken();
    if (!token) return res.status(500).json({ error: 'Server not configured for sessions' });

    return res.status(200).json({ valid: true, token });
  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
