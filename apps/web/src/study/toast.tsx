import { useEffect, useState, type ReactElement } from "react";

import { useNavShown } from "../lib/frame";
import { TUNING } from "../lib/tuning";
import { cn } from "../lib/utils";
import { NoticeGlyph } from "../ui/glyphs";

/**
 * A 4-second notice at the bottom centre of the window, 24 up — beside the
 * shell's sidebar, centred on the content area — shown again each time
 * `signal` grows. Never red, and never for a success.
 */
export function Toast({
  signal,
  message,
}: Readonly<{ signal: number; message: string }>): ReactElement {
  const [expired, setExpired] = useState(0);
  const beside = useNavShown();

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
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-6 z-30 mx-auto box-content max-w-dialog px-4",
        beside && "pc:left-60",
      )}
    >
      {signal !== 0 && expired !== signal ? (
        <div className="flex items-center gap-3 rounded-control border-2 border-border bg-raised px-4 py-3.5">
          <NoticeGlyph />
          <p>{message}</p>
        </div>
      ) : null}
    </div>
  );
}
