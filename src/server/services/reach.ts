import {
  masteredCards,
  nearestMilestone,
  reachByTopic,
  resolvePlacement,
  ringProgress,
} from "../../core/mastery";
import type { SubtopicRef } from "../../core/types";
import type { ReachView } from "../../core/views";
import type { Progress } from "./progress";

export interface Reach {
  readonly before: Map<string, number>;
  readonly after: Map<string, number>;
  readonly view: ReachView;
  /** Mastered cards per `topic/subtopic`, for the records screen. */
  readonly where: ReadonlyMap<string, SubtopicRef>;
  readonly mastered: readonly string[];
}

/**
 * Mastered cards per topic now, and without the ones `roundId` mastered.
 * A deleted card keeps counting under its tombstone's topic.
 */
export function computeReach(progress: Progress, roundId: string | undefined): Reach {
  const mastered = masteredCards(progress.answers);
  const refs = (map: ReadonlyMap<string, SubtopicRef>) =>
    new Map([...map].map(([id, { topic, subtopic }]) => [id, { topic, subtopic }]));
  const where = resolvePlacement(
    refs(progress.content.known),
    refs(progress.content.tombstones),
    progress.answers,
  );
  const all = [...mastered.keys()];
  const earlier = [...mastered.values()]
    .filter((entry) => entry.roundId !== roundId)
    .map((entry) => entry.cardId);
  const after = reachByTopic(all, where);
  const before = reachByTopic(earlier, where);

  const chosen = progress.settings?.topics ?? [];
  const topics = progress.content.topics.filter((topic) => chosen.includes(topic.id));
  const nearest = nearestMilestone(
    after,
    topics.map((topic) => topic.id),
  );
  return {
    before,
    after,
    where,
    mastered: all,
    view: {
      topics: topics.map((topic) => {
        const count = after.get(topic.id) ?? 0;
        return {
          id: topic.id,
          ja: topic.ja,
          count,
          added: count - (before.get(topic.id) ?? 0),
          ring: ringProgress(count),
        };
      }),
      nearest:
        nearest === undefined
          ? null
          : {
              ja:
                topics.find((topic) => topic.id === nearest.topic)?.ja ?? nearest.topic,
              remaining: nearest.remaining,
            },
    },
  };
}
