import type { DatabaseSync } from "node:sqlite";

/**
 * The schema, one entry per version. Append a new entry to change it; never
 * edit one that has shipped, since a database past it will not run it again.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    topics TEXT NOT NULL,
    focus TEXT NOT NULL,
    daily_size INTEGER NOT NULL,
    sound INTEGER NOT NULL
  );
  CREATE TABLE level_history (
    id INTEGER PRIMARY KEY,
    level INTEGER NOT NULL,
    reason TEXT NOT NULL,
    round_id TEXT,
    at INTEGER NOT NULL
  );
  CREATE TABLE rounds (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    day TEXT NOT NULL,
    portion_day TEXT,
    deck TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    abandoned_at INTEGER,
    summary TEXT
  );
  CREATE TABLE portions (
    credit_day TEXT PRIMARY KEY,
    target INTEGER NOT NULL,
    completed_at INTEGER,
    completed_round TEXT
  );
  CREATE TABLE answers (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id),
    card_id TEXT NOT NULL,
    pass TEXT NOT NULL,
    result TEXT NOT NULL,
    elapsed_ms INTEGER NOT NULL,
    limit_ms INTEGER NOT NULL,
    day TEXT NOT NULL,
    answered_at INTEGER NOT NULL,
    topic TEXT NOT NULL,
    subtopic TEXT NOT NULL,
    level INTEGER NOT NULL,
    ja TEXT NOT NULL
  );
  CREATE INDEX answers_card ON answers(card_id, answered_at);
  CREATE INDEX answers_round ON answers(round_id);
  CREATE TABLE titles (
    key TEXT PRIMARY KEY,
    awarded_at INTEGER NOT NULL,
    round_id TEXT NOT NULL
  );
  `,
];

function userVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get();
  const version = row?.["user_version"];
  return typeof version === "number" ? version : 0;
}

/** Brings `db` up to the last migration, each step in its own transaction. */
export function migrate(db: DatabaseSync): number {
  for (let version = userVersion(db); version < MIGRATIONS.length; version += 1) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version] ?? "");
      db.exec(`PRAGMA user_version = ${String(version + 1)}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return userVersion(db);
}

export { userVersion };
