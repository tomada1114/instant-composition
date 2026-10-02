import { useNavigate } from "@tanstack/react-router";
import { useRef, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { Toast } from "../drill/toast";
import { TabBar } from "../lib/tab-bar";
import { TalkLeaveSheet } from "./talk-leave-sheet";
import { TalkScreen } from "./talk-screen";
import { TalkStart } from "./talk-start";
import { keptTurns } from "./talk-state";
import { useKeyboardLift } from "./use-keyboard-lift";
import { useTalk } from "./use-talk";
import { useTalkAnnouncement } from "./use-talk-announcement";
import { useTalkKeys, useTalkLeave } from "./use-talk-guard";

/**
 * The talk tab, held in React state alone so a reload loses the talk: W2
 * until a talk opens, then W3 until 「新しい会話」. From the first line until
 * it ends, ✕, Esc, a tab and Back all ask first (W4). While a keyboard
 * covers a focused field, the tab bar steps aside for the lifted screen.
 */
export function TalkSession({ sound }: Readonly<{ sound: boolean }>): ReactElement {
  const t = useTranslations("Talk");
  const navigate = useNavigate();
  const { state, notice, actions } = useTalk(sound);
  const talk = state.kind === "talk" ? state.talk : undefined;
  const active = talk !== undefined && talk.step !== "ended";
  const leave = useTalkLeave(active);
  const announcement = useTalkAnnouncement(state);
  const main = useRef<HTMLElement>(null);
  const lifted = useKeyboardLift(main, talk?.step);

  useTalkKeys(() => {
    if (leave.asking !== undefined) leave.stay();
    else if (active) leave.ask();
    else void navigate({ to: "/" });
  }, leave.asking === undefined);

  function end(): void {
    const from = leave.asking;
    actions.end(from === "close");
    leave.leave();
  }

  return (
    <>
      {talk === undefined ? (
        <TalkStart
          status={state.kind === "talk" ? "idle" : state.kind}
          onStart={actions.start}
        />
      ) : (
        <TalkScreen
          talk={talk}
          actions={actions}
          onClose={leave.ask}
          main={main}
          lifted={lifted}
        />
      )}
      {lifted ? null : <TabBar />}
      {leave.asking !== undefined && talk !== undefined ? (
        <TalkLeaveSheet turns={keptTurns(talk)} onLeave={end} onStay={leave.stay} />
      ) : null}
      <Toast
        signal={notice.signal}
        message={notice.kind === "save" ? t("toast.save") : t("toast.judgment")}
      />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
