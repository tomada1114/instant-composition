import { browserVocabOutbox } from "./browser-outbox";
import type { AnswerInput } from "../study/study-state";
import { Navigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";
import { HOME_QUERY, isSignedOut } from "../lib/queries";
import { PageLoadFailed } from "../lib/page-shell";
import { FocusStrip } from "../lib/frame";
import { IconButton } from "../ui/icon-button";
import { CloseGlyph } from "../ui/glyphs";
import type { VocabSearch } from "./sessions";
import { requestPagedVocabSession } from "./paged-sessions";
import { vocabSessionId, clearVocabCheckpoint } from "./paged-checkpoint";
import { VocabStudy } from "./vocab-study";
import type { VocabPage } from "../openapi";

function StudyArrival({ search }: Readonly<{ search: VocabSearch }>): ReactElement {
  const home = useQuery(HOME_QUERY);
  const t = useTranslations("Nav");
  const [sessionId, setSessionId] = useState(() => vocabSessionId(search));
  const [attempt, retry] = useState(0);
  const [session, setSession] = useState<VocabPage>();
  const [pending, setPending] = useState<readonly AnswerInput[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const isActive = (): boolean => active;
    void requestPagedVocabSession(search, sessionId, isActive).then(async (result) => {
      if (!isActive()) return;
      if (result.ok) {
        const tail = await browserVocabOutbox(
          sessionId,
          result.value.generation,
        ).tail();
        if (!isActive()) return;
        setPending(tail);
        setSession(result.value);
      } else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [search, sessionId, attempt]);
  if (isSignedOut(home.error)) return <Navigate to="/" replace />;
  if (session !== undefined && home.data !== undefined)
    return (
      <VocabStudy
        key={session.sessionId}
        session={session}
        pending={pending}
        sound={home.data.sound}
        gradeKeys={home.data.gradeKeys}
        onRestart={() => {
          setSession(undefined);
          clearVocabCheckpoint(sessionId);
          setSessionId(vocabSessionId(search));
        }}
      />
    );
  return (
    <>
      <FocusStrip
        close={
          <IconButton plain asChild>
            <Link to="/vocab" aria-label={t("close")}>
              <CloseGlyph />
            </Link>
          </IconButton>
        }
      />
      {failed || home.isError ? (
        <PageLoadFailed
          onReload={() => {
            setFailed(false);
            void home.refetch();
            retry((value) => value + 1);
          }}
        />
      ) : null}
    </>
  );
}
/** Search changes deal a fresh session; failed starts retry their original request id. */
export function VocabStudyPage({
  search,
}: Readonly<{ search: VocabSearch }>): ReactElement {
  return (
    <StudyArrival key={`${search.kind}:${search.category ?? "all"}`} search={search} />
  );
}
