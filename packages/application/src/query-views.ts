import type { Dot, HomeState, Settings, TopicInfo } from "@instant-composition/domain";

import type { ReachView } from "./views";

/** What a query hands back to a client, in the shapes the screens read. */

export interface HomePreview {
  readonly size: number;
  readonly setting: number;
  readonly shortage: boolean;
  readonly reviewCount: number;
  readonly newCount: number;
  readonly focusNames: readonly string[];
  readonly minutes: number;
}

export interface HomeView {
  readonly state: HomeState;
  readonly week: readonly Dot[];
  readonly preview: HomePreview | undefined;
  readonly todayRounds: number;
  readonly todayCards: number;
  /** The size an extra round is dealt at: "one more N". */
  readonly dailySize: number;
  readonly sound: boolean;
  readonly contentError: boolean;
}

export interface BreakdownTopic {
  readonly id: string;
  readonly ja: string;
  /** Mastered per subtopic, in the taxonomy's order. */
  readonly subtopics: readonly {
    readonly id: string;
    readonly ja: string;
    readonly count: number;
  }[];
}

/** The milestones taken in one row of the records screen: the streak, or one topic. */
export type TitleGroup =
  | { readonly kind: "streak"; readonly values: readonly number[] }
  | {
      readonly kind: "reach";
      readonly topic: string;
      readonly ja: string;
      readonly values: readonly number[];
    };

/** The long view, with nothing lit: no round has just moved anything. */
export interface RecordsView {
  readonly reach: ReachView;
  readonly breakdown: readonly BreakdownTopic[];
  readonly toeic: string | null;
  /** `current` 0 stands for "day 1 from today" and is never shown as 0. */
  readonly streak: { readonly current: number; readonly longest: number };
  /** Twelve weeks, oldest first, Monday to Sunday in each. */
  readonly calendar: readonly (readonly Dot[])[];
  readonly said: number;
  readonly practicedDays: number;
  readonly points: number;
  readonly titles: readonly TitleGroup[];
}

/** The settings as saved, what can be chosen, and the difficulty now. */
export interface SettingsPageView {
  readonly settings: Settings;
  readonly topics: readonly TopicInfo[];
  readonly toeic: string | null;
}

/** The shape `pnpm cards:gaps --history` reads. */
export interface History {
  readonly seenIds: readonly string[];
  readonly topics: readonly string[];
  readonly focusSubtopics: readonly string[];
  readonly estimatedLevel: number;
}
