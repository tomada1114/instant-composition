import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/**
 * How much shorter than the layout viewport the visual one must be before a
 * keyboard is taken to cover the page: more than a pinch zoom's rounding or a
 * hardware keyboard's accessory bar, which the tab bar already clears, and
 * less than any on-screen keyboard.
 */
const KEYBOARD_MIN_HEIGHT = 100;

function carryToBottom(main: HTMLElement): void {
  const conversation = main.querySelector("[data-conversation]");
  if (conversation !== null) conversation.scrollTop = conversation.scrollHeight;
}

/**
 * iOS Safari lays the page out as if its keyboard were not there, so a screen
 * fixed to the bottom edge sits under it. While a field inside `main` has
 * focus and the visual viewport is shorter than the layout one by a keyboard,
 * this writes the visual viewport's offset and height onto `main` as
 * `--visible-top` and `--visible-height` and answers true: the screen sits in
 * what the keyboard leaves visible, the tab bar steps aside, and the
 * conversation (`[data-conversation]`) is carried to its bottom whenever that
 * height changes. Where the layout viewport resizes for the keyboard itself —
 * a desktop, Android under `interactive-widget=resizes-content` — the two
 * viewports agree and it stays false. `step` re-reads focus when a step
 * swaps its field, which a browser need not report as a blur.
 */
export function useKeyboardLift(
  main: RefObject<HTMLElement | null>,
  step: string | undefined,
): boolean {
  const [lifted, setLifted] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport ?? null;
    if (viewport === null) return;
    const visual = viewport;

    function liftedBy(focused: EventTarget | null): HTMLElement | undefined {
      const element = main.current;
      const field =
        element !== null &&
        focused instanceof HTMLTextAreaElement &&
        element.contains(focused);
      // iOS Safari's `innerHeight` follows the visual viewport, so the layout
      // viewport is read from the root's `clientHeight`, which no keyboard moves.
      const covered =
        document.documentElement.clientHeight - visual.height > KEYBOARD_MIN_HEIGHT;
      return field && covered ? element : undefined;
    }

    function sync(focused: EventTarget | null): void {
      const element = liftedBy(focused);
      if (element !== undefined) {
        element.style.setProperty("--visible-top", `${String(visual.offsetTop)}px`);
        element.style.setProperty("--visible-height", `${String(visual.height)}px`);
        carryToBottom(element);
      }
      setLifted(element !== undefined);
    }

    const onFocusIn = (event: FocusEvent): void => {
      sync(event.target);
    };
    const onFocusOut = (event: FocusEvent): void => {
      sync(event.relatedTarget);
    };
    const onViewport = (): void => {
      sync(document.activeElement);
    };
    // A button pressed under the lifted screen keeps the field's focus, and
    // the keyboard with it: a blur would drop the screen back under the
    // keyboard between the press and its click.
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("button") !== null &&
        liftedBy(document.activeElement)?.contains(target) === true
      ) {
        event.preventDefault();
      }
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("mousedown", onMouseDown);
    visual.addEventListener("resize", onViewport);
    visual.addEventListener("scroll", onViewport);
    onViewport();
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("mousedown", onMouseDown);
      visual.removeEventListener("resize", onViewport);
      visual.removeEventListener("scroll", onViewport);
    };
  }, [main, step]);

  useLayoutEffect(() => {
    if (main.current !== null) carryToBottom(main.current);
  }, [main, lifted]);

  return lifted;
}
