import { useTranslations } from "use-intl";

import { currentTurn, type TalkState } from "./talk-state";

/**
 * What a screen reader hears as the talk moves: the speaker and the line as
 * a new one appears, 「○、直しなし」 for a ○, 「隠しました」 when the model answer
 * is hidden and the model answer when it is shown again. The waiting 「…」 is
 * never read; while a line is awaited the region falls silent.
 */
export function useTalkAnnouncement(state: TalkState): string {
  const t = useTranslations("Talk");
  if (state.kind !== "talk") return state.kind === "failed" ? t("start.failed") : "";
  const { talk } = state;
  const turn = currentTurn(talk);
  const line = (speaker: string, text: string): string =>
    t("announce.line", { speaker, text });
  switch (talk.step) {
    case "japanese":
    case "english":
    case "teacher":
      return line(t("speaker.partner"), turn.partnerLine);
    case "fine":
      return t("announce.fine");
    case "model":
      return line(t("speaker.teacher"), turn.judgment?.modelAnswer ?? "");
    case "hidden":
      return t("teacher.hidden");
    case "replyFailed":
    case "turnFailed":
      return line(t("speaker.partner"), t("reply.failed"));
    case "ended":
      return turn.reply?.closing === true
        ? line(t("speaker.partner"), turn.reply.line)
        : t("end.mark");
    default:
      return "";
  }
}
