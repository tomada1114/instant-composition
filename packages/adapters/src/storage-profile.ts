import { z } from "zod";
import { commonSchemas, id, object } from "./storage-common";

function makeProfileSchemas(strict: boolean) {
  const common = commonSchemas(strict);
  return {
    profile: object({ timeZone: id, l1: id, target: id, uiLocale: id }, strict),
    identity: object({ learnerId: id }, strict),
    settings: object(
      {
        topics: z.array(id),
        focus: z.array(common.placement),
        dailySize: z.union([
          z.literal(5),
          z.literal(10),
          z.literal(15),
          z.literal(20),
          z.literal(30),
        ]),
        sound: z.boolean(),
        limitSeconds: z
          .union([
            z.literal(15),
            z.literal(20),
            z.literal(30),
            z.literal(45),
            z.literal(60),
          ])
          .optional(),
        gradeKeys: object({ ok: id, ng: id, hard: id.optional() }, strict).optional(),
        newPerDay: z
          .union([
            z.literal(0),
            z.literal(3),
            z.literal(5),
            z.literal(10),
            z.literal(15),
          ])
          .optional(),
        reviewsPerDay: z
          .union([z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.null()])
          .optional(),
        vocabNewPerDay: z
          .union([
            z.literal(0),
            z.literal(5),
            z.literal(10),
            z.literal(15),
            z.literal(20),
            z.literal(30),
          ])
          .optional(),
        vocabReviewsPerDay: z
          .union([z.literal(50), z.literal(100), z.literal(200), z.null()])
          .optional(),
      },
      strict,
    ),
  };
}
export function profileSchemas(strict: boolean): ReturnType<typeof makeProfileSchemas> {
  return makeProfileSchemas(strict);
}
