import { useEffect, useState, type ReactElement } from "react";

import { TUNING } from "../lib/tuning";

/**
 * The start screen's placeholder: nothing for the first 300 ms, then blocks
 * where the figure, the week and the panel will be. No text, no spinner, no
 * pulse.
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
    <div aria-hidden className="mx-auto flex w-full max-w-reading flex-col gap-8">
      {shown ? (
        <>
          <div className="h-11" />
          <div className="my-auto flex flex-col gap-7">
            <div className="h-28 w-40 rounded-card bg-card" />
            <div className="h-9 w-full rounded-full bg-card" />
          </div>
          <div className="-mx-1 mt-auto h-64 rounded-card bg-card" />
        </>
      ) : null}
    </div>
  );
}
