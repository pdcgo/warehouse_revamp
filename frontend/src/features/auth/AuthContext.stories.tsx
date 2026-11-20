import { StrictMode, useEffect } from "react";
import { Stack, Text } from "@chakra-ui/react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { routedPage } from "../../../.storybook/pageStory";
import { authClient } from "../../api/clients";
import { CheckAccessResponseSchema } from "../../gen/warehouse/user/v1/user_pb";
import { AuthProvider, useAuth } from "./AuthContext";
import { AuthGate, ProtectedRoute } from "./AuthGate";
import { getToken, setToken } from "./tokenStorage";
import { checkRetry } from "./tokenVerdict";

// THE PAGE LOAD'S CheckAccess — what a failed one does to the session (tokenVerdict.ts).
//
// Only the SERVER's verdict signs a person out: Unauthenticated (garbage, expired past renewal, the user gone, minted
// before a password reset) or PermissionDenied (suspended) drops the token. A request the browser ABORTED — the person
// left the page while it was in flight — or a dropped connection is not a verdict: the token stays, and whoever was
// signed in stays signed in. The e2e tester's trace was exactly that: under StrictMode a dev page load checks twice, the
// person navigated while the second was in flight, and the next page opened on Sign in.
//
// And a load whose EVERY check failed with no verdict is not sent to Sign in either (#96): nobody is known to be signed
// out, so the shell keeps its spinner and the check goes out again (checkRetry: three more tries over ~10 s); when those
// are spent the gate says the server gave no answer, with Try Again — and the connection coming back or the window
// regaining focus asks again by itself.
//
//   | story                                     | the rule it pins                                                       |
//   | ----------------------------------------- | ---------------------------------------------------------------------- |
//   | AnExpiredTokenSignsOut                    | Unauthenticated → signed out, the token dropped                        |
//   | ASuspendedAccountSignsOut                 | PermissionDenied → signed out, the token dropped                       |
//   | AnAbortedSecondCheckKeepsTheSession       | StrictMode's 2nd check aborted after the 1st answered → still signed in |
//   | ADroppedConnectionKeepsTheToken           | the network fails on every try → never "signed out", the token kept    |
//   | EveryCheckAbortedKeepsTheShellLoading     | both checks of a load aborted → the spinner, no Sign in; a retry is in  |
//   | TheTriesSpentSayNoAnswer                  | every try fails → the no-answer panel (bounded), Try Again → in        |
//   | TheConnectionComingBackChecksAgain        | the panel up → focus / `online` asks again by itself                   |
//   | AVerdictOnARetryStillSignsOut             | no verdict, then the retry is answered Unauthenticated → Sign in       |
//   | AnExpiredTokenStillOpensSignIn            | the gate: a verdict on the load's check → Sign in, as before           |
//   | TheNoAnswerPanel (+ OnAPhone)             | the panel for review: its copy and Try Again, fitting the screen       |
//
// The API is spied on at the client (`authClient.checkAccess`), not the stub transport: each story decides how its
// CheckAccess fails, and the spy is restored after it. The waits between tries are shortened for the length of a story
// (`checkRetry.delaysMs`) and put back after it; their real values are pinned in tokenVerdict.test.ts.

const TOKEN = "a-session-token";

const signedIn = () =>
  create(CheckAccessResponseSchema, { identity: { identityId: 7n, username: "ani", agent: "storybook" }, token: "" });

const aborted = () => new ConnectError("The user aborted a request.", Code.Canceled);
const unavailable = () => new ConnectError("Service Unavailable", Code.Unavailable);
const expired = () => new ConnectError("token expired", Code.Unauthenticated);

/** What the provider says — who is signed in, once the check settled. */
function Probe() {
  const { identity, ready, unreachable } = useAuth();

  return (
    <Stack gap="1" data-testid="auth-probe">
      <Text data-testid="auth-probe-ready">{ready ? "ready" : "checking"}</Text>
      <Text data-testid="auth-probe-who">{identity ? `signed in as ${identity.username}` : "signed out"}</Text>
      <Text data-testid="auth-probe-unreachable">{unreachable ? "no answer" : "answered or asking"}</Text>
    </Stack>
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** CheckAccess answers with `answers[n]` on its n-th call (the last one repeats), each after `delayMs[n]`. */
function checkAccessAnswers(answers: (() => unknown)[], delayMs: number[] = []) {
  return checkAccessBy((n) => (answers[n] ?? answers[answers.length - 1]!)(), delayMs);
}

/** CheckAccess answers with `answer(n)` on its n-th call (from 0), each after `delayMs[n]`. */
function checkAccessBy(answer: (n: number) => unknown, delayMs: number[] = []) {
  let call = 0;
  const spy = spyOn(authClient, "checkAccess").mockImplementation(async () => {
    const n = call++;
    await sleep(delayMs[n] ?? 0);
    const said = answer(n);
    if (said instanceof Error) throw said;

    return said as ReturnType<typeof signedIn>;
  });

  return spy;
}

/** The spied CheckAccess's calls and their results. */
function checks() {
  return (authClient.checkAccess as unknown as { mock: { calls: unknown[]; results: { value: Promise<unknown> }[] } })
    .mock;
}

/** Every CheckAccess sent so far has ended (answered or failed). */
async function checksEnded() {
  await Promise.allSettled(checks().results.map((r) => r.value));
}

/** Shorten the waits between tries for one story; the returned function puts them back. */
function shortWaits(delaysMs: number[]) {
  const was = checkRetry.delaysMs;
  checkRetry.delaysMs = delaysMs;

  return () => {
    checkRetry.delaysMs = was;
  };
}

// ── The app's frame: AuthGate around the shell (ProtectedRoute) and around /login, as router.tsx has it ─────────────

/** How many times the Sign in route rendered during the story — the bug was ANY visit, however brief. */
const visits = { signIn: 0, shell: 0 };

function SignInMarker() {
  useEffect(() => {
    visits.signIn += 1;
  }, []);

  return <Text data-testid="at-sign-in">at-sign-in</Text>;
}

function ShellMarker() {
  useEffect(() => {
    visits.shell += 1;
  }, []);

  return (
    <Stack gap="1">
      <Text data-testid="at-shell">at-shell</Text>
      <Probe />
    </Stack>
  );
}

const TheApp = routedPage(
  [
    {
      path: "/",
      element: (
        <AuthGate>
          <ProtectedRoute>
            <ShellMarker />
          </ProtectedRoute>
        </AuthGate>
      ),
    },
    {
      path: "/login",
      element: (
        <AuthGate>
          <SignInMarker />
        </AuthGate>
      ),
    },
  ],
  "/",
);

/** A dev page load of the app: StrictMode (main.tsx), so the load sends its check twice. */
const appRender = () => (
  <StrictMode>
    <AuthProvider>
      <TheApp />
    </AuthProvider>
  </StrictMode>
);

const meta = {
  title: "Features/Auth/AuthProvider",
  render: () => (
    <AuthProvider>
      <Probe />
    </AuthProvider>
  ),
  beforeEach: () => {
    // preview.tsx's beforeEach clears the token; this story's session starts with one, in the tab's store.
    setToken(TOKEN, false);
    visits.signIn = 0;
    visits.shell = 0;
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function settled(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("auth-probe-ready")).toHaveTextContent("ready"), { timeout: 4000 });

  return canvas;
}

/** THE SERVER SAYS THE TOKEN IS NO GOOD (expired past renewal, garbage, the user gone): signed out, the token dropped. */
export const AnExpiredTokenSignsOut: Story = {
  name: "An Expired Token Signs Out",
  beforeEach: () => {
    const spy = checkAccessAnswers([expired]);
    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = await settled(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("auth-probe-who")).toHaveTextContent("signed out"));
    await expect(getToken()).toBeNull();
  },
};

/** A SUSPENDED ACCOUNT — the server's PermissionDenied is a verdict too: signed out, the token dropped. */
export const ASuspendedAccountSignsOut: Story = {
  name: "A Suspended Account Signs Out",
  beforeEach: () => {
    const spy = checkAccessAnswers([() => new ConnectError("account is suspended", Code.PermissionDenied)]);
    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = await settled(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("auth-probe-who")).toHaveTextContent("signed out"));
    await expect(getToken()).toBeNull();
  },
};

/**
 * THE TESTER'S TRACE — under StrictMode (main.tsx) a dev page load runs the check twice. The first answers (signed in);
 * the second is aborted by the browser because the person navigated while it was in flight (net::ERR_ABORTED). Nothing
 * about the token was said: the person stays signed in and the token stays for the next page.
 */
export const AnAbortedSecondCheckKeepsTheSession: Story = {
  name: "An Aborted Second Check Keeps the Session",
  render: () => (
    <StrictMode>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </StrictMode>
  ),
  beforeEach: () => {
    // Short waits, so a wrongful re-send of the aborted check would land inside the play.
    const restoreWaits = shortWaits([30, 30, 30]);
    const spy = checkAccessAnswers(
      [signedIn, aborted],
      // The abort lands AFTER the first answer — the order the trace showed.
      [0, 60],
    );
    return () => {
      spy.mockRestore();
      restoreWaits();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = await settled(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("auth-probe-who")).toHaveTextContent("signed in as ani"));

    // Both checks went out (StrictMode's mount, unmount, mount) — and the second has failed by now.
    await waitFor(() => expect(checks().calls.length).toBe(2));
    await checks().results[1]!.value.catch(() => undefined);
    await sleep(150);

    await expect(canvas.getByTestId("auth-probe-who")).toHaveTextContent("signed in as ani");
    await expect(getToken()).toBe(TOKEN);
    // The load had its answer: the failed second check is not sent again.
    await expect(checks().calls.length).toBe(2);
  },
};

/**
 * THE NETWORK FAILS ON LOAD (a dropped connection, the API restarting) — and on every try after: no verdict, so the
 * token stays, and the provider never says "signed out" (that is what sent the person to Sign in, #96). It keeps
 * asking — three more tries — then says there was no answer.
 */
export const ADroppedConnectionKeepsTheToken: Story = {
  name: "A Dropped Connection Keeps the Token",
  beforeEach: () => {
    const restoreWaits = shortWaits([30, 30, 30]);
    const spy = checkAccessAnswers([
      () => new ConnectError("Failed to fetch", Code.Unknown, undefined, undefined, new TypeError("Failed to fetch")),
    ]);
    return () => {
      spy.mockRestore();
      restoreWaits();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("auth-probe-unreachable")).toHaveTextContent("no answer"), {
      timeout: 4000,
    });

    // The load's check and its three re-sends — then no more until something asks.
    await checksEnded();
    await expect(checks().calls.length).toBe(4);
    await expect(canvas.getByTestId("auth-probe-ready")).toHaveTextContent("checking");
    await expect(canvas.getByTestId("auth-probe-who")).toHaveTextContent("signed out");
    await expect(getToken()).toBe(TOKEN);
  },
};

/**
 * #96 — EVERY CHECK OF THE LOAD IS ABORTED (StrictMode's pair, both cancelled): the shell stays on its spinner — never
 * the Sign in form — the token is kept, and the check is sent again; the retry answers, and the person is in.
 */
export const EveryCheckAbortedKeepsTheShellLoading: Story = {
  name: "Every Check Aborted Keeps the Shell Loading",
  parameters: { dataRouter: true },
  render: appRender,
  beforeEach: () => {
    // Long enough to see the spinner between the failed pair and the retry.
    const restoreWaits = shortWaits([400, 400, 400]);
    const spy = checkAccessAnswers([aborted, aborted, signedIn]);
    return () => {
      spy.mockRestore();
      restoreWaits();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Both checks of the load went out and both failed with no verdict…
    await waitFor(() => expect(checks().calls.length).toBe(2));
    await checksEnded();
    await sleep(50);

    // …and the shell is still loading: no Sign in, no app yet, the token where it was.
    await expect(canvas.getByTestId("auth-checking")).toBeVisible();
    await expect(canvas.queryByTestId("at-sign-in")).toBeNull();
    await expect(canvas.queryByTestId("auth-no-answer")).toBeNull();
    await expect(getToken()).toBe(TOKEN);

    // The retry answers: the person is in, without ever having seen Sign in.
    await waitFor(() => expect(canvas.getByTestId("at-shell")).toBeVisible(), { timeout: 4000 });
    await expect(canvas.getByTestId("auth-probe-who")).toHaveTextContent("signed in as ani");
    await expect(checks().calls.length).toBe(3);
    await expect(visits.signIn).toBe(0);
    await expect(getToken()).toBe(TOKEN);
  },
};

/** Down until the story says otherwise: `server.up` flips CheckAccess from 503 to an answer. */
const server = { up: false };
const upOrUnavailable = () => checkAccessBy(() => (server.up ? signedIn() : unavailable()));

/**
 * #96 — EVERY TRY FAILS (the API answers 503 throughout): after the load's pair and its three re-sends the gate says the
 * server gave no answer — the existing no-answer pattern, a warning with Try Again — not Sign in, the token kept, and it
 * stops asking. Try Again once the server is back: the person is in.
 */
export const TheTriesSpentSayNoAnswer: Story = {
  name: "The Tries Spent Say No Answer",
  parameters: { dataRouter: true },
  render: appRender,
  beforeEach: () => {
    server.up = false;
    const restoreWaits = shortWaits([30, 30, 30]);
    const spy = upOrUnavailable();
    return () => {
      spy.mockRestore();
      restoreWaits();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("auth-no-answer")).toBeVisible(), { timeout: 4000 });
    await expect(canvas.getByTestId("auth-no-answer-title")).toHaveTextContent("No answer from the server");
    await expect(canvas.queryByTestId("at-sign-in")).toBeNull();
    await expect(visits.signIn).toBe(0);
    await expect(getToken()).toBe(TOKEN);

    // Bounded: StrictMode's pair and three re-sends — and nothing more while nobody asks.
    await checksEnded();
    await expect(checks().calls.length).toBe(5);
    await sleep(200);
    await expect(checks().calls.length).toBe(5);

    // The server is back; Try Again asks once and the person is in.
    server.up = true;
    await userEvent.click(canvas.getByTestId("auth-no-answer-try-again"));
    await waitFor(() => expect(canvas.getByTestId("at-shell")).toBeVisible(), { timeout: 4000 });
    await expect(canvas.getByTestId("auth-probe-who")).toHaveTextContent("signed in as ani");
    await expect(checks().calls.length).toBe(6);
    await expect(visits.signIn).toBe(0);
  },
};

/**
 * #96 — WITH THE NO-ANSWER PANEL UP, the window regaining focus asks again by itself (still down: the panel stays), and so
 * does the connection coming back (`online`): the person is in without pressing anything.
 */
export const TheConnectionComingBackChecksAgain: Story = {
  name: "The Connection Coming Back Checks Again",
  parameters: { dataRouter: true },
  render: appRender,
  beforeEach: () => {
    server.up = false;
    const restoreWaits = shortWaits([30, 30, 30]);
    const spy = upOrUnavailable();
    return () => {
      spy.mockRestore();
      restoreWaits();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("auth-no-answer")).toBeVisible(), { timeout: 4000 });
    await checksEnded();
    // The panel is in the DOM a beat before its listeners are (a passive effect, after paint).
    await sleep(50);
    const spent = checks().calls.length;

    // Focus while the server is still down: one more check, and the panel stays — still not Sign in.
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(checks().calls.length).toBe(spent + 1));
    await checksEnded();
    await sleep(50);
    await expect(canvas.getByTestId("auth-no-answer")).toBeVisible();
    await expect(canvas.queryByTestId("at-sign-in")).toBeNull();

    // The connection comes back: it asks again by itself, and the person is in.
    server.up = true;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(canvas.getByTestId("at-shell")).toBeVisible(), { timeout: 4000 });
    await expect(checks().calls.length).toBe(spent + 2);
    await expect(visits.signIn).toBe(0);
    await expect(getToken()).toBe(TOKEN);
  },
};

/** #96 — NO VERDICT ON THE LOAD, THEN THE RETRY IS ANSWERED UNAUTHENTICATED: that is a verdict — Sign in, token dropped. */
export const AVerdictOnARetryStillSignsOut: Story = {
  name: "A Verdict on a Retry Still Signs Out",
  parameters: { dataRouter: true },
  render: appRender,
  beforeEach: () => {
    const restoreWaits = shortWaits([30, 30, 30]);
    const spy = checkAccessAnswers([aborted, aborted, expired]);
    return () => {
      spy.mockRestore();
      restoreWaits();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("at-sign-in")).toBeVisible(), { timeout: 4000 });
    await expect(checks().calls.length).toBe(3);
    await expect(getToken()).toBeNull();
    await expect(canvas.queryByTestId("auth-no-answer")).toBeNull();
    await expect(visits.shell).toBe(0);
  },
};

/** THE GATE, AS BEFORE: the load's check answered Unauthenticated → the Sign in route, the token dropped, no retry. */
export const AnExpiredTokenStillOpensSignIn: Story = {
  name: "An Expired Token Still Opens Sign In",
  parameters: { dataRouter: true },
  render: appRender,
  beforeEach: () => {
    const restoreWaits = shortWaits([30, 30, 30]);
    const spy = checkAccessAnswers([expired]);
    return () => {
      spy.mockRestore();
      restoreWaits();
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("at-sign-in")).toBeVisible(), { timeout: 4000 });
    await expect(getToken()).toBeNull();
    await checksEnded();
    await sleep(100);
    // StrictMode's pair, both answered — a verdict is never re-sent.
    await expect(checks().calls.length).toBe(2);
    await expect(visits.shell).toBe(0);
  },
};

/** The server down throughout: the panel as a person meets it, for review — its copy, Try Again, no Sign in. */
const panelStory = {
  parameters: { dataRouter: true },
  render: appRender,
  beforeEach: () => {
    server.up = false;
    const restoreWaits = shortWaits([30, 30, 30]);
    const spy = upOrUnavailable();
    return () => {
      spy.mockRestore();
      restoreWaits();
    };
  },
} satisfies Story;

/** Fits its card at a desktop width, and on a phone (below) — the login page's frame. */
async function thePanelReads(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const panel = await canvas.findByTestId("auth-no-answer", {}, { timeout: 4000 });

  await expect(panel).toBeVisible();
  await expect(canvas.getByTestId("auth-no-answer-try-again")).toBeVisible();
  await expect(canvas.getByTestId("auth-no-answer-try-again")).toHaveTextContent("Try Again");
  await expect(canvas.queryByRole("heading", { name: "Sign in" })).toBeNull();
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

export const TheNoAnswerPanel: Story = {
  ...panelStory,
  name: "The No-Answer Panel",
  play: async ({ canvasElement }) => thePanelReads(canvasElement),
};

export const TheNoAnswerPanelOnAPhone: Story = {
  ...panelStory,
  name: "The No-Answer Panel on a Phone",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => thePanelReads(canvasElement),
};
