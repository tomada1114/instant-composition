import type { ReactElement } from "react";

/**
 * The seconds left on a front: a thin accent fill shrinking to nothing and
 * the whole seconds beside it. It is information, so it keeps moving under
 * reduced motion, and it is never announced — the front's announcement
 * already states the limit.
 */
export function TimerBar({
  remainingMs,
  limitMs,
}: Readonly<{ remainingMs: number; limitMs: number }>): ReactElement {
  const share = limitMs > 0 ? Math.max(0, Math.min(1, remainingMs / limitMs)) : 0;
  return (
    <div aria-hidden className="flex h-7 items-center gap-4">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
        <div
          data-part="fill"
          data-motion="essential"
          className="h-full rounded-full bg-accent transition-[width] duration-100 ease-linear"
          style={{ width: `${String(share * 100)}%` }}
        />
      </div>
      <span className="w-8 text-right font-display text-figure-sm">
        {Math.ceil(Math.max(0, remainingMs) / 1000)}
      </span>
    </div>
  );
}
