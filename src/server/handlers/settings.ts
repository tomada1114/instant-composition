import { settingsPatchSchema } from "../../core/api";
import { readBody, respond, type HandlerDependencies } from "./respond";

/** `PUT /api/settings`: saves the fields given and reports how the change took effect. */
export function createSettingsHandler(
  dependencies: HandlerDependencies,
): (request: Request) => Promise<Response> {
  return async function handleSettings(request: Request): Promise<Response> {
    const body = await readBody(
      request,
      settingsPatchSchema,
      "an object with any of topics, focus, dailySize (5, 10, 15, 20 or 30) and sound",
    );
    if (!body.ok) {
      return body.error;
    }
    const { topics, focus, dailySize, sound } = body.value;
    return respond(
      dependencies.services().updateSettings({
        ...(topics === undefined ? {} : { topics }),
        ...(focus === undefined ? {} : { focus }),
        ...(dailySize === undefined ? {} : { dailySize }),
        ...(sound === undefined ? {} : { sound }),
      }),
    );
  };
}
