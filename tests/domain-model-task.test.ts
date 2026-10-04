import { describe, expect, it } from "vitest";
import {
  decideModelTask,
  type ModelTask,
  type ModelTaskKey,
} from "@instant-composition/domain";

const KEY: ModelTaskKey = {
  talkId: "t1",
  task: "talk-partner",
  turn: 1,
  promptVersion: "talk-partner@1",
};
const CLAIM: Extract<ModelTask, { state: "in-flight" }> = {
  key: KEY,
  claimId: "req:1",
  input: "first input",
  state: "in-flight",
  attempt: 1,
  duplicatePossible: false,
  startedAt: 1_000,
  leaseUntil: 31_000,
  expiresAt: 86_401,
};
const IDENTITY = {
  key: KEY,
  claimId: "req:1",
  input: "first input",
  attempt: 1,
  duplicatePossible: false,
  startedAt: 1_000,
  expiresAt: 86_401,
};

describe("semantic model task decisions", () => {
  it("claims absent work with a lease longer than the request and a separate expiry", () => {
    expect(decideModelTask(undefined, KEY, "first input", 1_000, "req")).toStrictEqual({
      kind: "claim",
      task: CLAIM,
    });
  });
  it("refuses a changed request even when a saved result or expired lease could be reused", () => {
    const result: ModelTask = {
      ...IDENTITY,
      state: "result",
      result: { saved: "answer" },
    };
    expect(decideModelTask(CLAIM, KEY, "changed input", 31_000, "req")).toStrictEqual({
      kind: "mismatch",
    });
    expect(decideModelTask(result, KEY, "changed input", 31_000, "req")).toStrictEqual({
      kind: "mismatch",
    });
  });
  it("replays the first saved result without a lease or another attempt", () => {
    const result: ModelTask = {
      ...IDENTITY,
      state: "result",
      result: { saved: "answer" },
    };
    expect(decideModelTask(result, KEY, "first input", 31_000, "req")).toStrictEqual({
      kind: "result",
      result: { saved: "answer" },
    });
  });
  it("waits through the last lease millisecond and marks recovery at its boundary unknown", () => {
    expect(decideModelTask(CLAIM, KEY, "first input", 30_999, "req")).toStrictEqual({
      kind: "busy",
    });
    expect(decideModelTask(CLAIM, KEY, "first input", 31_000, "req")).toStrictEqual({
      kind: "claim",
      task: {
        ...CLAIM,
        attempt: 2,
        claimId: "req:2",
        duplicatePossible: true,
        startedAt: 31_000,
        leaseUntil: 61_000,
        expiresAt: 86_431,
      },
    });
  });
  it("keeps an earlier unknown outcome visible after a known failed retry", () => {
    const failed: ModelTask = {
      ...IDENTITY,
      attempt: 2,
      duplicatePossible: true,
      state: "failed",
      reason: "denied",
      outcome: "known",
    };
    expect(decideModelTask(failed, KEY, "first input", 2_000, "req")).toStrictEqual({
      kind: "claim",
      task: {
        ...CLAIM,
        attempt: 3,
        claimId: "req:3",
        duplicatePossible: true,
        startedAt: 2_000,
        leaseUntil: 32_000,
        expiresAt: 86_402,
      },
    });
  });
  it("treats TTL-expired records as absent even before the table deletes them", () => {
    expect(decideModelTask(CLAIM, KEY, "new input", 86_401_000, "req")).toStrictEqual({
      kind: "claim",
      task: {
        ...CLAIM,
        input: "new input",
        startedAt: 86_401_000,
        leaseUntil: 86_431_000,
        expiresAt: 172_801,
      },
    });
  });
});
