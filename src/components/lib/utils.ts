import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `twMerge`, told about the theme names `src/app/globals.css` adds.
 *
 * @remarks
 * `tailwind-merge` only knows Tailwind's default theme. Left alone it files an
 * unknown `text-answer` with the colors — so `text-answer` beside
 * `text-muted-foreground` silently loses the size — and treats `shadow-glow`
 * as a shadow color and `rounded-card` as no class it recognises. Every size,
 * radius, container and shadow token `globals.css` declares is listed here;
 * adding one there means adding it here too.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "caption",
        "label",
        "body",
        "point",
        "action",
        "heading",
        "front",
        "front-long",
        "answer",
        "alt",
        "mono-sm",
        "mono-md",
        "number-md",
        "number-lg",
      ],
      radius: ["card", "tile"],
      container: ["column"],
      shadow: ["glow"],
    },
  },
});

/**
 * Join class names and let the last Tailwind utility of a group win.
 *
 * @remarks
 * Every shadcn/ui component copied into `src/components/ui/` calls this, which
 * is why it sits at the path `components.json`'s `aliases.utils` names. `clsx`
 * resolves the conditional forms (an array, an object, a falsy value) into one
 * string; `twMerge` then drops the earlier of two utilities that set the same
 * property, so a `className` passed by a caller overrides the component's own
 * default instead of racing it in the stylesheet.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
