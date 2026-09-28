import type {
  LearnerDirectory,
  LearnerId,
  Profile,
  Registration,
} from "@instant-composition/application";
import { err, ok } from "@instant-composition/domain";

/** The identity context's records in memory, for tests and local runs. */
export function createMemoryDirectory(): LearnerDirectory {
  const learners = new Map<string, LearnerId>();
  const profiles = new Map<LearnerId, Profile>();
  return {
    learnerOf(subject) {
      const learnerId = learners.get(subject);
      const profile = learnerId === undefined ? undefined : profiles.get(learnerId);
      if (learnerId === undefined || profile === undefined) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve<Registration>({ learnerId, profile: { ...profile } });
    },
    register(subject, { learnerId, profile }) {
      if (learners.has(subject) || profiles.has(learnerId)) {
        return Promise.resolve(err({ code: "ERR_CONFLICT" }));
      }
      learners.set(subject, learnerId);
      profiles.set(learnerId, { ...profile });
      return Promise.resolve(ok(undefined));
    },
  };
}
