"use client";

import { useEffect, useState, type ReactElement } from "react";

import { TUNING } from "../../core/tuning";

/**
 * The start screen's placeholder: nothing for the first 300 ms, then blocks
 * where the figures, the week and the button will be. No text, no spinner,
 * no pulse.
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
      className="mx-auto box-content flex min-h-[calc(100dvh-2rem)] max-w-column flex-col gap-8 px-4 py-4"
    >
      {shown ? (
        <>
          <div className="h-11" />
          <div className="h-16 w-20 rounded-tile bg-raised" />
          <div className="h-5 w-52 rounded-full bg-raised" />
          <div className="h-12 w-48 rounded-tile bg-raised" />
          <div className="mt-auto h-14 w-full rounded-full bg-raised" />
        </>
      ) : null}
    </main>
  );
}
