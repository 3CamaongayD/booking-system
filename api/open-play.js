const { getDb } = require('./db');
const { checkAdmin, setCors } = require('./_auth');

function formatRow(r) {
  return {
    id: r.id,
    title: r.title,
    eventDate: r.event_date,
    startTime: r.start_time,
    endTime: r.end_time,
    venue: r.venue,
    address: r.address,
    maxPlayers: r.max_players,
    courts: r.courts,
    price: r.price === null ? null : Number(r.price),
    details: r.details,
    paymentNumber: r.payment_number,
    paymentName: r.payment_name,
    joinUrl: r.join_url,
    active: r.active,
    showPopup: r.show_popup,
    createdAt: r.created_at
  };
}

function intOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function numOrNull(v) {
  const n = Number(v);
  return v === '' || v === null || v === undefined || !Number.isFinite(n) ? null : n;
}

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = getDb();

  try {
    if (req.method === 'GET') {
      // Admins see everything so they can manage drafts and past events;
      // visitors only see active ones that have not already happened.
      if (checkAdmin(req)) {
        const rows = await sql`SELECT * FROM open_play ORDER BY event_date DESC`;
        return res.status(200).json(rows.map(formatRow));
      }
      const today = new Date().toISOString().slice(0, 10);
      const rows = await sql`
        SELECT * FROM open_play
        WHERE active = true AND event_date >= ${today}
        ORDER BY event_date ASC
      `;
      return res.status(200).json(rows.map(formatRow));
    }

    if (!checkAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      if (!b.id || !b.title || !b.eventDate) {
        return res.status(400).json({ error: 'Title and date are required' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.eventDate)) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      const rows = await sql`
        INSERT INTO open_play (
          id, title, event_date, start_time, end_time, venue, address,
          max_players, courts, price, details, payment_number, payment_name,
          join_url, active, show_popup
        ) VALUES (
          ${b.id}, ${b.title}, ${b.eventDate}, ${b.startTime || ''}, ${b.endTime || ''},
          ${b.venue || ''}, ${b.address || ''}, ${intOrNull(b.maxPlayers)}, ${intOrNull(b.courts)},
          ${numOrNull(b.price)}, ${b.details || ''}, ${b.paymentNumber || ''},
          ${b.paymentName || ''}, ${b.joinUrl || ''},
          ${b.active !== false}, ${b.showPopup !== false}
        )
        RETURNING *
      `;
      return res.status(200).json(formatRow(rows[0]));
    }

    if (req.method === 'PATCH') {
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ error: 'Missing id' });
      if (b.eventDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(b.eventDate)) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      const rows = await sql`
        UPDATE open_play SET
          title          = COALESCE(${b.title ?? null}, title),
          event_date     = COALESCE(${b.eventDate ?? null}, event_date),
          start_time     = COALESCE(${b.startTime ?? null}, start_time),
          end_time       = COALESCE(${b.endTime ?? null}, end_time),
          venue          = COALESCE(${b.venue ?? null}, venue),
          address        = COALESCE(${b.address ?? null}, address),
          max_players    = ${b.maxPlayers === undefined ? null : intOrNull(b.maxPlayers)},
          courts         = ${b.courts === undefined ? null : intOrNull(b.courts)},
          price          = ${b.price === undefined ? null : numOrNull(b.price)},
          details        = COALESCE(${b.details ?? null}, details),
          payment_number = COALESCE(${b.paymentNumber ?? null}, payment_number),
          payment_name   = COALESCE(${b.paymentName ?? null}, payment_name),
          join_url       = COALESCE(${b.joinUrl ?? null}, join_url),
          active         = COALESCE(${b.active ?? null}, active),
          show_popup     = COALESCE(${b.showPopup ?? null}, show_popup)
        WHERE id = ${b.id}
        RETURNING *
      `;
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(formatRow(rows[0]));
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sql`DELETE FROM open_play WHERE id = ${id}`;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Open play API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
