export interface GrowthRow {
  readonly cardId: string;
  readonly prompt: string | null;
  /** `faster`: correct both times and quicker now. `fixed`: missed last time, correct now. */
  readonly kind: "faster" | "fixed";
  /** Last time's elapsed minus this time's; the list is sorted on it. */
  readonly deltaMs: number;
}

export interface Growth {
  readonly faster: number;
  readonly fixed: number;
  readonly compared: number;
  readonly firstTime: number;
  readonly rows: readonly GrowthRow[];
}

export interface ReviewRow {
  readonly cardId: string;
  readonly prompt: string | null;
}
