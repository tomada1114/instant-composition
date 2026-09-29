import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Esc goes to the start screen, unless `enabled` is off because something
 * above the screen (a sheet) takes Esc first.
 */
export function useEscapeHome(enabled = true): void {
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
