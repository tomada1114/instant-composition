import type { DatabaseSync } from "node:sqlite";

import type { AnswerRecord, AnswerResult, Pass } from "../../core/types";
import { integer, text, type Row } from "./rows";
import type { ProgressStore } from "./types";

function pass(value: string): Pass {
  if (value === "first" || value === "retry") {
    return value;
  }
  throw new TypeError("Column pass is not a pass.");
}

function result(value: string): AnswerResult {
  if (value === "ok" || value === "ng" || value === "timeout") {
    return value;
  }
  throw new TypeError("Column result is not a result.");
}

function toAnswer(row: Row): AnswerRecord {
  return {
    id: text(row, "id"),
    roundId: text(row, "round_id"),
    cardId: text(row, "card_id"),
    pass: pass(text(row, "pass")),
    result: result(text(row, "result")),
    elapsedMs: integer(row, "elapsed_ms"),
    limitMs: integer(row, "limit_ms"),
    day: text(row, "day"),
    answeredAt: integer(row, "answered_at"),
    topic: text(row, "topic"),
    subtopic: text(row, "subtopic"),
    level: integer(row, "level"),
    ja: text(row, "ja"),
  };
}

type AnswerMethods = Pick<
  ProgressStore,
  "insertAnswer" | "allAnswers" | "answersOfRound"
>;

export function answerMethods(db: DatabaseSync): AnswerMethods {
  return {
    insertAnswer(answer) {
      const outcome = db
        .prepare(
          `INSERT OR IGNORE INTO answers
            (id, round_id, card_id, pass, result, elapsed_ms, limit_ms, day, answered_at, topic, subtopic, level, ja)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          answer.id,
          answer.roundId,
          answer.cardId,
          answer.pass,
          answer.result,
          answer.elapsedMs,
          answer.limitMs,
          answer.day,
          answer.answeredAt,
          answer.topic,
          answer.subtopic,
          answer.level,
          answer.ja,
        );
      return Number(outcome.changes) > 0;
    },
    allAnswers() {
      return db
        .prepare("SELECT * FROM answers ORDER BY answered_at, id")
        .all()
        .map(toAnswer);
    },
    answersOfRound(roundId) {
      return db
        .prepare("SELECT * FROM answers WHERE round_id = ? ORDER BY answered_at, id")
        .all(roundId)
        .map(toAnswer);
    },
  };
}
