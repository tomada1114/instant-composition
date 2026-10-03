/** A failure notice: which one, and a count that grows each time one is shown. */
export interface TalkNotice {
  readonly signal: number;
  readonly kind: "judgment" | "save";
}

/** What the talk screen's controls ask of the talk. */
export interface TalkActions {
  readonly start: () => void;
  readonly japanese: (text: string) => void;
  readonly english: (text: string | null) => void;
  readonly hide: () => void;
  readonly lookAgain: () => void;
  readonly said: () => void;
  readonly retry: () => void;
  /** Ends the talk on the server; `stay` keeps W3h on screen, so a failure can be told. */
  readonly end: (stay: boolean) => void;
}
