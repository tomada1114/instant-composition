"use client";

import { useEffect, type ReactElement } from "react";

import { Link, useRouter } from "../../i18n/navigation";

/**
 * "← back" and the screen's title; Esc goes back too, unless `escape` is
 * off because something above the screen (a sheet) takes Esc first.
 */
export function BackHeader({
  title,
  back,
  escape = true,
}: Readonly<{ title: string; back: string; escape?: boolean }>): ReactElement {
  const router = useRouter();

  useEffect(() => {
    if (!escape) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") router.push("/");
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [escape, router]);

  return (
    <header className="flex min-h-11 items-center gap-4">
      <Link
        href="/"
        className="flex h-11 items-center pr-2 text-muted-foreground active:text-foreground"
      >
        <span aria-hidden>←&nbsp;</span>
        {back}
      </Link>
      <h1>{title}</h1>
    </header>
  );
}
