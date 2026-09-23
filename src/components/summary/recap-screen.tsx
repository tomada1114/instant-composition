"use client";

import type { ReactElement } from "react";

import type { RoundSummary } from "../../core/views";
import { SummaryScreen } from "./summary-screen";

function ignore(): void {
  // W9r has no buttons below, so nothing asks for another round.
}

/** W9r: today's last summary read back from the server, every value final. */
export function RecapScreen({
  summary,
}: Readonly<{ summary: RoundSummary }>): ReactElement {
  return <SummaryScreen summary={summary} mode="recap" dailySize={0} onNext={ignore} />;
}
