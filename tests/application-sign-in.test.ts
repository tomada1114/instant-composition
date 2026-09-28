import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "@instant-composition/adapters";
import {
  learnerId,
  signIn,
  type LearnerDirectory,
  type LearnerId,
  type Registration,
} from "@instant-composition/application";

// signIn over the in-memory directory: a first sign-in registers, a later one
// finds, and a registration that lost its race answers the winner.

function counter(): { next: () => LearnerId; count: () => number } {
  let minted = 0;
  return {
    next: () => {
      minted += 1;
      return learnerId(`learner-${String(minted)}`);
    },
    count: () => minted,
  };
}

describe("signIn", () => {
  it("registers a first sign-in with the default profile and a fresh id", async () => {
    const directory = createMemoryDirectory();

    expect(
      await signIn({ directory, newLearnerId: counter().next }, "sub-1"),
    ).toStrictEqual({
      ok: true,
      value: {
        id: "learner-1",
        timeZone: "Asia/Tokyo",
        dayBoundaryHour: 4,
        l1: "ja",
        target: "en",
        uiLocale: "ja",
      },
    });
    expect((await directory.learnerOf("sub-1"))?.learnerId).toBe("learner-1");
  });

  it("answers a registered subject from its record, minting nothing", async () => {
    const directory = createMemoryDirectory();
    await directory.register("sub-1", {
      learnerId: learnerId("learner-9"),
      profile: { timeZone: "Europe/Paris", l1: "fr", target: "en", uiLocale: "fr" },
    });
    const ids = counter();

    const signedIn = await signIn({ directory, newLearnerId: ids.next }, "sub-1");

    expect(signedIn).toStrictEqual({
      ok: true,
      value: {
        id: "learner-9",
        timeZone: "Europe/Paris",
        dayBoundaryHour: 4,
        l1: "fr",
        target: "en",
        uiLocale: "fr",
      },
    });
    expect(ids.count()).toBe(0);
  });

  it("answers the learner that won the race when its own registration lost", async () => {
    const winner: Registration = {
      learnerId: learnerId("learner-won"),
      profile: { timeZone: "Asia/Tokyo", l1: "ja", target: "en", uiLocale: "ja" },
    };
    let registeredElsewhere = false;
    const directory: LearnerDirectory = {
      learnerOf: () => Promise.resolve(registeredElsewhere ? winner : undefined),
      register: () => {
        registeredElsewhere = true;
        return Promise.resolve({ ok: false, error: { code: "ERR_CONFLICT" } });
      },
    };

    const signedIn = await signIn({ directory, newLearnerId: counter().next }, "sub-1");

    expect(signedIn.ok && signedIn.value.id).toBe("learner-won");
  });

  it("answers ERR_CONFLICT after three registrations that each lost", async () => {
    const ids = counter();
    const directory: LearnerDirectory = {
      learnerOf: () => Promise.resolve(undefined),
      register: () => Promise.resolve({ ok: false, error: { code: "ERR_CONFLICT" } }),
    };

    expect(await signIn({ directory, newLearnerId: ids.next }, "sub-1")).toStrictEqual({
      ok: false,
      error: { code: "ERR_CONFLICT" },
    });
    expect(ids.count()).toBe(3);
  });
});
