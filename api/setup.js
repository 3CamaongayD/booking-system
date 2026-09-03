const { getDb } = require('./db');
const { checkAdmin, setCors } = require('./_auth');

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  if (!checkAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = getDb();

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        contact_number TEXT NOT NULL DEFAULT '',
        emergency_contact TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        confirmation_code TEXT NOT NULL,
        player_id TEXT NOT NULL,
        court_id INTEGER NOT NULL,
        sport TEXT NOT NULL DEFAULT 'pickleball',
        date TEXT NOT NULL,
        slots JSONB NOT NULL DEFAULT '[]',
        total_amount NUMERIC NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'pending',
        payment_method TEXT NOT NULL DEFAULT '',
        receipt_image TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS overrides (
        id TEXT PRIMARY KEY,
        court_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        hour INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT 'Blocked'
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS login_codes (
        email TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(date)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_reservations_player ON reservations(player_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_overrides_date ON overrides(date)`;

    await sql`ALTER TABLE players ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE reservations ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE overrides ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE login_codes ENABLE ROW LEVEL SECURITY`;

    return res.status(200).json({ success: true, message: 'Database tables created' });
  } catch (error) {
    console.error('Setup error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
