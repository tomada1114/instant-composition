import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { REFRESH_COOKIE, SESSION_COOKIE } from "@instant-composition/api";
import { SIGN_IN_URL } from "@instant-composition/web";

import {
  COUNT,
  fakeApi,
  fakeTimers,
  homeView,
  ja,
  landmarks,
  refusal,
  renderApp,
  settle,
  warmUp,
  type ApiCall,
} from "./web-harness";
import {
  makeWebApi,
  PASSWORD,
  WEB_ORIGIN,
  type WebHarness,
} from "./web-session-harness";

// The sign-in page at `/login`, mounted as the whole app: the shell's frame
// and the form standing before any read, each way a sign-in can end, and the
// entries that lead to it. The API is a stand-in behind `fetch`, or the real
// app over a fake user pool (tests/web-session-harness.ts) — never Cognito.

function where(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Records every URL the app hands `location.assign`, leaving the browser where it is. */
function stubAssign(): string[] {
  const visited: string[] = [];
  const real = window.location;
  vi.stubGlobal(
    "location",
    // A proxy over the real Location would break the invariant its
    // non-configurable `assign` imposes, so it wraps an empty target.
    new Proxy(
      {},
      {
        get: (_, key) => {
          if (key === "assign") {
            return (url: string) => {
              visited.push(url);
            };
          }
          const value: unknown = Reflect.get(real, key);
          const read: unknown = typeof value === "function" ? value.bind(real) : value;
          return read;
        },
      },
    ),
  );
  return visited;
}

/** A promise and the function that settles it, for an answer a test holds back. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** An API with no session: every read and every refresh refused, sign-ins answered by `signIn`. */
function serveSignedOut(
  signIn: (call: ApiCall) => Promise<Response> | Response,
): ApiCall[] {
  return fakeApi((call) =>
    call.url === SIGN_IN_URL ? signIn(call) : refusal(401, "ERR_UNAUTHENTICATED"),
  );
}

/** Types `email` and `password` into the form and submits it, as Enter in a field does. */
async function submit(email: string, password: string): Promise<void> {
  fireEvent.change(screen.getByLabelText(ja.Login.email), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(ja.Login.password), {
    target: { value: password },
  });
  const form = screen.getByLabelText(ja.Login.email).closest("form");
  if (form === null) throw new Error("The fields sit in no form.");
  fireEvent.submit(form);
  await settle();
}

const signIns = (calls: readonly ApiCall[]): ApiCall[] =>
  calls.filter((call) => call.url === SIGN_IN_URL);

beforeAll(warmUp);

beforeEach(() => {
  fakeTimers();
});

afterEach(() => {
  act(() => {
    window.history.replaceState(null, "", "/");
  });
});

describe("the sign-in page, signed out", () => {
  it("shows the shell's frame with the brand and the form while nothing has answered", async () => {
    fakeApi(() => new Promise<Response>(() => undefined));
    await renderApp("/login");

    expect(landmarks()).toStrictEqual(["main"]);
    const banner = screen.getByRole("banner");
    expect(banner).toHaveTextContent(ja.Nav.brand);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("heading", { name: ja.Login.title })).toBeInTheDocument();
    expect(screen.getByLabelText(ja.Login.email)).toHaveAttribute("type", "email");
    expect(screen.getByLabelText(ja.Login.password)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByRole("button", { name: ja.Login.submit })).toBeEnabled();
    // The skip link is the one link: no sign-up, reset, email change or help.
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toStrictEqual([
      ja.Nav.skip,
    ]);
  });

  it("stays on the form once home refuses, sent nowhere", async () => {
    const visited = stubAssign();
    const calls = serveSignedOut(() => new Response(null, { status: 204 }));
    await renderApp("/login");

    expect(where()).toBe("/login");
    expect(screen.getByRole("heading", { name: ja.Login.title })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent(ja.Nav.brand);
    expect(visited).toStrictEqual([]);
    expect(calls.map((call) => call.url)).toStrictEqual([
      "/api/v1/home",
      "/api/v1/auth/refresh",
      "/api/v1/home",
    ]);
  });

  it("is where the landing's sign-in link leads, inside the app", async () => {
    const visited = stubAssign();
    serveSignedOut(() => new Response(null, { status: 204 }));
    await renderApp("/");
    fireEvent.click(screen.getByRole("link", { name: ja.Landing.signIn }));
    await settle();
    await settle(16);

    expect(where()).toBe("/login");
    expect(screen.getByRole("heading", { name: ja.Login.title })).toBeInTheDocument();
    expect(visited).toStrictEqual([]);
  });
});

describe("a sign-in from the page", () => {
  it("posts the email and the password exactly as typed, then goes home by a full navigation", async () => {
    const visited = stubAssign();
    const calls = serveSignedOut(() => new Response(null, { status: 204 }));
    await renderApp("/login");
    await submit("learner@example.com", "  pass word 1!  ");

    expect(signIns(calls)).toStrictEqual([
      {
        method: "POST",
        url: "/api/v1/auth/login",
        body: { email: "learner@example.com", password: "  pass word 1!  " },
      },
    ]);
    expect(visited).toStrictEqual(["/"]);
  });

  it("takes no second sign-in while one is out, and says it is signing in", async () => {
    const visited = stubAssign();
    const answer = deferred<Response>();
    const calls = serveSignedOut(() => answer.promise);
    await renderApp("/login");
    await submit("learner@example.com", PASSWORD);
    await submit("learner@example.com", PASSWORD);

    const button = screen.getByRole("button", { name: ja.Login.sending });
    expect(button).toBeDisabled();
    expect(signIns(calls)).toHaveLength(1);
    expect(screen.getByLabelText(ja.Login.email)).toHaveAttribute("readonly");
    expect(visited).toStrictEqual([]);

    answer.resolve(new Response(null, { status: 204 }));
    await settle();
    expect(visited).toStrictEqual(["/"]);
  });

  it("says a refused password on the form, neither refreshing nor sending the browser to sign in, and sends again", async () => {
    const visited = stubAssign();
    const calls = serveSignedOut(() => refusal(401, "ERR_UNAUTHENTICATED"));
    await renderApp("/login");
    const before = calls.length;
    await submit("learner@example.com", "wrong");

    expect(screen.getByRole("alert")).toHaveTextContent(ja.Login.refused);
    expect(calls.slice(before).map((call) => call.url)).toStrictEqual([SIGN_IN_URL]);
    expect(visited).toStrictEqual([]);
    expect(where()).toBe("/login");
    expect(screen.getByRole("button", { name: ja.Login.submit })).toBeEnabled();

    await submit("learner@example.com", "wrong again");
    expect(calls.slice(before).map((call) => call.url)).toStrictEqual([
      SIGN_IN_URL,
      SIGN_IN_URL,
    ]);
    expect(visited).toStrictEqual([]);
  });

  it("asks for an administrator when the account needs one, offering no password change", async () => {
    const visited = stubAssign();
    serveSignedOut(() => refusal(403, "ERR_SIGN_IN_ACTION_REQUIRED"));
    await renderApp("/login");
    await submit("new@example.com", "Temporary1!");

    expect(screen.getByRole("alert")).toHaveTextContent(ja.Login.actionRequired);
    expect(document.querySelectorAll("input")).toHaveLength(2);
    expect(visited).toStrictEqual([]);
  });

  it.each([
    ["no answer at all", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a bare 500", () => new Response(null, { status: 500 })],
    ["the stand-in's unmatched 404", () => new Response(null, { status: 404 })],
  ] as const)("offers to try again after %s", async (_, answer) => {
    const visited = stubAssign();
    let failing = true;
    const calls = serveSignedOut(() =>
      failing ? answer() : new Response(null, { status: 204 }),
    );
    await renderApp("/login");
    await submit("learner@example.com", PASSWORD);

    expect(screen.getByRole("alert")).toHaveTextContent(ja.Login.failed);
    expect(screen.getByRole("alert")).not.toHaveTextContent(PASSWORD);
    expect(visited).toStrictEqual([]);

    failing = false;
    await submit("learner@example.com", PASSWORD);
    expect(signIns(calls)).toHaveLength(2);
    expect(visited).toStrictEqual(["/"]);
  });

  it("signs any email in through the same endpoint", async () => {
    stubAssign();
    const calls = serveSignedOut(() => refusal(401, "ERR_UNAUTHENTICATED"));
    await renderApp("/login");
    await submit("owner@example.com", PASSWORD);
    await submit("someone.else@example.org", PASSWORD);

    expect(signIns(calls).map((call) => [call.method, call.body])).toStrictEqual([
      ["POST", { email: "owner@example.com", password: PASSWORD }],
      ["POST", { email: "someone.else@example.org", password: PASSWORD }],
    ]);
  });
});

describe("the sign-in page, signed in already", () => {
  it("goes on to home, where the home page decides what comes next", async () => {
    const visited = stubAssign();
    fakeApi((call) =>
      call.url === "/api/v1/home"
        ? Response.json(homeView({ kind: "ready", streak: COUNT }))
        : undefined,
    );
    await renderApp("/login");
    await settle();
    await settle(16);

    expect(where()).toBe("/");
    expect(
      screen.getByRole("button", { name: ja.Home.today.start }),
    ).toBeInTheDocument();
    expect(visited).toStrictEqual([]);
  });

  it("goes on to the welcome for a first visit", async () => {
    fakeApi((call) =>
      call.url === "/api/v1/home"
        ? Response.json(homeView({ kind: "onboarding" }))
        : undefined,
    );
    await renderApp("/login");
    await settle();
    await settle(16);

    expect(where()).toBe("/welcome");
  });

  it("goes home on a local run with the stand-in, which serves no sign-in endpoint", async () => {
    // The stand-in answers every read signed in and `/v1/auth/*` with a bare 404.
    const calls = fakeApi((call) =>
      call.url === "/api/v1/home"
        ? Response.json(homeView({ kind: "ready", streak: COUNT }))
        : undefined,
    );
    await renderApp("/login");
    await settle();
    await settle(16);

    expect(where()).toBe("/");
    expect(calls.some((call) => call.url.startsWith("/api/v1/auth/"))).toBe(false);
  });
});

/** Routes the app's `fetch` to the real API's app, through a browser that keeps its cookies. */
function connect(web: WebHarness): string[] {
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/u, "");
    paths.push(path);
    return web.browser.request(
      init?.method ?? "GET",
      path,
      { origin: WEB_ORIGIN },
      typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    );
  });
  return paths;
}

describe("the sign-in page over the API, with a user pool configured", () => {
  it("signs an account in through the fake pool, keeping its tokens in the API's cookies", async () => {
    const visited = stubAssign();
    const web = makeWebApi();
    web.cognito.addUser("learner@example.com", { subject: "subject-a" });
    const paths = connect(web);
    await renderApp("/login");
    await submit("learner@example.com", PASSWORD);

    expect(visited).toStrictEqual(["/"]);
    expect([...web.browser.cookies.keys()].sort()).toStrictEqual(
      [REFRESH_COOKIE, SESSION_COOKIE].sort(),
    );
    expect(paths).toStrictEqual([
      "/v1/home",
      "/v1/auth/refresh",
      "/v1/home",
      "/v1/auth/login",
    ]);
    expect((await web.browser.request("GET", "/v1/home")).status).toBe(200);
  });

  it("shows a refused password and a temporary one on the form, issuing no cookie", async () => {
    const visited = stubAssign();
    const web = makeWebApi();
    web.cognito.addUser("learner@example.com");
    web.cognito.addUser("new@example.com", { state: "NEW_PASSWORD_REQUIRED" });
    const paths = connect(web);
    await renderApp("/login");
    const before = paths.length;
    await submit("learner@example.com", "not the password");

    expect(screen.getByRole("alert")).toHaveTextContent(ja.Login.refused);

    await submit("new@example.com", PASSWORD);

    expect(screen.getByRole("alert")).toHaveTextContent(ja.Login.actionRequired);
    expect(paths.slice(before)).toStrictEqual(["/v1/auth/login", "/v1/auth/login"]);
    expect(web.browser.cookies.size).toBe(0);
    expect(visited).toStrictEqual([]);
  });
});
