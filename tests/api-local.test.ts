import { describe, expect, it } from "vitest";

import { ensureTable, localAuthenticator } from "@instant-composition/api";

// The pieces only a local run wires: the stand-in learner, and the learner
// table made on first start.

describe("localAuthenticator", () => {
  const request = new Request("http://localhost/api/v1/home");

  it("makes every request the one local learner, acting as themselves", async () => {
    expect(
      await localAuthenticator({ id: undefined, timeZone: undefined }).authenticate(
        request,
      ),
    ).toStrictEqual({
      actor: { kind: "learner", learnerId: "local-learner" },
      learner: {
        id: "local-learner",
        timeZone: "Asia/Tokyo",
        dayBoundaryHour: 4,
        l1: "ja",
      },
    });
  });

  it("takes the learner's id and time zone the local run was given", async () => {
    const identity = await localAuthenticator({
      id: "learner-2",
      timeZone: "Europe/London",
    }).authenticate(request);
    expect(identity.actor).toStrictEqual({ kind: "learner", learnerId: "learner-2" });
    expect(identity.learner).toMatchObject({
      id: "learner-2",
      timeZone: "Europe/London",
    });
  });
});

describe("ensureTable", () => {
  it("creates the table when there is none", async () => {
    expect(await ensureTable(() => Promise.resolve())).toBe(true);
  });

  it("takes a table that already exists as there", async () => {
    const exists = Object.assign(new Error("Cannot create preexisting table"), {
      name: "ResourceInUseException",
    });
    expect(await ensureTable(() => Promise.reject(exists))).toBe(false);
  });

  it("passes on any other failure", async () => {
    const refused = new Error("connect ECONNREFUSED");
    await expect(ensureTable(() => Promise.reject(refused))).rejects.toBe(refused);
  });
});
