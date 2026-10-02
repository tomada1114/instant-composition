import type { ReactElement, ReactNode } from "react";

/**
 * `settings-row`: the label and its one-line note at the left, the control
 * at the right — or, when `wide`, the control across the row under its
 * label. The section draws the hairlines between rows.
 */
export function SettingsRow({
  id,
  label,
  note,
  aside,
  wide = false,
  children,
}: Readonly<{
  id?: string;
  label: string;
  note?: ReactNode;
  aside?: string;
  wide?: boolean;
  children: ReactNode;
}>): ReactElement {
  return (
    <div
      data-part="settings-row"
      className={
        wide
          ? "flex flex-col gap-3 py-4"
          : "flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3"
      }
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-4">
          <h3 id={id}>{label}</h3>
          {aside === undefined ? null : (
            <span className="font-latin text-count text-muted-foreground">{aside}</span>
          )}
        </div>
        {note}
      </div>
      {children}
    </div>
  );
}

/** One section of the page: its heading and `id`, then its rows between hairlines. */
export function SettingsSection({
  id,
  title,
  children,
}: Readonly<{ id: string; title: string; children: ReactNode }>): ReactElement {
  const headingId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="flex scroll-mt-8 flex-col gap-2"
    >
      <h2 id={headingId} className="text-heading">
        {title}
      </h2>
      <div className="flex flex-col divide-y-2 divide-border border-y-2 border-border">
        {children}
      </div>
    </section>
  );
}
