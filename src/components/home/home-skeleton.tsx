"use client";

import { useEffect, useState, type ReactElement } from "react";

import { TUNING } from "../../core/tuning";

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
    <main
      aria-hidden
      className="mx-auto box-content flex min-h-[calc(100dvh-1.75rem)] max-w-column flex-col gap-10 px-4 pt-4 pb-3"
    >
      {shown ? (
        <>
          <div className="h-11" />
          <div className="my-auto flex flex-col gap-7">
            <div className="h-28 w-40 rounded-tile bg-card" />
            <div className="h-9 w-full rounded-bar bg-card" />
          </div>
          <div className="-mx-1 mt-auto h-64 rounded-card bg-card" />
        </>
      ) : null}
    </main>
  );
}
