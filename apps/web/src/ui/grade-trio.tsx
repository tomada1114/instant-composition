import type { ReactElement } from "react";

import { GRADES, keyLabel } from "../lib/grade-keys";
import type { Grade } from "../openapi";
import { Button } from "./button";
import { CloseGlyph, RingGlyph, TriangleGlyph } from "./glyphs";
import { Kbd } from "./kbd";

const GLYPHS = { again: CloseGlyph, hard: TriangleGlyph, good: RingGlyph } as const;

/**
 * `grade-trio`: × and △ as `secondary`, ○ as `good`, left to right, a third
 * of the width each. Each button carries its name over its next interval in
 * `caption` — none on a re-ask — and, in keys mode, its grade's key; a "←"
 * hint sits at the start edge, so it points the way it is pressed.
 */
export function GradeTrio({
  names,
  intervals,
  keys,
  onGrade,
}: Readonly<{
  names: Readonly<Record<Grade, string>>;
  /** Each grade's interval as it reads; `undefined` on a re-ask. */
  intervals: Readonly<Record<Grade, string>> | undefined;
  /** Each grade's first key, as a `KeyboardEvent.code`. */
  keys: Readonly<Record<Grade, string>>;
  onGrade: (grade: Grade) => void;
}>): ReactElement {
  return (
    <div className="grid grid-cols-3 gap-3">
      {GRADES.map((grade) => {
        const Glyph = GLYPHS[grade];
        const interval = intervals?.[grade];
        return (
          <Button
            key={grade}
            variant={grade === "good" ? "good" : "secondary"}
            className="px-3"
            aria-label={
              interval === undefined ? names[grade] : `${names[grade]} ${interval}`
            }
            onClick={() => {
              onGrade(grade);
            }}
          >
            <Glyph className="size-4.5" />
            <span className="flex flex-col items-start">
              <span>{names[grade]}</span>
              {interval === undefined ? null : (
                <span className="text-caption">{interval}</span>
              )}
            </span>
            <Kbd side={keys[grade] === "ArrowLeft" ? "start" : "end"}>
              {keyLabel(keys[grade])}
            </Kbd>
          </Button>
        );
      })}
    </div>
  );
}
