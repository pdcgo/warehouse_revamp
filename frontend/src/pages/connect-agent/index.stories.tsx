import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { agentClients, agentScenario } from "../../../.storybook/agentStub";
import { marker, routedPage } from "../../../.storybook/pageStory";
import { sessionScenario } from "../../../.storybook/sessionScenario";
import { appExit } from "../../features/agents/connect";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { ConnectAgentPage } from "./index";

// THE CONNECT PAGE — where ChatGPT's or Claude's OAuth login lands (our-server-hosts-the-mcp): the person names the
// connection, picks the ONE team it reads (every team for Root — a-roots-agent-reads-every-team), and Allow mints the
// agent its own read-only, 90-day credential (an-agent-gets-its-own-team-credential).
//
// The stub (agentStub.ts) knows ChatGPT and Claude with one registered redirect each. Toko Kenanga's (13) owner lets CS
// and staff connect; Toko Melati's (12) does not. Leaving for the agent is RECORDED, not followed — `appExit.to` is
// replaced for every story here, so a story can assert where the browser was sent without its frame going there.

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const STATE = "st-123";
const chatgpt = agentClients.chatgpt;

function linkFor(overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({
    client_id: chatgpt.id,
    redirect_uri: chatgpt.redirectUri,
    state: STATE,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    ...overrides,
  });

  return `?${params.toString()}`;
}

const routesAt = (search: string) =>
  routedPage(
    [{ path: "/connect-agent", element: <ConnectAgentPage /> }, marker("/", "at-home")],
    { pathname: "/connect-agent", search },
  );

const Valid = routesAt(linkFor());
const UnknownClient = routesAt(linkFor({ client_id: "someone-else" }));
const ForeignRedirect = routesAt(linkFor({ redirect_uri: "https://evil.example/callback" }));
const NoChallenge = routesAt(linkFor({ code_challenge: "" }));

/** Where the page sent the browser — `appExit.to`, recorded. */
const exits: string[] = [];

/** A `beforeEach`: the signed-in person holds `role` in `memberOf` (plus the root team, for Root or the Administrator). */
function standingAs(role: Role, memberOf: bigint[]) {
  return () => {
    sessionScenario.role = role;
    sessionScenario.memberOf = memberOf;
  };
}

const meta = {
  title: "Pages/Agents/ConnectAgent",
  component: Valid,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    exits.length = 0;
    const real = appExit.to;
    appExit.to = (url) => {
      exits.push(url);
    };
    standingAs(Role.SELLING_OWNER, [12n, 13n])();

    return () => {
      appExit.to = real;
    };
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("agent-connect-title", {}, { timeout: 4000 });
  return canvas;
}

async function pickTeam(canvas: ReturnType<typeof within>, teamId: string) {
  await userEvent.click(canvas.getByRole("combobox"));
  const option = await screen.findByTestId(`agent-team-option-${teamId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

// An owner of two selling teams: the agent is named, what Allow means is said, and no team is assumed.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("agent-connect-title")).toHaveTextContent("Connect ChatGPT");
    await expect(canvas.getByTestId("agent-connect-lead")).toHaveTextContent("ChatGPT wants to read your data.");
    // Read-only, the buyer's details, 90 days, revocable from Profile — all four said before anything is allowed.
    const facts = canvas.getByTestId("agent-connect-facts");
    await expect(facts).toHaveTextContent("It can only read");
    await expect(facts).toHaveTextContent("the buyer's name, phone and address included");
    await expect(facts).toHaveTextContent("90 days");
    await expect(facts).toHaveTextContent("from your Profile");
    // The name starts as the agent's own.
    await expect(canvas.getByTestId("agent-connect-name")).toHaveValue("ChatGPT");
    // Two teams to choose from, none chosen: Allow waits for a pick.
    await expect(canvas.getByTestId("agent-allow")).toBeDisabled();
    await expect(canvas.getByTestId("agent-connect-signed-in")).toHaveTextContent("ani");
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // Stacked full width on a phone — Allow above Deny, where the thumb is.
    const allow = canvas.getByTestId("agent-allow").getBoundingClientRect();
    const deny = canvas.getByTestId("agent-deny").getBoundingClientRect();
    await expect(allow.bottom).toBeLessThanOrEqual(deny.top);
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Allow connects the picked team under the typed name, with the agent's PKCE challenge, and sends the browser back to
// the agent's registered redirect carrying the code and the agent's own state.
export const AllowSendsTheAgentBack: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // An owner is not Root: there is no "Every team" to pick.
    await userEvent.click(canvas.getByRole("combobox"));
    await screen.findByTestId("agent-team-option-12");
    await expect(screen.queryByTestId("agent-team-option-0")).toBeNull();
    await userEvent.click(screen.getByTestId("agent-team-option-12"));

    const name = canvas.getByTestId("agent-connect-name");
    await userEvent.clear(name);
    await userEvent.type(name, "ChatGPT, Ani's laptop", { delay: 20 });

    await waitFor(() => expect(canvas.getByTestId("agent-allow")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("agent-allow"));

    await waitFor(() => expect(exits).toHaveLength(1));
    await expect(exits[0]).toMatch(new RegExp(`^${chatgpt.redirectUri}\\?code=stub-code-\\d+&state=${STATE}$`));
    await expect(agentScenario.lastConnect).toMatchObject({
      clientId: chatgpt.id,
      redirectUri: chatgpt.redirectUri,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: "S256",
      state: STATE,
      teamId: 12n,
      name: "ChatGPT, Ani's laptop",
    });
  },
};

// Deny tells the agent the person said no — OAuth's access_denied, with the agent's state — and connects nothing.
export const DenySendsAccessDenied: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("agent-deny"));

    await waitFor(() => expect(exits).toHaveLength(1));
    await expect(exits[0]).toBe(`${chatgpt.redirectUri}?error=access_denied&state=${STATE}`);
    await expect(agentScenario.lastConnect).toBeUndefined();
  },
};

// A link the server does not recognise is said to be invalid, and the page offers NOTHING that sends the browser
// anywhere — no Allow, no Deny — only the way back into the app.
export const AnInvalidLinkSaysSo: Story = {
  render: () => <UnknownClient />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("agent-link-invalid", {}, { timeout: 4000 })).toHaveTextContent(
      "This connection link is not valid",
    );
    await expect(canvas.queryByTestId("agent-allow")).toBeNull();
    await expect(canvas.queryByTestId("agent-deny")).toBeNull();

    await userEvent.click(canvas.getByRole("link", { name: "Go to the App" }));
    await canvas.findByTestId("at-home");
    await expect(exits).toHaveLength(0);
  },
};

// A known agent with a redirect it never registered is just as invalid — a Deny there would be an open redirect.
export const AForeignRedirectIsInvalid: Story = {
  render: () => <ForeignRedirect />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("agent-link-invalid", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("agent-deny")).toBeNull();
    await expect(exits).toHaveLength(0);
  },
};

// Without its PKCE challenge the link could never end in a connection, so it is invalid before anything is asked.
export const ALinkWithoutAChallengeIsInvalid: Story = {
  render: () => <NoChallenge />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("agent-link-invalid", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("agent-allow")).toBeNull();
  },
};

// Root keeps root's reach: "Every team" is on offer, and picking it connects team 0 (a-roots-agent-reads-every-team).
export const RootSeesEveryTeam: Story = {
  beforeEach: standingAs(Role.ROOT, [12n]),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickTeam(canvas, "0");
    await expect(await canvas.findByText(/It reads every team in the business/)).toBeVisible();

    await userEvent.click(canvas.getByTestId("agent-allow"));
    await waitFor(() => expect(exits).toHaveLength(1));
    await expect(agentScenario.lastConnect?.teamId).toBe(0n);
  },
};

// A CS in a team whose owner has not turned it on is told why, and cannot Allow
// (the-owner-decides-who-connects-an-agent). Their one team is picked for them — there is nothing else to choose.
export const ACsWaitsForTheOwner: Story = {
  beforeEach: standingAs(Role.SELLING_CS, [12n]),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("agent-connect-not-allowed")).toHaveTextContent(
      "Ask the owner of Toko Melati to turn it on",
    );
    await expect(canvas.getByTestId("agent-allow")).toBeDisabled();
    // Deny still answers the agent.
    await expect(canvas.getByTestId("agent-deny")).toBeEnabled();
  },
};

// …and where the owner has turned it on, the same CS connects.
export const ACsConnectsWhereTheOwnerAllowed: Story = {
  beforeEach: standingAs(Role.SELLING_CS, [13n]),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("agent-allow")).toBeEnabled());
    await expect(canvas.queryByTestId("agent-connect-not-allowed")).toBeNull();

    await userEvent.click(canvas.getByTestId("agent-allow"));
    await waitFor(() => expect(exits).toHaveLength(1));
    await expect(agentScenario.lastConnect?.teamId).toBe(13n);
  },
};
