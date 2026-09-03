const crypto = require('crypto');
const { Resend } = require('resend');
const { getDb } = require('./db');
const { setCors, signPlayerToken } = require('./_auth');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'Kepler Insight Booking <booking@keplerinsightschool.com>';

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;

function codeEmailHtml(code, name) {
  return `
    <!DOCTYPE html>
    <html><head><style>
      body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f0eb; margin: 0; padding: 0; }
      .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; }
      .header { background: linear-gradient(135deg, #991A20 0%, #CC2229 100%); padding: 32px 24px; text-align: center; }
      .header h1 { color: #ffffff; font-size: 22px; margin: 0; font-weight: 700; }
      .content { padding: 24px; text-align: center; }
      .code { font-family: monospace; font-size: 34px; font-weight: 700; color: #991A20; background: #f5f0eb; padding: 16px 28px; border-radius: 8px; display: inline-block; letter-spacing: 8px; margin: 16px 0; }
      .footer { background: #f5f0eb; padding: 20px 24px; text-align: center; font-size: 12px; color: #999; }
    </style></head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Kepler Insight</h1>
        </div>
        <div class="content">
          <h2 style="font-size:20px; margin:0 0 4px;">Your login code</h2>
          <p style="color:#666; font-size:14px;">Hi ${name || 'there'}, use this code to access your bookings.</p>
          <div class="code">${code}</div>
          <p style="color:#666; font-size:13px;">This code expires in ${CODE_TTL_MINUTES} minutes.</p>
          <p style="color:#999; font-size:12px; margin-top:20px;">If you did not request this, you can ignore this email.</p>
        </div>
        <div class="footer">
          <p>&copy; 2026 Kepler Insight School of Science and Arts</p>
        </div>
      </div>
    </body></html>
  `;
}

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getDb();
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const code = String((req.body && req.body.code) || '').trim();

  if (!email || email.indexOf('@') < 0) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  try {
    // --- Step 2: verify a submitted code ---
    if (code) {
      const rows = await sql`SELECT code, expires_at, attempts FROM login_codes WHERE email = ${email}`;
      const row = rows[0];
      if (!row) return res.status(401).json({ error: 'No code requested for this email' });

      if (row.attempts >= MAX_ATTEMPTS) {
        await sql`DELETE FROM login_codes WHERE email = ${email}`;
        return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        await sql`DELETE FROM login_codes WHERE email = ${email}`;
        return res.status(401).json({ error: 'Code expired. Request a new one.' });
      }

      const submitted = Buffer.from(code);
      const expected = Buffer.from(row.code);
      const match = submitted.length === expected.length && crypto.timingSafeEqual(submitted, expected);
      if (!match) {
        await sql`UPDATE login_codes SET attempts = attempts + 1 WHERE email = ${email}`;
        return res.status(401).json({ error: 'Incorrect code' });
      }

      await sql`DELETE FROM login_codes WHERE email = ${email}`;
      const players = await sql`SELECT * FROM players WHERE LOWER(email) = ${email}`;
      const player = players[0];
      if (!player) return res.status(404).json({ error: 'Player not found' });

      const token = signPlayerToken(player.id);
      if (!token) return res.status(500).json({ error: 'Server not configured for sessions' });

      return res.status(200).json({
        token,
        player: {
          id: player.id,
          fullName: player.full_name,
          email: player.email,
          contactNumber: player.contact_number || ''
        }
      });
    }

    // --- Step 1: request a code ---
    const players = await sql`SELECT full_name FROM players WHERE LOWER(email) = ${email}`;

    // Always report success so this cannot be used to test which emails exist.
    if (players[0]) {
      const generated = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

      await sql`
        INSERT INTO login_codes (email, code, expires_at, attempts)
        VALUES (${email}, ${generated}, ${expiresAt}, 0)
        ON CONFLICT (email) DO UPDATE SET
          code = ${generated},
          expires_at = ${expiresAt},
          attempts = 0
      `;

      await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: 'Your Kepler Insight login code',
        html: codeEmailHtml(generated, players[0].full_name)
      });
    }

    return res.status(200).json({ sent: true });
  } catch (error) {
    console.error('Player auth error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
