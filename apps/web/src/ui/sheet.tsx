import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * `designing-ui`'s dialog: centered at every width, at most 440 wide, over a
 * 70% canvas scrim. It traps Tab inside itself, and puts focus on the element
 * marked `data-autofocus` when it opens.
 */
export function Sheet({
  titleId,
  children,
}: Readonly<{ titleId: string; children: ReactNode }>): ReactElement {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, []);

  function trapTab(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Tab" || panel.current === null) return;
    const focusable = [
      ...panel.current.querySelectorAll<HTMLElement>("button, [href], [tabindex]"),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    const leaving = event.shiftKey
      ? document.activeElement === first
      : document.activeElement === last;
    if (leaving) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-background/70 p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={trapTab}
        className="m-auto flex w-full max-w-dialog flex-col gap-6 rounded-panel border-2 border-border bg-popover p-7"
      >
        {children}
      </div>
    </div>
  );
}
