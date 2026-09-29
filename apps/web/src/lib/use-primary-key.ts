import { useEffect } from "react";

const INTERACTIVE =
  "a, button, input, select, textarea, summary, [role='button'], [contenteditable='true']";

/**
 * Space and Enter press the screen's primary action — the element marked
 * `data-primary` — unless focus is already on a control, which the browser
 * presses by itself. A focused link is the one exception: the browser follows
 * it on Enter but not on Space, so Space on a primary link presses it here.
 */
export function usePrimaryKey(): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== " " && event.key !== "Enter") return;
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const primary = document.querySelector<HTMLElement>("[data-primary]");
      if (primary === null) return;
      const onControl =
        event.target instanceof Element && event.target.closest(INTERACTIVE) !== null;
      const spaceOnLink =
        event.key === " " &&
        event.target === primary &&
        primary instanceof HTMLAnchorElement;
      if (onControl && !spaceOnLink) return;
      if (primary instanceof HTMLButtonElement && primary.disabled) return;
      event.preventDefault();
      primary.click();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
