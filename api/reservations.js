const { getDb } = require('./db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = getDb();

  try {
    if (req.method === 'GET') {
      const { id } = req.query;
      if (id) {
        const rows = await sql`SELECT * FROM reservations WHERE id = ${id}`;
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(formatRow(rows[0], true));
      }
      const rows = await sql`SELECT id, confirmation_code, player_id, court_id, sport, date, slots, total_amount, payment_status, payment_method, created_at FROM reservations ORDER BY created_at DESC`;
      return res.status(200).json(rows.map(r => formatRow(r, false)));
    }

    if (req.method === 'POST') {
      const r = req.body;
      const rows = await sql`
        INSERT INTO reservations (id, confirmation_code, player_id, court_id, sport, date, slots, total_amount, payment_status, payment_method, receipt_image)
        VALUES (${r.id}, ${r.confirmationCode}, ${r.playerId}, ${r.courtId}, ${r.sport || 'pickleball'}, ${r.date}, ${JSON.stringify(r.slots)}, ${r.totalAmount}, ${r.paymentStatus || 'pending'}, ${r.paymentMethod || ''}, ${r.receiptImage || null})
        RETURNING id, confirmation_code, player_id, court_id, sport, date, slots, total_amount, payment_status, payment_method, created_at
      `;
      return res.status(200).json(formatRow(rows[0], false));
    }

    if (req.method === 'PATCH') {
      const { id, paymentStatus, totalAmount } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      if (paymentStatus) {
        await sql`UPDATE reservations SET payment_status = ${paymentStatus} WHERE id = ${id}`;
      }
      if (totalAmount !== undefined) {
        await sql`UPDATE reservations SET total_amount = ${totalAmount} WHERE id = ${id}`;
      }
      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sql`DELETE FROM reservations WHERE id = ${id}`;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Reservations API error:', error);
    return res.status(500).json({ error: error.message });
  }
};

function formatRow(r, includeReceipt) {
  var row = {
    id: r.id,
    confirmationCode: r.confirmation_code,
    playerId: r.player_id,
    courtId: r.court_id,
    sport: r.sport,
    date: r.date,
    slots: typeof r.slots === 'string' ? JSON.parse(r.slots) : r.slots,
    totalAmount: Number(r.total_amount),
    paymentStatus: r.payment_status,
    paymentMethod: r.payment_method,
    createdAt: r.created_at
  };
  if (includeReceipt) row.receiptImage = r.receipt_image;
  return row;
}
