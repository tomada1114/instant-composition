import { describe, expect, it } from "vitest";

import { roundPayloadSchema } from "@instant-composition/contracts";

import { batchFor, startedPlacement, type ApiHarness } from "./api-harness";

/** The unchanged HTTP acknowledgement and the adopted answer returned on reload. */
export function describeFirstAnswerHttpContract(
  name: string,
  makeApi: () => ApiHarness | Promise<ApiHarness>,
): void {
  describe(`${name}: adopted answers on reload`, () => {
    it("acknowledges different-id duplicates with 204 and reloads the first adopted result", async () => {
      const api = await makeApi();
      const round = await startedPlacement(api);
      const original = batchFor(round, "ng").answers[0];
      if (original === undefined) throw new Error("Placement dealt no cards.");
      expect(
        (await api.call("POST", "/v1/rounds/p1/answers", { answers: [original] }))
          .status,
      ).toBe(204);
      const duplicate = { ...original, id: "other-tab", result: "ok" };
      const acknowledged = await api.call("POST", "/v1/rounds/p1/answers", {
        answers: [duplicate],
      });
      expect(acknowledged.status).toBe(204);
      expect(await acknowledged.text()).toBe("");
      const reloaded = roundPayloadSchema.parse(
        await (await api.call("GET", "/v1/rounds/p1")).json(),
      );
      expect(reloaded.answered).toHaveLength(1);
      expect(reloaded.answered[0]).toMatchObject({
        id: original.id,
        cardId: original.cardId,
        result: "ng",
        grade: "again",
      });
      expect(
        (await api.call("POST", "/v1/rounds/p1/finish", { answers: [] })).status,
      ).toBe(200);
      expect(
        (await api.call("POST", "/v1/rounds/p1/answers", { answers: [original] }))
          .status,
      ).toBe(204);
    });
  });
}
