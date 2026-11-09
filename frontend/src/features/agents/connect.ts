import { API_BASE_URL } from "../../api/apiBase";

// The pieces of connecting an agent that are not a query: the URL a person pastes into the agent, the answer a Deny
// sends back, and the one way the app leaves for the agent.

/**
 * THE URL A PERSON GIVES THE AGENT — ChatGPT's and Claude's *custom connector* (our-server-hosts-the-mcp). The MCP is
 * served by the API's own server, so it is the API's base with `/mcp` on the end.
 */
export function mcpUrl(): string {
  return `${API_BASE_URL.replace(/\/+$/, "")}/mcp`;
}

/**
 * WHERE A DENY SENDS THE BROWSER — the agent's registered redirect, carrying OAuth's `access_denied` and the agent's own
 * `state` (RFC 6749 §4.1.2.1), so the agent learns the person said no rather than waiting on a tab that never returns.
 *
 * ⚠ Only for a redirect `AgentClientDetail` has accepted as the agent's: anything else would make this page an open
 * redirect for whoever writes the link.
 */
export function denyUrl(redirectUri: string, state: string): string {
  const joiner = redirectUri.includes("?") ? "&" : "?";

  return `${redirectUri}${joiner}error=access_denied&state=${encodeURIComponent(state)}`;
}

/**
 * LEAVING THE APP for the agent — a full navigation to an address that is not one of our routes.
 *
 * ⚠ AN OBJECT, so a story can replace `to`: `window.location` is unforgeable — no script can stub its `assign` — and a
 * story that really navigated would take the test runner's frame with it. The screen calls `leaveApp`; nothing else
 * about it is shaped for Storybook.
 */
export const appExit = {
  to: (url: string) => {
    window.location.assign(url);
  },
};

export function leaveApp(url: string) {
  appExit.to(url);
}
