import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { agentConnectionExists, withNoAgentConnections } from "../../../../.storybook/agentStub";
import { AgentConnectionsCard } from "./AgentConnectionsCard";

// MY AI AGENTS on /profile (an-agent-gets-its-own-team-credential). The stub signs in as Ani, who reads Toko Melati from
// ChatGPT (701, used two hours ago) and every team from Claude (702, never used) — and Dewi's and Eko's connections are
// theirs, so they are not on this list.

const meta = {
  title: "Pages/Profile/AgentConnectionsCard",
  component: AgentConnectionsCard,
} satisfies Meta<typeof AgentConnectionsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("agent-connection-701", {}, { timeout: 4000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("agent-connection-name-701")).toHaveTextContent("ChatGPT, Ani's laptop");
    // The team each reads, named — and Root's reach as "Every team".
    await waitFor(() => expect(canvas.getByTestId("agent-connection-context-701")).toHaveTextContent("Toko Melati"));
    await expect(canvas.getByTestId("agent-connection-context-702")).toHaveTextContent("Every team");
    // Connected, expires, last used — "never" for one that has not read anything yet.
    await expect(canvas.getByTestId("agent-connection-dates-702")).toHaveTextContent(/Connected .+ · Expires .+ · Last used never/);
    // Only MY connections.
    await expect(canvas.queryByTestId("agent-connection-703")).toBeNull();
    // How to connect one: the URL to paste, the API's base with /mcp.
    await expect(canvas.getByTestId("profile-agents-connect")).toHaveTextContent("add a custom connector with this URL");
    await expect(canvas.getByTestId("profile-agents-mcp-url")).toHaveTextContent(/\/mcp$/);
    await expect(canvas.getByTestId("profile-agents-pager")).toBeInTheDocument();
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("agent-revoke-701")).toBeVisible();
  },
};

// Nobody connected yet: the list says so, and the URL to connect one is still there.
export const NoAgentYet: Story = {
  beforeEach: withNoAgentConnections,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("profile-agents-empty", {}, { timeout: 4000 })).toHaveTextContent(
      "No agent connected",
    );
    await expect(canvas.getByTestId("profile-agents-mcp-url")).toBeVisible();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Revoking is destructive, so it asks; Cancel keeps it, Revoke removes it and says so.
export const RevokeAsksFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("agent-revoke-701"));
    let dialog = await screen.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Revoke ChatGPT, Ani's laptop?");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await expect(agentConnectionExists(701n)).toBe(true);

    await userEvent.click(canvas.getByTestId("agent-revoke-701"));
    dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByTestId("confirm-action"));

    await expect(await screen.findByText("ChatGPT, Ani's laptop revoked")).toBeInTheDocument();
    await waitFor(() => expect(canvas.queryByTestId("agent-connection-701")).toBeNull());
    await expect(agentConnectionExists(701n)).toBe(false);
    // The other one is untouched — revoking one agent signs the person out of nothing else.
    await expect(canvas.getByTestId("agent-connection-702")).toBeInTheDocument();
  },
};

// The URL is carried into ChatGPT or Claude, so it copies — whole.
export const CopiesTheConnectorUrl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("profile-agents-mcp-url"));
    await waitFor(() =>
      expect((window as unknown as { __copiedText?: string }).__copiedText).toMatch(/^https?:\/\/.+\/mcp$/),
    );
  },
};
