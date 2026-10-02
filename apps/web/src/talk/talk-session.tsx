import { useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";

import { Toast } from "../drill/toast";
import { TalkLeaveDialog } from "./talk-leave-dialog";
import { TalkScreen } from "./talk-screen";
import { TalkStart } from "./talk-start";
import { keptTurns } from "./talk-state";
import { useTalk } from "./use-talk";
import { useTalkAnnouncement } from "./use-talk-announcement";
import { useTalkKeys, useTalkLeave } from "./use-talk-guard";

/**
 * The talk section, held in React state alone so a reload loses the talk: W2
 * under the shell's navigation until a talk opens, then W3 in the focus
 * layout until 「新しい会話」. From the first line until it ends, ✕, Esc, a
 * link and Back all ask first (W4).
 */
export function TalkSession({
  sound,
  turnCount,
}: Readonly<{ sound: boolean; turnCount: number }>): ReactElement {
  const t = useTranslations("Talk");
  const navigate = useNavigate();
  const { state, notice, actions } = useTalk(sound);
  const talk = state.kind === "talk" ? state.talk : undefined;
  const active = talk !== undefined && talk.step !== "ended";
  const leave = useTalkLeave(active);
  const announcement = useTalkAnnouncement(state);

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
          turnCount={turnCount}
          status={state.kind === "talk" ? "idle" : state.kind}
          onStart={actions.start}
        />
      ) : (
        <TalkScreen
          talk={talk}
          actions={actions}
          onClose={leave.ask}
          paused={leave.asking !== undefined}
        />
      )}
      {leave.asking !== undefined && talk !== undefined ? (
        <TalkLeaveDialog turns={keptTurns(talk)} onLeave={end} onStay={leave.stay} />
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
