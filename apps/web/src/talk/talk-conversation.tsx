import type { ReactElement } from "react";
import { Conversation } from "./conversation";
import type { Talk } from "./talk-state";
import { useTalkCards } from "./use-talk-cards";

/** Session-owned candidate calls, mounted with a fresh lifetime for every talk. */
export function TalkConversation({
  talk,
  kept,
}: Readonly<{ talk: Talk; kept: boolean }>): ReactElement {
  const eligible =
    talk.step === "ended" &&
    kept &&
    talk.turns.some((turn) => turn.judgment?.verdict === "corrected");
  const cards = useTalkCards(talk.talkId, eligible);
  return <Conversation talk={talk} cards={cards} />;
}
