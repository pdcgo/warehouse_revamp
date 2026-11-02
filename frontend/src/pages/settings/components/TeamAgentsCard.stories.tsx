import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { agentConnectionExists, membersMayConnect } from "../../../../.storybook/agentStub";
import { TeamAgentsCard } from "./TeamAgentsCard";

// THE TEAM'S AI AGENTS on Settings, for its owner (the-owner-decides-who-connects-an-agent). In the stub Toko Melati (12)
// is read by Ani's ChatGPT (701) and Dewi's phone (703), and its owner has NOT let CS and staff connect; Toko Kenanga (13)
// has; Gudang Cabang (14) is read by nobody. Ani's every-team Claude (702) is on no team's list.

const meta = {
  title: "Pages/Settings/TeamAgentsCard",
  component: TeamAgentsCard,
  args: { teamId: 12n },
} satisfies Meta<typeof TeamAgentsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("agent-connection-703", {}, { timeout: 4000 });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // Off until the owner turns it on.
    await waitFor(() => expect(canvas.getByTestId("settings-agents-members")).toHaveAttribute("data-state", "unchecked"));
    // Every connection reading the team, whoever made it — named.
    await expect(canvas.getByTestId("agent-connection-701")).toBeInTheDocument();
    await waitFor(() =>
      expect(canvas.getByTestId("agent-connection-context-703")).toHaveTextContent("Connected by Dewi Lestari"),
    );
    // Root's every-team connection reads every team, and no team's owner revokes it.
    await expect(canvas.queryByTestId("agent-connection-702")).toBeNull();
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("agent-revoke-703")).toBeVisible();
  },
};

export const MembersAllowed: Story = {
  args: { teamId: 13n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("settings-agents-members")).toHaveAttribute("data-state", "checked"));
  },
};

export const NothingReadsThisTeam: Story = {
  args: { teamId: 14n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("settings-agents-empty", {}, { timeout: 4000 })).toHaveTextContent(
      "No agent reads this team",
    );
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// The switch is the owner's consent for CS and staff — flipped, it is saved and said.
export const TheSwitchFlips: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const members = canvas.getByTestId("settings-agents-members");

    await waitFor(() => expect(members).toHaveAttribute("data-state", "unchecked"));
    await userEvent.click(members);

    await expect(await screen.findByText("CS and staff may now connect agents")).toBeInTheDocument();
    await waitFor(() => expect(membersMayConnect(12n)).toBe(true));
    await waitFor(() => expect(canvas.getByTestId("settings-agents-members")).toHaveAttribute("data-state", "checked"));
  },
};

// The owner revokes a MEMBER's connection — after confirming.
export const TheOwnerRevokesAMembersConnection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("agent-revoke-703"));
    const dialog = await screen.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Revoke ChatGPT, Dewi's phone?");
    await userEvent.click(within(dialog).getByTestId("confirm-action"));

    await expect(await screen.findByText("ChatGPT, Dewi's phone revoked")).toBeInTheDocument();
    await waitFor(() => expect(canvas.queryByTestId("agent-connection-703")).toBeNull());
    await expect(agentConnectionExists(703n)).toBe(false);
    await expect(canvas.getByTestId("agent-connection-701")).toBeInTheDocument();
  },
};
