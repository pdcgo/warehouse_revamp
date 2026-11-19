import { StrictMode } from "react";
import { Stack, Text } from "@chakra-ui/react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, waitFor, within } from "storybook/test";

import { authClient } from "../../api/clients";
import { CheckAccessResponseSchema } from "../../gen/warehouse/user/v1/user_pb";
import { AuthProvider, useAuth } from "./AuthContext";
import { getToken, setToken } from "./tokenStorage";

// THE PAGE LOAD'S CheckAccess — what a failed one does to the session (tokenVerdict.ts).
//
// Only the SERVER's verdict signs a person out: Unauthenticated (garbage, expired past renewal, the user gone, minted
// before a password reset) or PermissionDenied (suspended) drops the token. A request the browser ABORTED — the person
// left the page while it was in flight — or a dropped connection is not a verdict: the token stays, and whoever was
// signed in stays signed in. The e2e tester's trace was exactly that: under StrictMode a dev page load checks twice, the
// person navigated while the second was in flight, and the next page opened on Sign in.
//
//   | story                                 | the rule it pins                                                       |
//   | ------------------------------------- | ---------------------------------------------------------------------- |
//   | AnExpiredTokenSignsOut                | Unauthenticated → signed out, the token dropped                        |
//   | ASuspendedAccountSignsOut             | PermissionDenied → signed out, the token dropped                       |
//   | AnAbortedSecondCheckKeepsTheSession   | StrictMode's 2nd check aborted after the 1st answered → still signed in |
//   | ADroppedConnectionKeepsTheToken       | the network fails → nobody signed in by it, but the token kept         |
//
// The API is spied on at the client (`authClient.checkAccess`), not the stub transport: each story decides how its
// CheckAccess fails, and the spy is restored after it.

const TOKEN = "a-session-token";

const signedIn = () =>
  create(CheckAccessResponseSchema, { identity: { identityId: 7n, username: "ani", agent: "storybook" }, token: "" });

/** What the provider says — who is signed in, once the check settled. */
function Probe() {
  const { identity, ready } = useAuth();

  return (
    <Stack gap="1" data-testid="auth-probe">
      <Text data-testid="auth-probe-ready">{ready ? "ready" : "checking"}</Text>
      <Text data-testid="auth-probe-who">{identity ? `signed in as ${identity.username}` : "signed out"}</Text>
    </Stack>
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** CheckAccess answers with `answers[n]` on its n-th call (the last one repeats), each after `delayMs[n]`. */
function checkAccessAnswers(answers: (() => unknown)[], delayMs: number[] = []) {
  let call = 0;
  const spy = spyOn(authClient, "checkAccess").mockImplementation(async () => {
    const n = call++;
    await sleep(delayMs[n] ?? 0);
    const answer = (answers[n] ?? answers[answers.length - 1]!)();
    if (answer instanceof Error) throw answer;

    return answer as ReturnType<typeof signedIn>;
  });

  return spy;
}

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
    const spy = checkAccessAnswers([() => new ConnectError("token expired", Code.Unauthenticated)]);
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
    const spy = checkAccessAnswers(
      [signedIn, () => new ConnectError("The user aborted a request.", Code.Canceled)],
      // The abort lands AFTER the first answer — the order the trace showed.
      [0, 60],
    );
    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = await settled(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("auth-probe-who")).toHaveTextContent("signed in as ani"));

    // Both checks went out (StrictMode's mount, unmount, mount) — and the second has failed by now.
    const spy = authClient.checkAccess as unknown as { mock: { calls: unknown[]; results: { value: Promise<unknown> }[] } };
    await waitFor(() => expect(spy.mock.calls.length).toBe(2));
    await spy.mock.results[1]!.value.catch(() => undefined);
    await sleep(150);

    await expect(canvas.getByTestId("auth-probe-who")).toHaveTextContent("signed in as ani");
    await expect(getToken()).toBe(TOKEN);
  },
};

/**
 * THE NETWORK FAILS ON LOAD (a dropped connection, the API restarting): no verdict, so the token stays and the next load
 * asks again — and nobody is signed in by it either (the check never said who).
 */
export const ADroppedConnectionKeepsTheToken: Story = {
  name: "A Dropped Connection Keeps the Token",
  beforeEach: () => {
    const spy = checkAccessAnswers([
      () => new ConnectError("Failed to fetch", Code.Unknown, undefined, undefined, new TypeError("Failed to fetch")),
    ]);
    return () => spy.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = await settled(canvasElement);

    await expect(canvas.getByTestId("auth-probe-who")).toHaveTextContent("signed out");
    await sleep(100);
    await expect(getToken()).toBe(TOKEN);
  },
};
