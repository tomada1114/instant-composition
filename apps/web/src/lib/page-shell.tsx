import type { ReactElement } from "react";

import { LoadFailedPanel } from "../home/home-empty";

/**
 * A screen whose read has not answered yet: the empty column, and nothing in
 * it — no spinner and no pulsing placeholder (`designing-ui`).
 */
export function PageLoading(): ReactElement {
  return <main className="mx-auto box-content flex min-h-dvh max-w-column px-4" />;
}

/** A screen whose read failed: say so, and read again on request. */
export function PageLoadFailed({
  onReload,
}: Readonly<{ onReload: () => void }>): ReactElement {
  return (
    <main className="mx-auto box-content flex min-h-[calc(100dvh-4rem)] max-w-column flex-col justify-center px-4 py-8">
      <LoadFailedPanel onReload={onReload} />
    </main>
  );
}
