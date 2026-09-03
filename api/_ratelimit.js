// Shared fixed-window rate limiter backed by the rate_limits table.
//
// Buckets are arbitrary strings, e.g. "login-code:alex@example.com" or
// "booking-ip:1.2.3.4". Callers pick the window and cap.
//
// Degrades OPEN: if the table is missing the request is allowed and a warning
// is logged. Losing a limiter should not take the booking system offline.

const CLEANUP_ODDS = 0.02;
const RETENTION_HOURS = 24;

async function allow(sql, bucket, max, windowMinutes) {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  try {
    const rows = await sql`
      SELECT COUNT(*)::int AS n
      FROM rate_limits
      WHERE bucket = ${bucket} AND created_at > ${since}
    `;
    const used = (rows[0] && rows[0].n) || 0;
    if (used >= max) return false;

    await sql`INSERT INTO rate_limits (bucket) VALUES (${bucket})`;

    // Occasional opportunistic cleanup so the table cannot grow unbounded.
    if (Math.random() < CLEANUP_ODDS) {
      const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);
      await sql`DELETE FROM rate_limits WHERE created_at < ${cutoff}`;
    }
    return true;
  } catch (e) {
    console.error('WARNING: rate limiting inactive (rate_limits missing?):', e.message);
    return true;
  }
}

module.exports = { allow };
