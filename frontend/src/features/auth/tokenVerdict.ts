import { Code, ConnectError } from "@connectrpc/connect";

// WHETHER A FAILED CheckAccess DROPS THE TOKEN — only when the SERVER said the token is no good.
//
// The token in storage is the person's session. CheckAccess (user_v1/check_access.go) refuses it with exactly two codes:
//
//   Unauthenticated     garbage (it does not parse), expired past the renewal window, the user no longer exists, or it
//                       was minted before a password reset
//   PermissionDenied    the account is suspended
//
// Anything else is NOT a verdict on the token: the request aborted because the person navigated while it was in flight
// (net::ERR_ABORTED — the browser cancels a page's fetches when it leaves), the network dropped, the server was down or
// answered Internal. Dropping the token then signed a person out for leaving a page too quickly; it is kept, and the
// check is sent again (checkRetry, below).
export function serverRefusedTheToken(err: unknown): boolean {
  if (!(err instanceof ConnectError)) return false;

  return err.code === Code.Unauthenticated || err.code === Code.PermissionDenied;
}

// WHAT A PAGE LOAD DOES WHILE ITS CHECK HAS NO VERDICT (#96) — it asks again; it never sends the person to Sign in.
//
// With a token in storage and no answer yet, nobody is known to be signed OUT: only the server's verdict above says so.
// Sign in shown then is a lie (the next load opens signed in), so the shell keeps its loading spinner and the check is
// re-sent after each of these waits — three more tries over about ten seconds. Past the last, the gate says the server
// gave no answer and offers Try Again; the connection coming back (`online`) or the window regaining focus asks once
// more by itself (AuthContext.tsx). A verdict on any try still signs out at once.
//
// An object, not a bare array, so a story can shorten the waits for the length of one story and put them back.
export const checkRetry: { delaysMs: readonly number[] } = { delaysMs: [1000, 3000, 6000] };

/**
 * How long to wait before re-sending a check that got no verdict, given how many tries already failed that way
 * (`failures`, from 0) — or `null` when the waits are spent and the gate shows its no-answer panel.
 */
export function nextCheckDelay(failures: number, delaysMs: readonly number[] = checkRetry.delaysMs): number | null {
  return failures >= 0 && failures < delaysMs.length ? delaysMs[failures]! : null;
}
