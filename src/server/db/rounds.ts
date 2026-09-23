import type { DatabaseSync } from "node:sqlite";

import type { DayKey, RoundKind } from "../../core/types";
import { integer, json, nullableInteger, nullableText, text, type Row } from "./rows";
import type { NewRound, PortionRow, ProgressStore, RoundRow } from "./types";

const ROUND_KINDS: readonly RoundKind[] = ["placement", "today", "yesterday", "extra"];

function roundKind(value: string): RoundKind {
  const kind = ROUND_KINDS.find((candidate) => candidate === value);
  if (kind === undefined) {
    throw new TypeError("Column kind is not a round kind.");
  }
  return kind;
}

function toRound(row: Row): RoundRow {
  const deck = json(row, "deck");
  const summary = nullableText(row, "summary");
  return {
    id: text(row, "id"),
    kind: roundKind(text(row, "kind")),
    day: text(row, "day"),
    portionDay: nullableText(row, "portion_day"),
    deck: Array.isArray(deck) ? deck.filter((id) => typeof id === "string") : [],
    startedAt: integer(row, "started_at"),
    finishedAt: nullableInteger(row, "finished_at"),
    abandonedAt: nullableInteger(row, "abandoned_at"),
    summary: summary === null ? null : (JSON.parse(summary) as unknown),
  };
}

function toPortion(row: Row): PortionRow {
  return {
    creditDay: text(row, "credit_day"),
    target: integer(row, "target"),
    completedAt: nullableInteger(row, "completed_at"),
    completedRound: nullableText(row, "completed_round"),
  };
}

type RoundMethods = Pick<
  ProgressStore,
  | "insertRound"
  | "getRound"
  | "activeRound"
  | "roundsOn"
  | "finishedRounds"
  | "updateDeck"
  | "finishRound"
  | "abandonRound"
  | "abandonOpenRoundsBefore"
  | "getPortion"
  | "insertPortion"
  | "setPortionTarget"
  | "completePortion"
  | "completedDays"
  | "completedPortions"
>;

export function roundMethods(db: DatabaseSync): RoundMethods {
  return {
    insertRound(round: NewRound) {
      db.prepare(
        "INSERT INTO rounds (id, kind, day, portion_day, deck, started_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        round.id,
        round.kind,
        round.day,
        round.portionDay,
        JSON.stringify(round.deck),
        round.startedAt,
      );
    },
    getRound(id) {
      const row = db.prepare("SELECT * FROM rounds WHERE id = ?").get(id);
      return row === undefined ? undefined : toRound(row);
    },
    activeRound(day: DayKey) {
      const row = db
        .prepare(
          "SELECT * FROM rounds WHERE day = ? AND finished_at IS NULL AND abandoned_at IS NULL ORDER BY started_at DESC LIMIT 1",
        )
        .get(day);
      return row === undefined ? undefined : toRound(row);
    },
    roundsOn(day) {
      return db
        .prepare("SELECT * FROM rounds WHERE day = ? ORDER BY started_at, id")
        .all(day)
        .map(toRound);
    },
    finishedRounds() {
      return db
        .prepare(
          "SELECT * FROM rounds WHERE finished_at IS NOT NULL ORDER BY finished_at, id",
        )
        .all()
        .map(toRound);
    },
    updateDeck(id, deck) {
      db.prepare("UPDATE rounds SET deck = ? WHERE id = ?").run(
        JSON.stringify(deck),
        id,
      );
    },
    finishRound(id, at, summary) {
      db.prepare("UPDATE rounds SET finished_at = ?, summary = ? WHERE id = ?").run(
        at,
        JSON.stringify(summary),
        id,
      );
    },
    abandonRound(id, at) {
      db.prepare("UPDATE rounds SET abandoned_at = ? WHERE id = ?").run(at, id);
    },
    abandonOpenRoundsBefore(day, at) {
      db.prepare(
        "UPDATE rounds SET abandoned_at = ? WHERE day < ? AND finished_at IS NULL AND abandoned_at IS NULL",
      ).run(at, day);
    },
    getPortion(creditDay) {
      const row = db
        .prepare("SELECT * FROM portions WHERE credit_day = ?")
        .get(creditDay);
      return row === undefined ? undefined : toPortion(row);
    },
    insertPortion(creditDay, target) {
      db.prepare("INSERT INTO portions (credit_day, target) VALUES (?, ?)").run(
        creditDay,
        target,
      );
    },
    setPortionTarget(creditDay, target) {
      db.prepare("UPDATE portions SET target = ? WHERE credit_day = ?").run(
        target,
        creditDay,
      );
    },
    completePortion(creditDay, at, roundId) {
      db.prepare(
        "UPDATE portions SET completed_at = ?, completed_round = ? WHERE credit_day = ? AND completed_at IS NULL",
      ).run(at, roundId, creditDay);
    },
    completedDays() {
      return new Set(
        db
          .prepare("SELECT credit_day FROM portions WHERE completed_at IS NOT NULL")
          .all()
          .map((row) => text(row, "credit_day")),
      );
    },
    completedPortions() {
      return db
        .prepare(
          "SELECT * FROM portions WHERE completed_at IS NOT NULL ORDER BY credit_day",
        )
        .all()
        .map(toPortion);
    },
  };
}
