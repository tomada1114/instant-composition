import { describe, expect, it } from "vitest";

import { ensureTable, localAuthenticator } from "@instant-composition/api";

// The pieces only a local run wires: the stand-in subject, and the learner
// table made on first start.

describe("localAuthenticator", () => {
  it.each([
    new Request("http://localhost/api/v1/home"),
    new Request("http://localhost/api/v1/settings", {
      headers: { authorization: "Bearer someone-else" },
    }),
  ])("makes every request the one local subject (%#)", async (request) => {
    expect(await localAuthenticator().authenticate(request)).toStrictEqual({
      subject: "local",
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
