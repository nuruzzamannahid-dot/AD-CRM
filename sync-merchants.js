// Syncs the "AD merchant grouping" Gsheet into the merchants table.
// The Gsheet is the source of truth for merchant identity/grouping data;
// AD manager ASSIGNMENT is independent and is never touched by this script
// (whatsapp_group is the escalation WhatsApp group, e.g. "CarryBee Issue
// Group || NN1" — it is not the same thing as which AD manager owns the
// merchant).
//
// Usage:
//   node db/sync-merchants.js
// or on a schedule (see runOnInterval() wired up in server.js).
//
// Requires the Gsheet to be published to the web as CSV:
//   File -> Share -> Publish to web -> select the sheet/tab -> CSV
// Put that URL in MERCHANT_SHEET_CSV_URL (env var or below).

require('dotenv').config();
const { getClient, initSchema } = require('./../lib/db');

const CSV_URL = process.env.MERCHANT_SHEET_CSV_URL || '';

// Expected columns (by header name, case-insensitive, order-independent):
//   Business ID | Business Name | Merchant Criteria | Assigned Group | Whatsapp Number

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function indexHeaders(headerRow) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  const idx = {};
  headerRow.forEach((h, i) => { idx[norm(h)] = i; });
  return {
    businessId: idx['business id'],
    businessName: idx['business name'],
    criteria: idx['merchant criteria'],
    group: idx['assigned group'],
    whatsapp: idx['whatsapp number']
  };
}

async function getOrCreateUnassignedManagerId(db) {
  const existing = await db.execute({
    sql: 'SELECT id FROM ad_managers WHERE name = ?',
    args: ['Unassigned']
  });
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await db.execute({
    sql: 'INSERT INTO ad_managers (name, initials, email) VALUES (?, ?, NULL)',
    args: ['Unassigned', 'NA']
  });
  return Number(inserted.lastInsertRowid);
}

async function syncMerchants(csvUrl = CSV_URL) {
  if (!csvUrl) {
    throw new Error(
      'MERCHANT_SHEET_CSV_URL is not set. Publish the "AD merchant grouping" Gsheet to the ' +
      'web as CSV (File > Share > Publish to web) and set the URL as an env var.'
    );
  }

  await initSchema();
  const db = getClient();

  const res = await fetch(csvUrl);
  if (!res.ok) throw new Error(`Sheet CSV fetch failed: ${res.status}`);
  const text = await res.text();
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('Sheet CSV came back empty');

  const cols = indexHeaders(rows[0]);
  if (cols.businessId === undefined || cols.businessName === undefined) {
    throw new Error('Expected "Business ID" and "Business Name" columns in the sheet header row');
  }

  const fallbackManagerId = await getOrCreateUnassignedManagerId(db);

  let created = 0;
  let updated = 0;

  for (const row of rows.slice(1)) {
    const mid = String(row[cols.businessId] || '').trim();
    const name = String(row[cols.businessName] || '').trim();
    if (!mid || !name) continue;

    const criteria = cols.criteria !== undefined ? String(row[cols.criteria] || '').trim() : null;
    const group = cols.group !== undefined ? String(row[cols.group] || '').trim() : null;
    const whatsapp = cols.whatsapp !== undefined ? String(row[cols.whatsapp] || '').trim() : null;

    const existing = await db.execute({ sql: 'SELECT id FROM merchants WHERE mid = ?', args: [mid] });

    if (existing.rows[0]) {
      // Preserve whatever AD manager is already assigned — the sheet never
      // decides ownership, only identity/grouping fields.
      await db.execute({
        sql: `UPDATE merchants SET name = ?, merchant_criteria = ?, whatsapp_group = ?, whatsapp_number = ?
              WHERE mid = ?`,
        args: [name, criteria, group, whatsapp, mid]
      });
      updated++;
    } else {
      await db.execute({
        sql: `INSERT INTO merchants (mid, name, ad_manager_id, merchant_criteria, whatsapp_group, whatsapp_number)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [mid, name, fallbackManagerId, criteria, group, whatsapp]
      });
      created++;
    }
  }

  console.log(`Merchant sync complete: ${created} created, ${updated} updated.`);
  return { created, updated };
}

if (require.main === module) {
  syncMerchants().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { syncMerchants };
