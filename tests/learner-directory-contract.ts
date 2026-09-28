import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PROFILE,
  learnerId,
  signIn,
  type LearnerDirectory,
  type LearnerStores,
  type Profile,
} from "@instant-composition/application";

// The contract every LearnerDirectory adapter runs: the in-memory one and the
// DynamoDB one. What a registration writes and reads back, that it is one
// conditional commit, and that of what learner-bound reads return it adds only
// the learner's own profile — the entry a later change is written through.

const CONFLICT = { ok: false, error: { code: "ERR_CONFLICT" } };
const OK = { ok: true, value: undefined };

const LONDON: Profile = {
  timeZone: "Europe/London",
  l1: "ja",
  target: "en",
  uiLocale: "en",
};

/** A directory, and the learner stores on the same backing table. */
export interface DirectoryBacking {
  readonly directory: LearnerDirectory;
  readonly stores: LearnerStores;
}

/**
 * Runs the contract against what `makeBacking` builds, a fresh and empty set
 * for every case.
 */
export function describeLearnerDirectoryContract(
  name: string,
  makeBacking: () => DirectoryBacking | Promise<DirectoryBacking>,
): void {
  describe(`${name}: registration`, () => {
    let directory: LearnerDirectory;
    let stores: LearnerStores;

    beforeEach(async () => {
      ({ directory, stores } = await makeBacking());
    });

    it("knows no subject before it registers", async () => {
      expect(await directory.learnerOf("subject-a")).toBeUndefined();
    });

    it("reads a registration back exactly as it was written", async () => {
      const registered = await directory.register("subject-a", {
        learnerId: learnerId("learner-a"),
        profile: LONDON,
      });

      expect(registered).toStrictEqual(OK);
      expect(await directory.learnerOf("subject-a")).toStrictEqual({
        learnerId: "learner-a",
        profile: {
          timeZone: "Europe/London",
          l1: "ja",
          target: "en",
          uiLocale: "en",
        },
      });
    });

    it("refuses a second registration of a subject, keeping the first", async () => {
      await directory.register("subject-a", {
        learnerId: learnerId("learner-a"),
        profile: LONDON,
      });

      const again = await directory.register("subject-a", {
        learnerId: learnerId("learner-b"),
        profile: DEFAULT_PROFILE,
      });

      expect(again).toStrictEqual(CONFLICT);
      expect((await directory.learnerOf("subject-a"))?.learnerId).toBe("learner-a");
    });

    it("writes neither item when the learner already has a profile", async () => {
      await directory.register("subject-a", {
        learnerId: learnerId("learner-a"),
        profile: LONDON,
      });

      const reused = await directory.register("subject-b", {
        learnerId: learnerId("learner-a"),
        profile: DEFAULT_PROFILE,
      });

      expect(reused).toStrictEqual(CONFLICT);
      expect(await directory.learnerOf("subject-b")).toBeUndefined();
      expect((await directory.learnerOf("subject-a"))?.profile).toStrictEqual(LONDON);
    });

    it("keeps subjects apart whatever they contain", async () => {
      const subjects = ["a#LEARNER", "a", "a%23LEARNER", "IDENTITY#a"];
      for (const [index, subject] of subjects.entries()) {
        await directory.register(subject, {
          learnerId: learnerId(`learner-${String(index)}`),
          profile: DEFAULT_PROFILE,
        });
      }

      const found = await Promise.all(
        subjects.map(
          async (subject) => (await directory.learnerOf(subject))?.learnerId,
        ),
      );

      expect(found).toStrictEqual(["learner-0", "learner-1", "learner-2", "learner-3"]);
    });

    it("adds only the profile to what the learner's own store reads", async () => {
      await directory.register("subject-a", {
        learnerId: learnerId("learner-a"),
        profile: LONDON,
      });
      const store = stores.forLearner(learnerId("learner-a"));

      expect(await store.profile()).toStrictEqual({ value: LONDON, version: 1 });
      expect(await stores.forLearner(learnerId("learner-b")).profile()).toBeUndefined();
      expect(await store.settings()).toBeUndefined();
      expect(await store.stats()).toBeUndefined();
      expect(await store.reviews()).toStrictEqual([]);
      expect((await store.items()).size).toBe(0);
    });
  });

  describe(`${name}: the profile after registration`, () => {
    let directory: LearnerDirectory;
    let stores: LearnerStores;

    beforeEach(async () => {
      ({ directory, stores } = await makeBacking());
      await directory.register("subject-a", {
        learnerId: learnerId("learner-a"),
        profile: LONDON,
      });
    });

    it("signs in with a profile the learner's own store changed", async () => {
      const paris: Profile = { ...LONDON, timeZone: "Europe/Paris" };
      const changed = await stores.forLearner(learnerId("learner-a")).commit({
        puts: [],
        updates: [{ entry: { type: "profile", value: paris }, version: 1 }],
        expect: [],
      });

      expect(changed).toStrictEqual(OK);
      expect(await directory.learnerOf("subject-a")).toStrictEqual({
        learnerId: "learner-a",
        profile: paris,
      });
    });

    it("keeps another learner's change out of the registered learner's profile", async () => {
      await stores.forLearner(learnerId("learner-b")).commit({
        puts: [{ type: "profile", value: { ...LONDON, timeZone: "Asia/Tokyo" } }],
        updates: [],
        expect: [],
      });

      expect((await directory.learnerOf("subject-a"))?.profile).toStrictEqual(LONDON);
    });
  });

  describe(`${name}: first sign-ins racing`, () => {
    let directory: LearnerDirectory;

    beforeEach(async () => {
      ({ directory } = await makeBacking());
    });

    it("commits exactly one of two registrations of the same subject", async () => {
      const results = await Promise.all(
        ["learner-a", "learner-b"].map((id) =>
          directory.register("subject-a", {
            learnerId: learnerId(id),
            profile: DEFAULT_PROFILE,
          }),
        ),
      );

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      const winner = results[0]?.ok === true ? "learner-a" : "learner-b";
      expect((await directory.learnerOf("subject-a"))?.learnerId).toBe(winner);
    });

    it("signs every one of them in as the same learner", async () => {
      let minted = 0;
      const deps = {
        directory,
        newLearnerId: () => {
          minted += 1;
          return learnerId(`learner-${String(minted)}`);
        },
      };

      const signedIn = await Promise.all(
        Array.from({ length: 4 }, () => signIn(deps, "subject-a")),
      );

      const ids = signedIn.map((result) => (result.ok ? result.value.id : null));
      expect(ids).not.toContain(null);
      expect(new Set(ids).size).toBe(1);
      expect(ids[0]).toBe((await directory.learnerOf("subject-a"))?.learnerId);
    });
  });
}
