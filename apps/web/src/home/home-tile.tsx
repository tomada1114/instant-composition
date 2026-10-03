import { useId, type ReactElement, type ReactNode } from "react";

/** `home-tile`: the card, its title, its body, and what it leads to at its foot; the tile itself is no link. */
export function Tile({
  title,
  foot,
  children,
}: Readonly<{ title: string; foot: ReactNode; children?: ReactNode }>): ReactElement {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-card border-2 border-border bg-card p-5"
    >
      <h2 id={id} className="text-heading">
        {title}
      </h2>
      <div className="flex flex-1 flex-col gap-3">{children}</div>
      <div className="flex">{foot}</div>
    </section>
  );
}
