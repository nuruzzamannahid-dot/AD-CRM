const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

let client;

function getClient() {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error(
      'TURSO_DATABASE_URL is not set. Copy .env.example to .env and fill in your Turso ' +
      'database URL and auth token (from `turso db show <db-name>` and `turso db tokens create <db-name>`).'
    );
  }

  client = createClient({ url, authToken });
  return client;
}

async function initSchema() {
  const db = getClient();
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await db.execute(stmt);
  }

  await migrateMerchantColumns(db);
}

// schema.sql's CREATE TABLE IF NOT EXISTS only applies on first create, so a
// table that already exists in your live Turso DB won't pick up new columns
// automatically. Add them here, one at a time, ignoring "duplicate column"
// errors so this is safe to run on every boot.
async function migrateMerchantColumns(db) {
  const columns = [
    { name: 'merchant_criteria', ddl: 'ALTER TABLE merchants ADD COLUMN merchant_criteria TEXT' },
    { name: 'whatsapp_group', ddl: 'ALTER TABLE merchants ADD COLUMN whatsapp_group TEXT' },
    { name: 'whatsapp_number', ddl: 'ALTER TABLE merchants ADD COLUMN whatsapp_number TEXT' }
  ];
  for (const col of columns) {
    try {
      await db.execute(col.ddl);
      console.log(`Migrated: added merchants.${col.name}`);
    } catch (err) {
      if (!/duplicate column/i.test(err.message)) throw err;
    }
  }
}

module.exports = { getClient, initSchema };
