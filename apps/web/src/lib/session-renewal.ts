/** Cookie changes share an origin-wide lock; no credential is exposed to script. */
const LOCK = "instant-composition-session";
const REVISION = `${LOCK}:revision`;
interface Browser {
  readonly document?: Document;
  readonly navigator?: { readonly locks?: LockManager };
  readonly localStorage?: Storage;
}
const browser: Browser = globalThis;
type Renewal = "renewed" | "expired" | "unavailable";
let localRevision = "";
let flight: Promise<Renewal> | undefined;
let leaving = false;
let attempt = 0;
let completed: Renewal = "expired";

interface Observation {
  readonly revision: string;
  readonly attempt: number;
}

/** Captures renewal state when the original request starts. */
export function observeSession(): Observation {
  return { revision: sessionRevision(), attempt };
}

/** A hint about cookie changes, never an authentication decision. */
export function sessionRevision(): string {
  try {
    return browser.localStorage?.getItem(REVISION) ?? localRevision;
  } catch {
    return localRevision;
  }
}

function changed(): void {
  localRevision = crypto.randomUUID();
  try {
    browser.localStorage?.setItem(REVISION, localRevision);
  } catch {
    // Blocked storage still permits this tab's shared renewal.
  }
}

function exclusively<T>(work: () => Promise<T>): Promise<T> {
  return browser.navigator?.locks?.request(LOCK, work) ?? work();
}

// Sign-out may change this flag while a renewal awaits its response.
function isLeaving(): boolean {
  return leaving;
}

/** A new document visit may renew again after signing out. */
export function visitSession(): void {
  leaving = false;
}

/** Shares one renewal and skips a late 401 after another completed renewal. */
export function renewSession(url: string, observed: Observation): Promise<Renewal> {
  if (leaving) return Promise.resolve("expired");
  if (browser.document !== undefined && browser.navigator?.locks === undefined) {
    return Promise.resolve("unavailable");
  }
  if (observed.attempt < attempt) return Promise.resolve(completed);
  flight ??= exclusively(async (): Promise<Renewal> => {
    if (isLeaving()) return "expired";
    if (sessionRevision() !== observed.revision) return "renewed";
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
    });
    if (response.status === 204) {
      changed();
      return isLeaving() ? "expired" : "renewed";
    }
    if (response.status === 404) return "expired";
    if (response.status !== 401) return "unavailable";
    const body: unknown = await response.json().catch(() => null);
    return typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "code" in body.error &&
      body.error.code === "ERR_UNAUTHENTICATED"
      ? "expired"
      : "unavailable";
  })
    .catch((): Renewal => "unavailable")
    .then((outcome) => {
      attempt += 1;
      completed = outcome;
      return outcome;
    })
    .finally(() => {
      flight = undefined;
    });
  return flight;
}

/**
 * Waits for renewal before the native logout navigation, holding the lock until
 * pagehide so another tab cannot rotate cookies while logout clears them.
 */
export async function submitSignOut(form: HTMLFormElement): Promise<void> {
  if (leaving) return;
  leaving = true;
  try {
    await flight;
    await exclusively(async () => {
      let done: () => void = () => undefined;
      const hidden = new Promise<void>((resolve) => {
        done = resolve;
      });
      window.addEventListener("pagehide", done, { once: true });
      try {
        HTMLFormElement.prototype.submit.call(form);
        changed();
        await hidden;
      } finally {
        window.removeEventListener("pagehide", done);
      }
    });
  } catch {
    leaving = false;
  }
}
