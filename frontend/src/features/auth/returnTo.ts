// WHERE SIGNING IN GOES BACK TO.
//
// ProtectedRoute sends a signed-out visitor to /login carrying `state.from` — the path AND the query they asked for, so
// the connect page an agent's OAuth opened comes back with its client_id, redirect_uri, state and PKCE challenge intact.
// Without the query, signing in would land on a connect page that no longer knows which agent asked.

/** The navigation state ProtectedRoute hands the login page. */
export interface ReturnState {
  from: string;
}

/** `state.from` for a location — the path and its query, never the host. */
export function returnState(location: { pathname: string; search: string }): ReturnState {
  return { from: `${location.pathname}${location.search}` };
}

/**
 * Where the login page goes once someone is signed in: `state.from` when it is a path of THIS app, else "/".
 *
 * ⚠ SAME-APP ONLY. A path starts with one "/" — never "//host" or "/\host", which a browser reads as another origin. The
 * state is only ever written by ProtectedRoute, but a value that decides where the browser goes is checked where it is
 * used, not trusted for where it came from.
 */
export function returnPath(state: unknown): string {
  const from = (state as { from?: unknown } | null | undefined)?.from;

  if (typeof from !== "string") return "/";
  if (!from.startsWith("/") || from.startsWith("//") || from.startsWith("/\\")) return "/";

  return from;
}
