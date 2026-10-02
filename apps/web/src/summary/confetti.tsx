import { useEffect, useRef, useState, type ReactElement, type RefObject } from "react";

const PIECES = 30;
const DURATION_MS = 2500;
const SHAPES = ["bar", "dot", "square", "triangle"] as const;
const COLORS = ["bg-energy", "bg-energy-lip", "bg-good"] as const;

const SHAPE_CLASS: Readonly<Record<(typeof SHAPES)[number], string>> = {
  bar: "h-1 w-3 rounded-sm",
  dot: "size-2 rounded-full",
  square: "size-2.5",
  triangle: "size-3 [clip-path:polygon(50%_0,100%_100%,0_100%)]",
};

interface Piece {
  readonly shape: (typeof SHAPES)[number];
  readonly color: (typeof COLORS)[number];
  readonly dx: number;
  readonly dy: number;
  readonly spin: number;
  readonly delay: number;
}

/**
 * A fixed spread rather than `Math.random`, so every burst lands the same way:
 * the pieces fan out around the figure, rise, then settle a little lower.
 */
function pieces(): readonly Piece[] {
  return Array.from({ length: PIECES }, (_, index) => {
    const angle = (index / PIECES) * Math.PI * 2 + (index % 3) * 0.35;
    const reach = 110 + ((index * 37) % 5) * 45;
    return {
      shape: SHAPES[index % SHAPES.length] ?? "dot",
      color: COLORS[index % COLORS.length] ?? "bg-energy",
      dx: Math.round(Math.cos(angle) * reach * 1.6),
      dy: Math.round(Math.sin(angle) * reach * 0.55),
      spin: (index % 2 === 0 ? 1 : -1) * (180 + ((index * 53) % 360)),
      delay: (index % 6) * 25,
    };
  });
}

const SPREAD = pieces();

/**
 * The celebration's burst: 30 shapes thrown from the centre of `origin` and
 * gone after 2.5 s. It fills and clips to its positioned parent, so it never
 * reaches past the hero; the caller mounts it only when motion is allowed.
 */
export function Confetti({
  origin,
}: Readonly<{ origin: RefObject<HTMLElement | null> }>): ReactElement | null {
  const layer = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const host = layer.current;
    const from = origin.current;
    if (host === null) return undefined;
    const box = host.getBoundingClientRect();
    const mark = from?.getBoundingClientRect();
    const x =
      mark === undefined ? box.width / 2 : mark.left + mark.width / 2 - box.left;
    const y =
      mark === undefined ? box.height / 2 : mark.top + mark.height / 2 - box.top;
    host.querySelectorAll<HTMLElement>("[data-piece]").forEach((element, index) => {
      const piece = SPREAD[index];
      if (piece === undefined) return;
      element.style.left = `${String(x)}px`;
      element.style.top = `${String(y)}px`;
      if (typeof element.animate !== "function") return;
      element.animate(
        [
          { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
          {
            transform: `translate(${String(piece.dx * 0.8)}px, ${String(piece.dy - 60)}px) rotate(${String(piece.spin / 2)}deg)`,
            opacity: 1,
            offset: 0.45,
          },
          {
            transform: `translate(${String(piece.dx)}px, ${String(piece.dy + 30)}px) rotate(${String(piece.spin)}deg)`,
            opacity: 0,
          },
        ],
        {
          duration: DURATION_MS - piece.delay,
          delay: piece.delay,
          easing: "ease-out",
          fill: "both",
        },
      );
    });
    const timer = setTimeout(() => {
      setDone(true);
    }, DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [origin]);

  if (done) return null;
  return (
    <div
      ref={layer}
      data-confetti
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {SPREAD.map((piece, index) => (
        <span
          key={index}
          data-piece={piece.shape}
          className={`absolute -translate-1/2 ${SHAPE_CLASS[piece.shape]} ${piece.color}`}
        />
      ))}
    </div>
  );
}
