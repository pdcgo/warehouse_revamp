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
// next page load asks again.
export function serverRefusedTheToken(err: unknown): boolean {
  if (!(err instanceof ConnectError)) return false;

  return err.code === Code.Unauthenticated || err.code === Code.PermissionDenied;
}
