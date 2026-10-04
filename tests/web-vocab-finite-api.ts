import { vocabSessionSchema, vocabSummarySchema } from "@instant-composition/contracts";
import type { VocabPage } from "@instant-composition/web";
import { fakeApi, type ApiCall } from "./web-harness";

/** Existing finite UX fixtures use the additive preparation/page wire protocol too. */
export function fakeFiniteVocabApi(
  respond: (call: ApiCall) => Response | undefined | Promise<Response>,
): ApiCall[] {
  const pages = new Map<string, VocabPage>();
  return fakeApi(async (call) => {
    if (call.url.endsWith("/page")) {
      const id = call.url.split("/").at(-2) ?? "";
      const page = pages.get(id);
      return page === undefined ? undefined : Response.json(page);
    }
    const response = await respond(call);
    if (response?.ok !== true) return response;
    if (call.url === "/api/v1/vocab/paged-sessions") {
      const session = vocabSessionSchema.parse(await response.json());
      const page: VocabPage = {
        ...session,
        generation: 1,
        page: 0,
        total: session.cards.length,
        answered: [],
        retained: [],
        continuation: null,
        cards: session.cards.map((card, slot) => ({ ...card, slot })),
      };
      const request = call.body as { sessionId: string };
      pages.set(request.sessionId, page);
      return Response.json({
        sessionId: request.sessionId,
        status: "ready",
        generation: 1,
        total: session.cards.length,
      });
    }
    if (call.url.endsWith("/finish")) {
      const summary = vocabSummarySchema.parse(await response.json());
      return Response.json({ ...summary, againCount: summary.again.length });
    }
    return response;
  });
}
