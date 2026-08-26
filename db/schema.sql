-- CarryBee AD CRM schema (Turso / libSQL)

CREATE TABLE IF NOT EXISTS ad_managers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  initials    TEXT NOT NULL,
  email       TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS merchants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mid         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  ad_manager_id INTEGER REFERENCES ad_managers(id)
);

CREATE TABLE IF NOT EXISTS reason_tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT UNIQUE NOT NULL,
  sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dissatisfaction_subtags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT UNIQUE NOT NULL,
  sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id   INTEGER NOT NULL REFERENCES merchants(id),
  ad_manager_id INTEGER NOT NULL REFERENCES ad_managers(id),
  reason_tag    TEXT NOT NULL,
  sub_tag       TEXT,
  notes         TEXT,
  follow_up_date TEXT,
  status        TEXT NOT NULL DEFAULT 'reached',   -- 'reached' | 'no_answer'
  resolved      INTEGER NOT NULL DEFAULT 0,        -- 0/1, only meaningful for Dissatisfied
  created_at    TEXT NOT NULL DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at);
CREATE INDEX IF NOT EXISTS idx_calls_manager ON calls(ad_manager_id);
CREATE INDEX IF NOT EXISTS idx_calls_reason ON calls(reason_tag);
