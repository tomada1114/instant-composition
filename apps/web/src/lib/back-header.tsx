import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactElement } from "react";

import { BackGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";

/** Esc goes to the start screen, unless `enabled` is off. */
function useEscapeHome(enabled = true): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!enabled) return undefined;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") void navigate({ to: "/" });
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled, navigate]);
}

/**
 * ← and the screen's title; Esc goes back too, unless `escape` is off
 * because something above the screen (a sheet) takes Esc first.
 */
export function BackHeader({
  title,
  back,
  escape = true,
}: Readonly<{ title: string; back: string; escape?: boolean }>): ReactElement {
  useEscapeHome(escape);

  return (
    <header className="flex flex-col gap-6">
      <IconButton asChild>
        <Link to="/" aria-label={back}>
          <BackGlyph />
        </Link>
      </IconButton>
      <h1 className="text-heading">{title}</h1>
    </header>
  );
}
