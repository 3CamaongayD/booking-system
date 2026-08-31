const { getDb } = require('./db');
const { checkAdmin, setCors } = require('./_auth');

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = getDb();

  try {
    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM overrides ORDER BY date, hour`;
      return res.status(200).json(rows.map(r => ({
        id: r.id,
        courtId: r.court_id,
        date: r.date,
        hour: r.hour,
        reason: r.reason
      })));
    }

    if (!checkAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method === 'POST') {
      const { id, courtId, date, hour, reason } = req.body;
      if (!id || !courtId || !date || hour === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      if (![1, 2, 3, 4, 5].includes(courtId)) {
        return res.status(400).json({ error: 'Invalid court' });
      }
      if (typeof hour !== 'number' || hour < 0 || hour > 23) {
        return res.status(400).json({ error: 'Invalid hour' });
      }
      const rows = await sql`
        INSERT INTO overrides (id, court_id, date, hour, reason)
        VALUES (${id}, ${courtId}, ${date}, ${hour}, ${reason || 'Blocked'})
        RETURNING *
      `;
      return res.status(200).json({
        id: rows[0].id,
        courtId: rows[0].court_id,
        date: rows[0].date,
        hour: rows[0].hour,
        reason: rows[0].reason
      });
    }

    if (req.method === 'PATCH') {
      const { id, reason } = req.body;
      if (!id || !reason) return res.status(400).json({ error: 'Missing id or reason' });
      await sql`UPDATE overrides SET reason = ${reason} WHERE id = ${id}`;
      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sql`DELETE FROM overrides WHERE id = ${id}`;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Overrides API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
