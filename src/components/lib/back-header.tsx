"use client";

import { useEffect, type ReactElement } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { BackGlyph } from "@/components/ui/glyphs";

import { Link, useRouter } from "../../i18n/navigation";

/**
 * ← and the screen's title; Esc goes back too, unless `escape` is off
 * because something above the screen (a sheet) takes Esc first.
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
    <header className="flex flex-col gap-6">
      <IconButton asChild>
        <Link href="/" aria-label={back}>
          <BackGlyph />
        </Link>
      </IconButton>
      <h1 className="text-heading">{title}</h1>
    </header>
  );
}
