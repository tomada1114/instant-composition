import { useEffect } from "react";

const INTERACTIVE =
  "a, button, input, select, textarea, summary, [role='button'], [contenteditable='true']";

/**
 * Space and Enter press the screen's primary action — the button marked
 * `data-primary` — unless focus is already on a control, which the browser
 * presses by itself.
 */
export function usePrimaryKey(): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== " " && event.key !== "Enter") return;
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof Element && event.target.closest(INTERACTIVE) !== null)
        return;
      const primary = document.querySelector<HTMLButtonElement>("[data-primary]");
      if (primary === null || primary.disabled) return;
      event.preventDefault();
      primary.click();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
