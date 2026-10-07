const { getDb } = require('./db');
const { checkAdmin, setCors } = require('./_auth');

const CATEGORIES = ['maintenance', 'salary', 'equipment', 'utilities', 'supplies', 'other'];

function formatRow(r) {
  return {
    id: r.id,
    date: r.expense_date,
    category: r.category,
    item: r.item,
    amount: Number(r.amount),
    note: r.note,
    createdAt: r.created_at
  };
}

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Expenses are internal financials — unlike open play, even reading
  // requires admin.
  if (!checkAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = getDb();

  try {
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT * FROM expenses ORDER BY expense_date DESC, created_at DESC
      `;
      return res.status(200).json(rows.map(formatRow));
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      if (!b.id || !b.item || !b.date) {
        return res.status(400).json({ error: 'Item and date are required' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      const amount = Number(b.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ error: 'Invalid amount' });
      }
      const category = CATEGORIES.includes(b.category) ? b.category : 'other';

      const rows = await sql`
        INSERT INTO expenses (id, expense_date, category, item, amount, note)
        VALUES (${b.id}, ${b.date}, ${category}, ${b.item}, ${amount}, ${b.note || ''})
        RETURNING *
      `;
      return res.status(200).json(formatRow(rows[0]));
    }

    if (req.method === 'PATCH') {
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ error: 'Missing id' });
      if (b.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      if (b.amount !== undefined) {
        const amount = Number(b.amount);
        if (!Number.isFinite(amount) || amount < 0) {
          return res.status(400).json({ error: 'Invalid amount' });
        }
      }
      const category = b.category === undefined
        ? null
        : (CATEGORIES.includes(b.category) ? b.category : 'other');

      const rows = await sql`
        UPDATE expenses SET
          expense_date = COALESCE(${b.date ?? null}, expense_date),
          category     = COALESCE(${category}, category),
          item         = COALESCE(${b.item ?? null}, item),
          amount       = COALESCE(${b.amount === undefined ? null : Number(b.amount)}, amount),
          note         = COALESCE(${b.note ?? null}, note)
        WHERE id = ${b.id}
        RETURNING *
      `;
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(formatRow(rows[0]));
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sql`DELETE FROM expenses WHERE id = ${id}`;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Expenses API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
