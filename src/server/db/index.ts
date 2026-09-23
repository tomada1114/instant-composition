import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { DailySize, Settings, SubtopicRef } from "../../core/types";
import { answerMethods } from "./answers";
import { migrate, userVersion } from "./migrations";
import { roundMethods } from "./rounds";
import { integer, json, nullableText, text } from "./rows";
import type { LevelReason, ProgressStore } from "./types";

export type {
  LevelEntry,
  LevelReason,
  NewRound,
  PortionRow,
  ProgressStore,
  RoundRow,
  TitleRow,
} from "./types";

const DAILY_SIZES: readonly DailySize[] = [5, 10, 15, 20, 30];

function isSubtopicRef(value: unknown): value is SubtopicRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "topic" in value &&
    "subtopic" in value &&
    typeof value.topic === "string" &&
    typeof value.subtopic === "string"
  );
}

function levelReason(value: string): LevelReason {
  if (value === "placement" || value === "up" || value === "down") {
    return value;
  }
  throw new TypeError("Column reason is not a level reason.");
}

/**
 * Opens (creating if needed) the progress database and migrates it.
 *
 * @param file - A path, or `:memory:` for a database that lives as long as the store.
 */
export function openProgressStore(file: string): ProgressStore {
  if (file !== ":memory:") {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  if (file !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);

  return {
    ...roundMethods(db),
    ...answerMethods(db),
    schemaVersion: () => userVersion(db),
    close: () => {
      db.close();
    },
    transaction<T>(body: () => T): T {
      db.exec("BEGIN");
      try {
        const value = body();
        db.exec("COMMIT");
        return value;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    getSettings() {
      const row = db.prepare("SELECT * FROM settings WHERE id = 1").get();
      if (row === undefined) {
        return undefined;
      }
      const topics = json(row, "topics");
      const focus = json(row, "focus");
      const size = DAILY_SIZES.find(
        (candidate) => candidate === integer(row, "daily_size"),
      );
      return {
        topics: Array.isArray(topics)
          ? topics.filter((t) => typeof t === "string")
          : [],
        focus: Array.isArray(focus) ? focus.filter(isSubtopicRef) : [],
        dailySize: size ?? 10,
        sound: integer(row, "sound") === 1,
      };
    },
    putSettings(settings: Settings) {
      db.prepare(
        `INSERT INTO settings (id, topics, focus, daily_size, sound) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET topics = excluded.topics, focus = excluded.focus,
           daily_size = excluded.daily_size, sound = excluded.sound`,
      ).run(
        JSON.stringify(settings.topics),
        JSON.stringify(
          settings.focus.map(({ topic, subtopic }) => ({ topic, subtopic })),
        ),
        settings.dailySize,
        settings.sound ? 1 : 0,
      );
    },
    currentLevel() {
      const row = db
        .prepare("SELECT * FROM level_history ORDER BY at DESC, id DESC LIMIT 1")
        .get();
      return row === undefined
        ? undefined
        : {
            level: integer(row, "level"),
            reason: levelReason(text(row, "reason")),
            roundId: nullableText(row, "round_id"),
            at: integer(row, "at"),
          };
    },
    addLevel(entry) {
      db.prepare(
        "INSERT INTO level_history (level, reason, round_id, at) VALUES (?, ?, ?, ?)",
      ).run(entry.level, entry.reason, entry.roundId, entry.at);
    },
    titles() {
      return db
        .prepare("SELECT * FROM titles ORDER BY awarded_at, key")
        .all()
        .map((row) => ({
          key: text(row, "key"),
          awardedAt: integer(row, "awarded_at"),
          roundId: text(row, "round_id"),
        }));
    },
    awardTitle(key, at, roundId) {
      db.prepare(
        "INSERT OR IGNORE INTO titles (key, awarded_at, round_id) VALUES (?, ?, ?)",
      ).run(key, at, roundId);
    },
  };
}
