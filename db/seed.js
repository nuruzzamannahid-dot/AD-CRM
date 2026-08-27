// One-off seed: reason tags, dissatisfaction sub-tags, and a couple of
// sample AD managers / merchants so the app isn't empty on first run.
// Safe to re-run — uses INSERT OR IGNORE on unique columns.
require('dotenv').config();
const { getClient, initSchema } = require('../lib/db');

const REASON_TAGS = [
  'FB Boost', 'Market Closure', 'Stock / Production Issue', 'Regular Fluctuation',
  'Dissatisfied', 'Registered but Not Interested Right Now', 'Unidentified',
  'Newly Onboarded', 'Business Inactive', 'Project', 'API', 'Election Impact',
  'Pickup Closed on MGT Decision', 'Campaign Off', 'Active from Alternative Account', 'Rate'
];

const SUBTAGS = [
  'Delivery Delay', 'Return Delay', 'MP Issue', 'Rate Issue', 'Payment Issue',
  'Fake Return', 'High Return', 'OTP Issue', 'Damage Issue', 'Pickup Issue', 'Adjustment Issue'
];

const MANAGERS = [
  { name: 'Nuruzzaman Nahid', initials: 'NN', email: 'nahid@carrybee.com' },
  { name: 'Ahmed Asif Rashid', initials: 'AR', email: 'asif@carrybee.com' },
  { name: 'Solayman Shadik', initials: 'SS', email: 'solayman@carrybee.com' }
];

const MERCHANTS = [
  { mid: 'MID-88213', name: 'Zaman Traders' },
  { mid: 'MID-77031', name: 'Nabila Fashion House' },
  { mid: 'MID-90144', name: 'Green Grocer BD' },
  { mid: 'MID-65590', name: 'Anika Cosmetics' },
  { mid: 'MID-51287', name: 'Doulot Enterprise' }
];

async function seed() {
  await initSchema();
  const db = getClient();

  for (const [i, t] of REASON_TAGS.entries()) {
    await db.execute({ sql: 'INSERT OR IGNORE INTO reason_tags (name, sort_order) VALUES (?, ?)', args: [t, i] });
  }
  for (const [i, s] of SUBTAGS.entries()) {
    await db.execute({ sql: 'INSERT OR IGNORE INTO dissatisfaction_subtags (name, sort_order) VALUES (?, ?)', args: [s, i] });
  }
  for (const m of MANAGERS) {
    await db.execute({ sql: 'INSERT OR IGNORE INTO ad_managers (name, initials, email) VALUES (?, ?, ?)', args: [m.name, m.initials, m.email] });
  }
  const managers = await db.execute('SELECT id FROM ad_managers');
  const firstManagerId = managers.rows[0]?.id ?? null;
  for (const m of MERCHANTS) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO merchants (mid, name, ad_manager_id) VALUES (?, ?, ?)',
      args: [m.mid, m.name, firstManagerId]
    });
  }

  console.log('Seed complete.');
}

seed().catch((e) => { console.error(e); process.exit(1); });
