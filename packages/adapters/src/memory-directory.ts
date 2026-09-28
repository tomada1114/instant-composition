import type {
  LearnerDirectory,
  LearnerId,
  LearnerStores,
} from "@instant-composition/application";
import { err } from "@instant-composition/domain";

/**
 * The identity context's records in memory, for tests and local runs. The
 * profile is kept in `stores`, as the learner's own `profile` entry — the same
 * item the DynamoDB directory writes — so a change made through the
 * learner-bound store is what the next sign-in reads.
 */
export function createMemoryDirectory(stores: LearnerStores): LearnerDirectory {
  const learners = new Map<string, LearnerId>();
  // Subjects whose registration is under way: refused to a second one, and
  // mapped only once the profile is written, so nothing reads a half-made one.
  const claimed = new Set<string>();
  return {
    async learnerOf(subject) {
      const learnerId = learners.get(subject);
      if (learnerId === undefined) {
        return undefined;
      }
      const profile = await stores.forLearner(learnerId).profile();
      return profile === undefined ? undefined : { learnerId, profile: profile.value };
    },
    async register(subject, { learnerId, profile }) {
      if (learners.has(subject) || claimed.has(subject)) {
        return err({ code: "ERR_CONFLICT" });
      }
      claimed.add(subject);
      const written = await stores.forLearner(learnerId).commit({
        puts: [{ type: "profile", value: profile }],
        updates: [],
        expect: [],
      });
      claimed.delete(subject);
      if (written.ok) {
        learners.set(subject, learnerId);
      }
      return written;
    },
  };
}
