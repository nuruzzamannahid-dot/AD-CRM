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
}

module.exports = { getClient, initSchema };
