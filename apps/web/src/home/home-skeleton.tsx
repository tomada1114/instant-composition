import { useEffect, useState, type ReactElement } from "react";

import { TUNING } from "../lib/tuning";

/**
 * The start screen's placeholder: nothing for the first 300 ms, then `raised`
 * blocks the size of home's panels — the date row, today beside the streak,
 * the three tiles. No text, no spinner, no pulse.
 */
export function HomeSkeleton(): ReactElement {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setShown(true);
    }, TUNING.skeletonDelayMs);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  return (
    <div aria-hidden className="mx-auto flex w-full max-w-dashboard flex-col gap-6">
      {shown ? (
        <>
          <div className="h-11" />
          <div className="grid grid-cols-1 gap-6 pc:grid-cols-12">
            <div className="h-64 rounded-card bg-raised pc:col-span-8" />
            <div className="h-64 rounded-card bg-raised pc:col-span-4" />
          </div>
          <div className="grid grid-cols-1 gap-6 pc:grid-cols-3">
            <div className="h-48 rounded-card bg-raised" />
            <div className="h-48 rounded-card bg-raised" />
            <div className="h-48 rounded-card bg-raised" />
          </div>
        </>
      ) : null}
    </div>
  );
}
