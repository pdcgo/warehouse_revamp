import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { describe, expect, it } from "vitest";

import { AuthService } from "../../gen/warehouse/user/v1/user_pb";
import { checkRetry, nextCheckDelay, serverRefusedTheToken } from "./tokenVerdict";

// WHICH FAILED CheckAccess DROPS THE TOKEN — read off the REAL browser transport over a `fetch` the test decides, so if
// Connect-ES ever changes how it surfaces an abort or a dropped connection, this fails instead of signing people out.
//
// `npm run test:unit` (vitest.unit.config.ts — plain Node, no browser). The provider's behaviour around it (signed out vs
// still signed in) is AuthContext.stories.tsx.

const BASE = "http://api.test";

/** CheckAccess over the real browser transport, failing as `fetch` says; resolves to what it threw. */
async function checkAccessThrows(fetch: typeof globalThis.fetch): Promise<unknown> {
  const client = createClient(AuthService, createConnectTransport({ baseUrl: BASE, fetch }));

  try {
    await client.checkAccess({ token: "a-token" });
  } catch (err) {
    return err;
  }

  throw new Error("CheckAccess did not fail");
}

function connectError(status: number, code: string, message: string): typeof globalThis.fetch {
  return async () =>
    new Response(JSON.stringify({ code, message }), {
      status,
      headers: { "content-type": "application/json" },
    });
}

describe("serverRefusedTheToken — the server's verdict drops the token", () => {
  it("unauthenticated (garbage, expired past renewal, user gone, predates a reset) drops it", async () => {
    const err = await checkAccessThrows(connectError(401, "unauthenticated", "token expired"));

    expect((err as ConnectError).code).toBe(Code.Unauthenticated);
    expect(serverRefusedTheToken(err)).toBe(true);
  });

  it("permission denied (the account is suspended) drops it", async () => {
    const err = await checkAccessThrows(connectError(403, "permission_denied", "account is suspended"));

    expect((err as ConnectError).code).toBe(Code.PermissionDenied);
    expect(serverRefusedTheToken(err)).toBe(true);
  });
});

describe("serverRefusedTheToken — anything else keeps it", () => {
  it("a request the browser aborted (the person left the page mid-check) keeps it", async () => {
    const err = await checkAccessThrows(() =>
      Promise.reject(new DOMException("The user aborted a request.", "AbortError")),
    );

    expect((err as ConnectError).code).toBe(Code.Canceled);
    expect(serverRefusedTheToken(err)).toBe(false);
  });

  it("a dropped connection (net::ERR_ABORTED / Failed to fetch) keeps it", async () => {
    const err = await checkAccessThrows(() => Promise.reject(new TypeError("Failed to fetch")));

    expect((err as ConnectError).code).toBe(Code.Unknown);
    expect(serverRefusedTheToken(err)).toBe(false);
  });

  it("the server failing (Internal, Unavailable) keeps it", async () => {
    expect(serverRefusedTheToken(await checkAccessThrows(connectError(500, "internal", "db down")))).toBe(false);
    expect(serverRefusedTheToken(await checkAccessThrows(connectError(503, "unavailable", "restarting")))).toBe(false);
  });

  it("a gateway's bare 502 with no Connect body keeps it", async () => {
    expect(serverRefusedTheToken(await checkAccessThrows(async () => new Response("", { status: 502 })))).toBe(false);
  });

  it("an error that is not Connect's keeps it", () => {
    expect(serverRefusedTheToken(new Error("boom"))).toBe(false);
    expect(serverRefusedTheToken(undefined)).toBe(false);
  });
});

// #96 — A CHECK WITH NO VERDICT IS SENT AGAIN, a bounded number of times, before the gate says the server gave no answer.
// The provider's side (no Sign in while it waits, the panel after) is AuthContext.stories.tsx.
describe("nextCheckDelay — a check with no verdict is sent again, three times over about ten seconds", () => {
  it("waits 1 s, then 3 s, then 6 s", () => {
    expect([0, 1, 2].map((failures) => nextCheckDelay(failures))).toEqual([1000, 3000, 6000]);
  });

  it("stops after the third: the gate shows its no-answer panel", () => {
    expect(nextCheckDelay(3)).toBeNull();
    expect(nextCheckDelay(10)).toBeNull();
  });

  it("is bounded — three tries, about ten seconds in all", () => {
    expect(checkRetry.delaysMs).toHaveLength(3);
    const total = checkRetry.delaysMs.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeGreaterThanOrEqual(8000);
    expect(total).toBeLessThanOrEqual(12000);
  });

  it("reads the waits it is given (a story shortens them)", () => {
    expect(nextCheckDelay(0, [40, 40])).toBe(40);
    expect(nextCheckDelay(2, [40, 40])).toBeNull();
    expect(nextCheckDelay(-1)).toBeNull();
  });

  it("every check of a load aborted: three re-sends, then the panel — never a verdict", async () => {
    // The load's checks, one after another, all aborted by the browser (the e2e's route.abort): each is no verdict.
    const steps: (number | null)[] = [];
    for (let failures = 0; failures < 5; failures++) {
      const err = await checkAccessThrows(() =>
        Promise.reject(new DOMException("The user aborted a request.", "AbortError")),
      );
      expect(serverRefusedTheToken(err)).toBe(false);
      const wait = nextCheckDelay(failures);
      steps.push(wait);
      if (wait === null) break;
    }

    expect(steps).toEqual([1000, 3000, 6000, null]);
  });
});
