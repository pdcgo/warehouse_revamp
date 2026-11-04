import { Code, ConnectError } from "@connectrpc/connect";

// WHAT CAME BACK FROM CREATE (the-form-locks-until-it-is-answered, no-answer-is-only-a-lost-connection).
//
// After Create the order form waits, locked, for one of three answers:
//
// | the answer | the form                                                                              |
// | ---------- | ------------------------------------------------------------------------------------- |
// | `order`    | opens the order                                                                       |
// | `error`    | anything the SERVER sent — Internal and Unavailable included: unlocks, keeps the form |
// | `none`     | nothing came back: stays locked on what was sent and offers *Try Again*               |
//
// ⚠ THERE IS NO TIME LIMIT (no-answer-is-only-a-lost-connection). A slow server keeps the form locked for as long as
// the request is open; only a request that FAILS WITHOUT A REPLY FROM THE SERVER is *no answer*. Nothing here times out.
//
// HOW CONNECT-ES (v2, connect-web) SURFACES A LOST CONNECTION — read off its source, and pinned by createAnswer.test.ts
// against the real transports:
//
// - `fetch` itself rejects (offline, DNS, the socket reset mid-request, CORS): the Fetch spec rejects with a TypeError
//   ("Failed to fetch" in Chromium, "NetworkError when attempting to fetch resource." in Firefox, "Load failed" in
//   Safari). runUnaryCall wraps it with `ConnectError.from(reason)` — code UNKNOWN, `cause` = that TypeError, and EMPTY
//   metadata, because there were no response headers to copy.
// - the request was aborted before any reply: `ConnectError.from` turns the AbortError into CANCELED, no cause, empty
//   metadata. The form never aborts (no time limit), so this is the browser giving up — still no answer.
// - a GATEWAY answered for a server that did not (502/503/504 with an HTML or empty body — a load balancer or proxy in
//   front): validateResponse throws `HTTP 50x` with the status's code (UNAVAILABLE) and no Connect body. The request may
//   still be running behind it, so it is *no answer* too. ⚠ Our own server never answers that way: connect-go writes
//   every error as a Connect JSON body with its own message.
//
// Everything else is an answer: a Connect error body parsed off a real response (its code from the server, the response
// headers as metadata) — whatever the code, Internal and Unavailable included. An error that is not about the network
// at all (a bug on our side, a plain Error) is shown like an error too: the form unlocks, which is the safe default for
// something that never left the browser.

export type CreateAnswer<T> =
  | { kind: "order"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "none"; error: unknown };

/** A gateway's bare status line — what validateResponse throws when a non-200 reply carries no Connect body. */
const GATEWAY_STATUS = /^HTTP (502|503|504)$/;

function hasMetadata(err: ConnectError): boolean {
  let any = false;
  err.metadata.forEach(() => {
    any = true;
  });
  return any;
}

/** Whether a failed Create got NO answer — the request failed without any reply from the server. */
export function isNoAnswer(err: unknown): boolean {
  // A raw fetch rejection that reached us unwrapped (a custom transport, a test) — the same network failure.
  if (err instanceof TypeError) return true;
  if (!(err instanceof ConnectError)) return false;

  // fetch rejected: no response at all.
  if (err.cause instanceof TypeError) return true;

  // aborted before any reply: no response headers were ever read.
  if (err.code === Code.Canceled && !hasMetadata(err)) return true;

  // a gateway's bare 502/503/504 — not our server's answer, and the request may still be running behind it.
  if (err.code === Code.Unavailable && GATEWAY_STATUS.test(err.rawMessage)) return true;

  return false;
}

/** The answer to one Create: the order, the server's error, or none. Never throws. */
export async function awaitAnswer<T>(send: () => Promise<T>): Promise<CreateAnswer<T>> {
  try {
    return { kind: "order", value: await send() };
  } catch (error) {
    return isNoAnswer(error) ? { kind: "none", error } : { kind: "error", error };
  }
}
