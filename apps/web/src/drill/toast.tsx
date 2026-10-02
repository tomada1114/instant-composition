import { useEffect, useState, type ReactElement } from "react";

import { TUNING } from "../lib/tuning";
import { NoticeGlyph } from "../ui/glyphs";

/**
 * A 4-second notice above the bottom buttons and the tab bar under them,
 * shown again each time `signal` grows. Never red, and never for a success.
 */
export function Toast({
  signal,
  message,
}: Readonly<{ signal: number; message: string }>): ReactElement {
  const [expired, setExpired] = useState(0);

  useEffect(() => {
    if (signal === 0) return undefined;
    const timer = setTimeout(() => {
      setExpired(signal);
    }, TUNING.toastMs);
    return () => {
      clearTimeout(timer);
    };
  }, [signal]);

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--column-inset)+var(--tab-bar-space)+6rem)] z-20 mx-auto box-content max-w-column px-4"
    >
      {signal !== 0 && expired !== signal ? (
        <div className="flex items-center gap-3 rounded-control bg-raised px-4 py-3.5">
          <NoticeGlyph />
          <p>{message}</p>
        </div>
      ) : null}
    </div>
  );
}
