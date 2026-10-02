import { Link, Outlet } from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslations } from "use-intl";

import { CloseGlyph } from "../ui/glyphs";
import { IconButton } from "../ui/icon-button";
import { ShellNav, SkipLink } from "./shell-nav";
import { cn } from "./utils";

/** What a screen tells the frame around it; each returns the matching release. */
interface FrameControl {
  readonly showNav: () => () => void;
  readonly holdStrip: () => () => void;
}

const NO_FRAME: FrameControl = {
  showNav: () => () => undefined,
  holdStrip: () => () => undefined,
};

const Control = createContext<FrameControl>(NO_FRAME);
const NavShown = createContext(false);

/** A counter a screen raises while it is mounted and lowers when it leaves. */
function useClaims(): readonly [number, () => () => void] {
  const [count, setCount] = useState(0);
  const claim = useMemo(
    () => () => {
      setCount((n) => n + 1);
      return () => {
        setCount((n) => n - 1);
      };
    },
    [],
  );
  return [count, claim];
}

/**
 * Shows the shell's navigation while the calling screen is mounted, once a
 * read has said who is signed in — so home's skeleton and the landing,
 * which never call it, show none. Off when `shown` is false. A no-op
 * outside the shell, as in a focus layout.
 */
export function useShellNav(shown = true): void {
  const { showNav } = useContext(Control);
  useLayoutEffect(() => (shown ? showNav() : undefined), [showNav, shown]);
}

/** Whether the shell's navigation is on screen, which the toast centres beside. */
export function useNavShown(): boolean {
  return useContext(NavShown);
}

/** The focus strip's ✕ when its screen names no other: home, at once. */
function CloseHome(): ReactElement {
  const t = useTranslations("Nav");
  return (
    <IconButton plain asChild>
      <Link to="/" aria-label={t("close")}>
        <CloseGlyph />
      </Link>
    </IconButton>
  );
}

interface StripParts {
  close?: ReactNode;
  progress?: ReactNode;
  counters?: ReactNode;
}

/** The strip itself: fixed across the top, under any dialog. */
function Strip({
  close = <CloseHome />,
  progress,
  counters,
}: Readonly<StripParts>): ReactElement {
  return (
    <div
      data-part="focus-strip"
      className="fixed inset-x-0 top-0 z-10 grid h-16 grid-cols-[1fr_minmax(0,35rem)_1fr] items-center gap-4 bg-background px-4 sm:px-6"
    >
      <div className="flex justify-start">{close}</div>
      <div>{progress}</div>
      <div className="flex items-center justify-end gap-3">{counters}</div>
    </div>
  );
}

/**
 * `designing-ui`'s focus strip: 64 tall across the top of the window, ✕ at
 * the left, `progress` centred (at most 560), `counters` at the right. A
 * screen that renders one also asks for the focus layout while it is
 * mounted, so a shell screen (the talk session) drops the navigation with
 * it. `close` defaults to going home.
 */
export function FocusStrip(parts: Readonly<StripParts>): ReactElement {
  const { holdStrip } = useContext(Control);
  useLayoutEffect(holdStrip, [holdStrip]);
  return <Strip {...parts} />;
}

const SHELL_MAIN = "p-4 outline-none sm:p-6 pc:px-10 pc:pt-8 pc:pb-12";
const FOCUS_MAIN =
  "mx-auto flex min-h-dvh w-full max-w-stage flex-col justify-center px-4 pt-16 outline-none sm:px-6";

/**
 * The one frame every signed-in screen sits in: the skip link, the
 * navigation and `main`, in that order, or — in the focus layout — the strip
 * and the stage. The children keep their place either way, so a screen that
 * asks for the focus layout while mounted is not mounted again.
 */
function Frame({ focus: always }: Readonly<{ focus: boolean }>): ReactElement {
  const [navs, showNav] = useClaims();
  const [strips, holdStrip] = useClaims();
  const control = useMemo(() => ({ showNav, holdStrip }), [showNav, holdStrip]);
  const focus = always || strips > 0;
  const nav = !focus && navs > 0;
  return (
    <Control.Provider value={control}>
      <NavShown.Provider value={nav}>
        {nav ? <SkipLink /> : null}
        {nav ? <ShellNav /> : null}
        {always && strips === 0 ? <Strip /> : null}
        <main
          id="main"
          tabIndex={-1}
          className={focus ? FOCUS_MAIN : cn(SHELL_MAIN, nav && "pc:ml-60")}
        >
          <Outlet />
        </main>
      </NavShown.Provider>
    </Control.Provider>
  );
}

/** The layout route of the hub screens: home, talk, records and settings. */
export function ShellLayout(): ReactElement {
  return <Frame focus={false} />;
}

/** The layout route of `/drill` and `/recap`: no navigation, the strip and the stage. */
export function FocusLayout(): ReactElement {
  return <Frame focus />;
}
