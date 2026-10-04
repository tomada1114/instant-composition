import { retryAt } from "./retry-after";

/** Waiting polls the bounded read only; a screen never advances a corpus rebuild. */
export async function waitForPreparedRead(
  initial: Response,
  read: () => Promise<Response>,
  codeOf: (body: unknown) => string | undefined,
): Promise<Response> {
  let response = initial;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (
      response.status !== 503 ||
      codeOf(
        await response
          .clone()
          .json()
          .catch(() => null),
      ) !== "ERR_READ_MODEL_NOT_READY"
    )
      return response;
    const deadline = retryAt(response.headers.get("Retry-After"));
    const delay = Math.max(
      250,
      Math.min(2_000, (deadline ?? Date.now() + 2_000) - Date.now()),
    );
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delay);
    });
    response = await read();
  }
  return response;
}
