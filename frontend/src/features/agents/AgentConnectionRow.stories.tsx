import { create } from "@bufbuild/protobuf";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { AgentConnectionSchema } from "../../gen/warehouse/user/v1/agent_pb";
import { AgentConnectionRow, description } from "./AgentConnectionRow";

// One AI agent's connection — the row /profile's AI Agents and Settings' AI Agents both draw.

const at = (iso: string) => BigInt(Math.floor(new Date(iso).getTime() / 1000));

const usedInit = {
  id: 701n,
  userId: 61n,
  teamId: 12n,
  name: "ChatGPT, Ani's laptop",
  clientName: "ChatGPT",
  createdAtUnix: at("2026-10-23T06:05:00Z"),
  expiresAtUnix: at("2027-01-21T06:05:00Z"),
  lastUsedAtUnix: at("2026-11-02T03:10:00Z"),
};
const used = create(AgentConnectionSchema, usedInit);

const meta = {
  title: "Features/Agents/AgentConnectionRow",
  component: AgentConnectionRow,
  parameters: { docs: { description: { component: description } } },
  args: { connection: used, context: "Toko Melati", revoke: fn(async () => {}) },
} satisfies Meta<typeof AgentConnectionRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Used: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("agent-connection-name-701")).toHaveTextContent("ChatGPT, Ani's laptop");
    await expect(canvas.getByText("ChatGPT")).toBeVisible();
    await expect(canvas.getByTestId("agent-connection-context-701")).toHaveTextContent("Toko Melati");
    // Every time in WIB, the table's short form: the year only when it is not this one.
    await expect(canvas.getByTestId("agent-connection-dates-701")).toHaveTextContent(
      /Connected 23 Oct(?: 2026)? 13:05 · Expires 21 Jan(?: 2027)? 13:05 · Last used 2 Nov(?: 2026)? 10:10/,
    );
  },
};

// An agent that has not read anything yet says "never" — not a dash that reads as missing data.
export const NeverUsed: Story = {
  args: {
    connection: create(AgentConnectionSchema, { ...usedInit, id: 702n, teamId: 0n, name: "Claude", clientName: "Claude", lastUsedAtUnix: 0n }),
    context: "Every team",
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("agent-connection-dates-702")).toHaveTextContent(/Last used never$/);
  },
};

// A long name gives up the room, never the agent's badge or the Revoke — on a phone, Revoke is its icon.
export const ALongNameOnAPhone: Story = {
  args: {
    connection: create(AgentConnectionSchema, {
      ...usedInit,
      name: "ChatGPT on the shared laptop at the packing table beside the scanner, second floor, Gudang Pusat",
    }),
  },
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const revoke = within(canvasElement).getByTestId("agent-revoke-701");

    await expect(revoke).toBeVisible();
    await expect(revoke).toHaveAccessibleName("Revoke");
    await expect(revoke).not.toHaveTextContent("Revoke");
  },
};

// Revoke asks first; only the dialog's Revoke revokes.
export const RevokeAsksFirst: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("agent-revoke-701"));
    const dialog = await screen.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("ChatGPT stops reading your data at once.");
    await expect(args.revoke).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(args.revoke).toHaveBeenCalledTimes(1));
    await expect(await screen.findByText("ChatGPT, Ani's laptop revoked")).toBeInTheDocument();
  },
};
