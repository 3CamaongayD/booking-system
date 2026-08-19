const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'Kepler Insight Booking <booking@keplerinsightschool.com>';

const COURT_RULES = [
  { icon: '🚭', title: 'No Smoking', desc: 'Smoking and vaping are strictly prohibited in all court areas and facilities.' },
  { icon: '🍸', title: 'No Alcoholic Beverages', desc: 'Alcohol is not allowed on the premises.' },
  { icon: '👟', title: 'Proper Footwear Required', desc: 'Players must wear non-marking court shoes. No sandals, slippers, or bare feet.' },
  { icon: '⏰', title: 'Be On Time', desc: 'Please arrive 5 minutes before your slot. Late arrivals will not extend your booking.' },
  { icon: '🏸', title: 'Handle Equipment with Care', desc: 'Return all borrowed equipment in good condition. Damages may incur fees.' },
  { icon: '🗑️', title: 'Keep the Courts Clean', desc: 'Dispose of trash properly. Leave the court area clean for the next players.' },
];

function formatHour(h) {
  if (h === 0 || h === 24) return '12:00 AM';
  if (h === 12) return '12:00 PM';
  return h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function baseStyles() {
  return `
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f0eb; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a3c34 0%, #2d5a4e 100%); padding: 32px 24px; text-align: center; }
    .header img { height: 48px; margin-bottom: 8px; }
    .header h1 { color: #ffffff; font-size: 22px; margin: 0; font-weight: 700; }
    .header p { color: rgba(255,255,255,0.8); font-size: 13px; margin: 4px 0 0; }
    .status-badge { display: inline-block; padding: 6px 20px; border-radius: 20px; font-size: 14px; font-weight: 600; margin: 16px 0 8px; }
    .status-pending { background: #f5f0eb; color: #8b7355; border: 1px solid #d4c5b0; }
    .status-confirmed { background: #1a3c34; color: #ffffff; }
    .content { padding: 24px; }
    .details-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .details-table td { padding: 10px 12px; font-size: 14px; border-bottom: 1px solid #f0ece7; }
    .details-table td:first-child { color: #888; font-weight: 500; width: 140px; }
    .details-table td:last-child { color: #333; font-weight: 600; }
    .amount { color: #dc143c !important; font-size: 18px !important; }
    .rules-section { background: #f5f0eb; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .rules-section h3 { font-size: 16px; margin: 0 0 16px; color: #333; }
    .rule { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; font-size: 13px; }
    .rule-icon { font-size: 18px; flex-shrink: 0; }
    .rule strong { display: block; color: #333; margin-bottom: 2px; }
    .rule p { color: #666; margin: 0; }
    .footer { background: #f5f0eb; padding: 20px 24px; text-align: center; font-size: 12px; color: #999; }
    .conf-code { font-family: monospace; font-size: 20px; font-weight: 700; color: #1a3c34; background: #f5f0eb; padding: 8px 16px; border-radius: 6px; display: inline-block; letter-spacing: 2px; }
  `;
}

function bookingDetailsHtml(data) {
  const slots = data.slots.sort((a, b) => a.hour - b.hour);
  const timeRange = `${formatHour(slots[0].hour)} – ${formatHour(slots[slots.length - 1].hour + 1)}`;
  const duration = `${slots.length} hour${slots.length > 1 ? 's' : ''}`;
  const sport = data.sport === 'table-tennis' ? 'Table Tennis' :
    data.sport ? data.sport.charAt(0).toUpperCase() + data.sport.slice(1) : '';
  const facility = data.courtName + (sport && sport !== 'Pickleball' ? ` (${sport})` : '');

  return `
    <table class="details-table">
      <tr><td>Confirmation Code</td><td><span class="conf-code">${data.confirmationCode}</span></td></tr>
      <tr><td>Booked By</td><td>${data.playerName}</td></tr>
      <tr><td>Email</td><td>${data.playerEmail}</td></tr>
      <tr><td>Facility</td><td>${facility}</td></tr>
      <tr><td>Date</td><td>${formatDate(data.date)}</td></tr>
      <tr><td>Time</td><td>${timeRange}</td></tr>
      <tr><td>Duration</td><td>${duration}</td></tr>
      <tr><td>Payment Method</td><td>${(data.paymentMethod || '').toUpperCase()}</td></tr>
      <tr><td>Total Amount</td><td class="amount">₱${Number(data.totalAmount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td></tr>
    </table>
  `;
}

function rulesHtml() {
  return `
    <div class="rules-section">
      <h3>⚠️ Court Rules & Guidelines</h3>
      ${COURT_RULES.map(r => `
        <div class="rule">
          <span class="rule-icon">${r.icon}</span>
          <div><strong>${r.title}</strong><p>${r.desc}</p></div>
        </div>
      `).join('')}
    </div>
  `;
}

function pendingEmailHtml(data) {
  return `
    <!DOCTYPE html>
    <html><head><style>${baseStyles()}</style></head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Kepler Insight</h1>
          <p>School of Science and Arts — Sports Court Reservation</p>
        </div>
        <div class="content">
          <div style="text-align:center;">
            <span class="status-badge status-pending">⏳ Pending Verification</span>
            <h2 style="font-size:20px; margin:12px 0 4px;">Booking Submitted!</h2>
            <p style="color:#666; font-size:14px; margin:0 0 20px;">Your reservation has been received and is awaiting admin verification.</p>
          </div>
          ${bookingDetailsHtml(data)}
          <div style="background:#f5f0eb; border-radius:8px; padding:16px; margin:16px 0; font-size:13px; color:#5a4a3a;">
            <strong>What happens next?</strong><br>
            Our admin will review your payment receipt and verify your booking. You will receive a confirmation email once approved.
          </div>
        </div>
        <div class="footer">
          <p>&copy; 2026 Kepler Insight School of Science and Arts</p>
          <p>Sports Court Reservation System</p>
        </div>
      </div>
    </body></html>
  `;
}

function confirmedEmailHtml(data) {
  return `
    <!DOCTYPE html>
    <html><head><style>${baseStyles()}</style></head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Kepler Insight</h1>
          <p>School of Science and Arts — Sports Court Reservation</p>
        </div>
        <div class="content">
          <div style="text-align:center;">
            <span class="status-badge status-confirmed">✅ Confirmed</span>
            <h2 style="font-size:20px; margin:12px 0 4px;">Booking Confirmed!</h2>
            <p style="color:#666; font-size:14px; margin:0 0 20px;">Your reservation has been approved. See you on the court!</p>
          </div>
          ${bookingDetailsHtml(data)}
          ${rulesHtml()}
          <div style="background:#1a3c34; border-radius:8px; padding:16px; margin:16px 0; font-size:13px; color:#ffffff; text-align:center;">
            <strong>You're all set!</strong><br>
            Please arrive 5 minutes before your reserved time. Present your confirmation code at the venue.
          </div>
        </div>
        <div class="footer">
          <p>&copy; 2026 Kepler Insight School of Science and Arts</p>
          <p>Sports Court Reservation System</p>
        </div>
      </div>
    </body></html>
  `;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, data } = req.body;

    if (!data || !data.playerEmail || !data.confirmationCode) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let subject, html;

    if (type === 'pending') {
      subject = `Booking Received — ${data.confirmationCode} | Kepler Insight`;
      html = pendingEmailHtml(data);
    } else if (type === 'confirmed') {
      subject = `Booking Confirmed — ${data.confirmationCode} | Kepler Insight`;
      html = confirmedEmailHtml(data);
    } else {
      return res.status(400).json({ error: 'Invalid email type' });
    }

    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: data.playerEmail,
      subject,
      html,
    });

    return res.status(200).json({ success: true, id: result.data?.id });
  } catch (error) {
    console.error('Email send error:', error);
    return res.status(500).json({ error: 'Failed to send email' });
  }
};
