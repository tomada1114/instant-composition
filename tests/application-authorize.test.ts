import { describe, expect, it } from "vitest";

import {
  authorize,
  LEARNER_OPERATIONS,
  learnerId,
  requestContext,
  SYSTEM_OPERATIONS,
  type Actor,
  type OperationKind,
} from "@instant-composition/application";

const ME = learnerId("learner-a");
const OPERATIONS: readonly OperationKind[] = [
  ...LEARNER_OPERATIONS,
  ...SYSTEM_OPERATIONS,
];

const ACTORS: Readonly<Record<string, Actor>> = {
  learner: { kind: "learner", learnerId: ME },
  "rebuild job": { kind: "system", job: "rebuild-projections", onBehalfOf: ME },
  "agent granted home and records": {
    kind: "agent",
    onBehalfOf: ME,
    grants: ["home", "records"],
  },
  "agent granted a system operation": {
    kind: "agent",
    onBehalfOf: ME,
    grants: ["rebuildProjections"],
  },
};

/** Every actor against every operation: the table ADR-0005 asks for. */
const ALLOWED: Readonly<Record<string, readonly OperationKind[]>> = {
  learner: LEARNER_OPERATIONS,
  "rebuild job": ["rebuildProjections"],
  "agent granted home and records": ["home", "records"],
  "agent granted a system operation": [],
};

const cases = Object.entries(ACTORS).flatMap(([name, actor]) =>
  OPERATIONS.map(
    (kind) => [name, kind, actor, ALLOWED[name]?.includes(kind) ?? false] as const,
  ),
);

describe("authorize", () => {
  it.each(cases)("%s running %s: allowed %#", (_, kind, actor, allowed) => {
    expect(authorize(actor, { kind })).toStrictEqual(
      allowed
        ? { ok: true, value: undefined }
        : { ok: false, error: { code: "ERR_FORBIDDEN" } },
    );
  });
});

describe("requestContext", () => {
  const learner = { id: ME, timeZone: "Asia/Tokyo", dayBoundaryHour: 4, l1: "ja" };

  it.each(Object.entries(ACTORS))("accepts %s acting for the learner", (_, actor) => {
    const context = { actor, learner, now: 0, requestId: "req-1" };
    expect(requestContext(context)).toStrictEqual({ ok: true, value: context });
  });

  it.each<[string, Actor]>([
    ["a learner", { kind: "learner", learnerId: learnerId("learner-b") }],
    [
      "a job",
      {
        kind: "system",
        job: "rebuild-projections",
        onBehalfOf: learnerId("learner-b"),
      },
    ],
    [
      "an agent",
      { kind: "agent", onBehalfOf: learnerId("learner-b"), grants: ["home"] },
    ],
  ])("refuses %s acting for another learner", (_, actor) => {
    expect(
      requestContext({ actor, learner, now: 0, requestId: "req-1" }),
    ).toStrictEqual({
      ok: false,
      error: { code: "ERR_FORBIDDEN" },
    });
  });
});

describe("learnerId", () => {
  it("refuses an empty id", () => {
    expect(() => learnerId("")).toThrow(RangeError);
  });
});
