import { useRef, type KeyboardEvent, type ReactElement, type ReactNode } from "react";

import { cn } from "../lib/utils";

export interface TabOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/** The ids that tie the tab named `value` to its panel, under one `useId` prefix. */
function ids(prefix: string, value: string): { tab: string; panel: string } {
  return { tab: `${prefix}tab-${value}`, panel: `${prefix}panel-${value}` };
}

/** Where a key moves from `index` among `count` tabs; `undefined` for a key tabs ignore. */
function moved(key: string, index: number, count: number): number | undefined {
  switch (key) {
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

/**
 * `designing-ui`'s `tabs`: equal cells over a hairline, the current one white
 * with a white line under it. A roving tab stop: only the current tab takes
 * Tab, and ←/→ (wrapping), Home and End choose another and move focus to it.
 */
export function Tabs<T extends string>({
  id,
  labelledBy,
  options,
  value,
  onChange,
}: Readonly<{
  id: string;
  labelledBy: string;
  options: readonly TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
}>): ReactElement {
  const list = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const cells = [
      ...(list.current?.querySelectorAll<HTMLElement>("[role='tab']") ?? []),
    ];
    // Moved from the tab that has focus, which moves at once, not from `value`,
    // which a held key can outrun while the address catches up.
    const index = cells.findIndex((cell) => cell === event.target);
    const next = moved(event.key, index, options.length);
    const option = next === undefined ? undefined : options[next];
    if (index === -1 || next === undefined || option === undefined) return;
    event.preventDefault();
    onChange(option.value);
    cells[next]?.focus();
  }

  return (
    <div
      ref={list}
      role="tablist"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className="grid auto-cols-fr grid-flow-col border-b border-border"
    >
      {options.map((option) => {
        const selected = option.value === value;
        const { tab, panel } = ids(id, option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            id={tab}
            aria-selected={selected}
            aria-controls={selected ? panel : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              "relative h-11 text-label",
              selected ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {option.label}
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-0 -bottom-px h-0.5 bg-foreground",
                !selected && "hidden",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

/** The current tab's panel, named by its tab; the others are not rendered. */
export function TabPanel({
  id,
  value,
  className,
  children,
}: Readonly<{
  id: string;
  value: string;
  className?: string;
  children: ReactNode;
}>): ReactElement {
  const { tab, panel } = ids(id, value);
  return (
    <div role="tabpanel" id={panel} aria-labelledby={tab} className={className}>
      {children}
    </div>
  );
}
