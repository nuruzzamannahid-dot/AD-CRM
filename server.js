require('dotenv').config();
const express = require('express');
const path = require('path');
const { getClient, initSchema } = require('./lib/db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DHAKA_TZ = 'Asia/Dhaka';

function dhakaDateKey(d = new Date()) {
  // YYYY-MM-DD in Asia/Dhaka, used as the "today" boundary for filters/metrics
  return new Intl.DateTimeFormat('en-CA', { timeZone: DHAKA_TZ }).format(d);
}

function rangeToDates(range) {
  const today = new Date();
  const end = dhakaDateKey(today);
  if (range === 'week') {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    return { start: dhakaDateKey(d), end };
  }
  if (range === 'month') {
    const d = new Date(today);
    d.setDate(d.getDate() - 29);
    return { start: dhakaDateKey(d), end };
  }
  return { start: end, end }; // 'today' default
}

// ---- Reference data -------------------------------------------------

app.get('/api/managers', async (req, res) => {
  const db = getClient();
  const r = await db.execute('SELECT id, name, initials, email FROM ad_managers ORDER BY name');
  res.json(r.rows);
});

app.get('/api/tags', async (req, res) => {
  const db = getClient();
  const r = await db.execute('SELECT name FROM reason_tags ORDER BY sort_order');
  res.json(r.rows.map((row) => row.name));
});

app.get('/api/subtags', async (req, res) => {
  const db = getClient();
  const r = await db.execute('SELECT name FROM dissatisfaction_subtags ORDER BY sort_order');
  res.json(r.rows.map((row) => row.name));
});

app.get('/api/merchants', async (req, res) => {
  const db = getClient();
  const search = `%${(req.query.search || '').trim()}%`;
  const r = await db.execute({
    sql: 'SELECT id, mid, name FROM merchants WHERE name LIKE ? OR mid LIKE ? ORDER BY name LIMIT 20',
    args: [search, search]
  });
  res.json(r.rows);
});

// ---- Public call-request intake (Merchant Issues form "Request For Call") --
//
// Called directly by the merchant-facing form (Merchant-Issues-form repo),
// unauthenticated. Every request must show up on the CRM: if the merchant
// name doesn't match an existing merchant, we create one on the fly and
// file it under a fallback "Unassigned" AD manager rather than dropping it.

const CALL_REQUEST_TAG = 'Call Request';
const UNASSIGNED_MANAGER = { name: 'Unassigned', initials: 'NA' };

async function ensureCallRequestTag(db) {
  await db.execute({
    sql: 'INSERT OR IGNORE INTO reason_tags (name, sort_order) VALUES (?, 999)',
    args: [CALL_REQUEST_TAG]
  });
}

async function getOrCreateUnassignedManagerId(db) {
  const existing = await db.execute({
    sql: 'SELECT id FROM ad_managers WHERE name = ?',
    args: [UNASSIGNED_MANAGER.name]
  });
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await db.execute({
    sql: 'INSERT INTO ad_managers (name, initials, email) VALUES (?, ?, NULL)',
    args: [UNASSIGNED_MANAGER.name, UNASSIGNED_MANAGER.initials]
  });
  return Number(inserted.lastInsertRowid);
}

async function findOrCreateMerchant(db, merchantName) {
  const name = merchantName.trim();
  const found = await db.execute({
    sql: 'SELECT id, ad_manager_id FROM merchants WHERE name = ? COLLATE NOCASE LIMIT 1',
    args: [name]
  });
  if (found.rows[0]) {
    return { id: found.rows[0].id, ad_manager_id: found.rows[0].ad_manager_id, created: false };
  }

  const fallbackManagerId = await getOrCreateUnassignedManagerId(db);
  const mid = `WEB-${Date.now()}`;
  const inserted = await db.execute({
    sql: 'INSERT INTO merchants (mid, name, ad_manager_id) VALUES (?, ?, ?)',
    args: [mid, name, fallbackManagerId]
  });
  return { id: Number(inserted.lastInsertRowid), ad_manager_id: fallbackManagerId, created: true };
}

app.post('/api/call-requests', async (req, res) => {
  const db = getClient();
  const merchantName = (req.body.merchantName || '').trim();
  const reason = (req.body.reason || '').trim();

  if (!merchantName || !reason) {
    return res.status(400).json({ error: 'merchantName and reason are required' });
  }

  try {
    await ensureCallRequestTag(db);
    const merchant = await findOrCreateMerchant(db, merchantName);

    const r = await db.execute({
      sql: `INSERT INTO calls (merchant_id, ad_manager_id, reason_tag, notes, status, resolved)
            VALUES (?, ?, ?, ?, 'reached', 1)`,
      args: [merchant.id, merchant.ad_manager_id, CALL_REQUEST_TAG, reason]
    });

    res.status(201).json({
      id: Number(r.lastInsertRowid),
      merchant_id: merchant.id,
      merchant_created: merchant.created
    });
  } catch (err) {
    console.error('Failed to log call request:', err.message);
    res.status(500).json({ error: 'Failed to log call request' });
  }
});

// ---- Calls ------------------------------------------------------------

function buildFilters({ range, manager, tag }) {
  const { start, end } = rangeToDates(range);
  const clauses = ["date(c.created_at) BETWEEN ? AND ?"];
  const args = [start, end];
  if (manager && manager !== 'all') {
    clauses.push('m.name = ?');
    args.push(manager);
  }
  if (tag && tag !== 'All') {
    clauses.push('c.reason_tag = ?');
    args.push(tag);
  }
  return { where: clauses.join(' AND '), args };
}

app.get('/api/calls', async (req, res) => {
  const db = getClient();
  const { where, args } = buildFilters(req.query);
  const r = await db.execute({
    sql: `
      SELECT c.id, c.reason_tag, c.sub_tag, c.notes, c.follow_up_date, c.status, c.resolved, c.created_at,
             mm.mid, mm.name AS merchant_name,
             m.name AS manager_name, m.initials AS manager_initials
      FROM calls c
      JOIN merchants mm ON mm.id = c.merchant_id
      JOIN ad_managers m ON m.id = c.ad_manager_id
      WHERE ${where}
      ORDER BY c.created_at DESC
      LIMIT 100
    `,
    args
  });
  res.json(r.rows);
});

app.post('/api/calls', async (req, res) => {
  const db = getClient();
  const { merchant_id, ad_manager_id, reason_tag, sub_tag, notes, follow_up_date, status } = req.body;

  if (!merchant_id || !ad_manager_id || !reason_tag) {
    return res.status(400).json({ error: 'merchant_id, ad_manager_id and reason_tag are required' });
  }

  const resolved = reason_tag === 'Dissatisfied' ? 0 : 1;

  const r = await db.execute({
    sql: `INSERT INTO calls (merchant_id, ad_manager_id, reason_tag, sub_tag, notes, follow_up_date, status, resolved)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [merchant_id, ad_manager_id, reason_tag, sub_tag || null, notes || null, follow_up_date || null, status || 'reached', resolved]
  });

  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

app.patch('/api/calls/:id/resolve', async (req, res) => {
  const db = getClient();
  await db.execute({ sql: 'UPDATE calls SET resolved = 1 WHERE id = ?', args: [req.params.id] });
  res.json({ ok: true });
});

// ---- Metrics / funnel / breakdown --------------------------------------

app.get('/api/metrics', async (req, res) => {
  const db = getClient();
  const range = req.query.range || 'today';
  const manager = req.query.manager || 'all';

  const todayFilters = buildFilters({ range: 'today', manager, tag: null });
  const yFilters = buildFilters({ range: 'today', manager, tag: null });
  // yesterday: shift the date window back one day for the comparison
  const yesterdayKey = dhakaDateKey(new Date(Date.now() - 86400000));
  const yArgs = [yesterdayKey, yesterdayKey, ...(manager !== 'all' ? [manager] : [])];
  const yWhere = manager !== 'all'
    ? 'date(c.created_at) BETWEEN ? AND ? AND m.name = ?'
    : 'date(c.created_at) BETWEEN ? AND ?';

  const [calls, calls_y, dissatisfied, dissatisfied_y, onboarded, onboarded_y, inactive, inactive_y] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) c FROM calls c JOIN ad_managers m ON m.id=c.ad_manager_id WHERE ${todayFilters.where}`, args: todayFilters.args }),
    db.execute({ sql: `SELECT COUNT(*) c FROM calls c JOIN ad_managers m ON m.id=c.ad_manager_id WHERE ${yWhere}`, args: yArgs }),
    db.execute({ sql: `SELECT COUNT(*) c FROM calls c JOIN ad_managers m ON m.id=c.ad_manager_id WHERE ${todayFilters.where} AND c.reason_tag='Dissatisfied'`, args: todayFilters.args }),
    db.execute({ sql: `SELECT COUNT(*) c FROM calls c JOIN ad_managers m ON m.id=c.ad_manager_id WHERE ${yWhere} AND c.reason_tag='Dissatisfied'`, args: yArgs }),
    db.execute({ sql: `SELECT COUNT(*) c FROM calls c JOIN ad_managers m ON m.id=c.ad_manager_id WHERE ${todayFilters.where} AND c.reason_tag='Newly onboarded'`, args: todayFilters.args }),
    db.execute({ sql: `SELECT COUNT(*) c FROM calls c JOIN ad_managers m ON m.id=c.ad_manager_id WHERE ${yWhere} AND c.reason_tag='Newly onboarded'`, args: yArgs }),
    db.execute({ sql: `SELECT COUNT(*) c FROM calls c JOIN ad_managers m ON m.id=c.ad_manager_id WHERE ${todayFilters.where} AND c.reason_tag='Business inactive'`, args: todayFilters.args }),
    db.execute({ sql: `SELECT COUNT(*) c FROM calls c JOIN ad_managers m ON m.id=c.ad_manager_id WHERE ${yWhere} AND c.reason_tag='Business inactive'`, args: yArgs })
  ]);

  const callsToday = Number(calls.rows[0].c);
  const callsYesterday = Number(calls_y.rows[0].c);
  const dissatRateToday = callsToday ? (Number(dissatisfied.rows[0].c) / callsToday) * 100 : 0;
  const dissatRateYesterday = callsYesterday ? (Number(dissatisfied_y.rows[0].c) / callsYesterday) * 100 : 0;

  res.json({
    calls_logged: { value: callsToday, delta: callsToday - callsYesterday },
    dissatisfaction_rate: { value: Number(dissatRateToday.toFixed(1)), delta: Number((dissatRateToday - dissatRateYesterday).toFixed(1)) },
    newly_onboarded: { value: Number(onboarded.rows[0].c), delta: Number(onboarded.rows[0].c) - Number(onboarded_y.rows[0].c) },
    business_inactive: { value: Number(inactive.rows[0].c), delta: Number(inactive.rows[0].c) - Number(inactive_y.rows[0].c) }
  });
});

app.get('/api/funnel', async (req, res) => {
  const db = getClient();
  const manager = req.query.manager || 'all';
  const { where, args } = buildFilters({ range: 'today', manager, tag: null });

  const assignedSql = manager !== 'all'
    ? 'SELECT COUNT(*) c FROM merchants mm JOIN ad_managers m ON m.id = mm.ad_manager_id WHERE m.name = ?'
    : 'SELECT COUNT(*) c FROM merchants';
  const assignedArgs = manager !== 'all' ? [manager] : [];

  const [assigned, called, reached, dissatisfied, resolved] = await Promise.all([
    db.execute({ sql: assignedSql, args: assignedArgs }),
    db.execute({ sql: `SELECT COUNT(DISTINCT c.merchant_id) c FROM calls c JOIN ad_managers m ON m.id=c.ad_manager_id WHERE ${where}`, args }),
    db.execute({ sql: `SELECT COUNT(*) c FROM calls c JOIN ad_managers m ON m.id=c.ad_manager_id WHERE ${where} AND c.status='reached'`, args }),
    db.execute({ sql: `SELECT COUNT(*) c FROM calls c JOIN ad_managers m ON m.id=c.ad_manager_id WHERE ${where} AND c.reason_tag='Dissatisfied'`, args }),
    db.execute({ sql: `SELECT COUNT(*) c FROM calls c JOIN ad_managers m ON m.id=c.ad_manager_id WHERE ${where} AND c.reason_tag='Dissatisfied' AND c.resolved=1`, args })
  ]);

  res.json({
    assigned: Number(assigned.rows[0].c),
    called: Number(called.rows[0].c),
    reached: Number(reached.rows[0].c),
    dissatisfied: Number(dissatisfied.rows[0].c),
    resolved: Number(resolved.rows[0].c)
  });
});

app.get('/api/breakdown', async (req, res) => {
  const db = getClient();
  const manager = req.query.manager || 'all';
  const { where, args } = buildFilters({ range: 'today', manager, tag: 'Dissatisfied' });

  const r = await db.execute({
    sql: `
      SELECT COALESCE(c.sub_tag, 'Unspecified') AS sub_tag, COUNT(*) AS n
      FROM calls c JOIN ad_managers m ON m.id = c.ad_manager_id
      WHERE ${where}
      GROUP BY sub_tag
      ORDER BY n DESC
    `,
    args
  });

  const total = r.rows.reduce((sum, row) => sum + Number(row.n), 0);
  const rows = r.rows.map((row) => ({
    sub_tag: row.sub_tag,
    count: Number(row.n),
    pct: total ? Math.round((Number(row.n) / total) * 100) : 0
  }));

  res.json({ total, rows });
});

// ---- Boot ---------------------------------------------------------------

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`AD CRM running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err.message);
    process.exit(1);
  });
