import "server-only";

import { randomUUID } from "node:crypto";

import { createContentSource } from "./content";
import { openProgressStore } from "./db";
import { readServerEnv, storagePaths } from "./env";
import { createAnswersHandler } from "./handlers/answers";
import { createFinishHandler } from "./handlers/finish";
import { createHistoryHandler } from "./handlers/history";
import { createRoundsHandler } from "./handlers/rounds";
import { createSettingsHandler } from "./handlers/settings";
import { createServices, type Services } from "./services";

let services: Services | undefined;

/**
 * The one service layer of this process, built on first use.
 *
 * @remarks
 * Lazily, not at module load: `next build` imports every route module while
 * it collects page data, and opening the database there would create it at
 * build time on the build machine.
 */
export function getServices(): Services {
  if (services === undefined) {
    const paths = storagePaths(
      readServerEnv({ requiresAccessKey: false }),
      process.cwd(),
    );
    services = createServices({
      store: openProgressStore(paths.databasePath),
      content: createContentSource(paths.contentDir),
      now: () => Date.now(),
      newId: () => randomUUID(),
    });
  }
  return services;
}

const dependencies = { services: getServices };

export const roundsHandler = createRoundsHandler(dependencies);
export const answersHandler = createAnswersHandler(dependencies);
export const finishHandler = createFinishHandler(dependencies);
export const settingsHandler = createSettingsHandler(dependencies);
export const historyHandler = createHistoryHandler(dependencies);
