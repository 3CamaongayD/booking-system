const { getDb } = require('./db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = getDb();

  try {
    if (req.method === 'GET') {
      const { email } = req.query;
      if (email) {
        const rows = await sql`SELECT * FROM players WHERE email = ${email}`;
        return res.status(200).json(rows[0] || null);
      }
      const rows = await sql`SELECT * FROM players ORDER BY created_at DESC`;
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const { id, fullName, email, contactNumber, emergencyContact } = req.body;
      const rows = await sql`
        INSERT INTO players (id, full_name, email, contact_number, emergency_contact)
        VALUES (${id}, ${fullName}, ${email}, ${contactNumber || ''}, ${emergencyContact || ''})
        ON CONFLICT (email) DO UPDATE SET
          full_name = ${fullName},
          contact_number = ${contactNumber || ''}
        RETURNING *
      `;
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'PUT') {
      const { id, fullName, contactNumber } = req.body;
      await sql`
        UPDATE players SET full_name = ${fullName}, contact_number = ${contactNumber || ''}
        WHERE id = ${id}
      `;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Players API error:', error);
    return res.status(500).json({ error: error.message });
  }
};
