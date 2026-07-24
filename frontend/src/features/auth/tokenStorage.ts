// Where the bearer token lives.
//
// "Remember me" -> localStorage (survives a browser restart).
// Otherwise     -> sessionStorage (dies with the tab).
//
// ⚠ Both are readable by any JavaScript on the page, so an XSS is a full session takeover. That
// is the accepted trade-off (owner's call, plans/user_service §6.4): it buys a 6-line transport
// interceptor and no CSRF surface at all, since nothing is sent automatically by the browser.
// The mitigation lives on the server: CheckAccess refuses to renew a token expired beyond a
// bounded window, so a stolen token is not immortal.
const TOKEN_KEY = "warehouse_revamp.token";

export function setToken(token: string, remember: boolean): void {
  clearToken();

  const store = remember ? window.localStorage : window.sessionStorage;
  store.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  // Session first: if both somehow exist, the tab-scoped one is the more recent intent.
  return (
    window.sessionStorage.getItem(TOKEN_KEY) ?? window.localStorage.getItem(TOKEN_KEY)
  );
}

// isRemembered reports which store the current token came from, so a renewed token is written
// back to the SAME one — otherwise a "remember me" session would silently downgrade to a
// tab-scoped one on the first CheckAccess.
export function isRemembered(): boolean {
  return window.sessionStorage.getItem(TOKEN_KEY) === null && window.localStorage.getItem(TOKEN_KEY) !== null;
}

export function clearToken(): void {
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(TOKEN_KEY);
}
