import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { BatchExplainer, description } from "./BatchExplainer";

// WHAT A BATCH IS (a-batch-says-what-it-is) — the answer the Batch list and a batch's page carry, in a tooltip.

const meta = {
  title: "Features/Inventory/BatchExplainer",
  component: BatchExplainer,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof BatchExplainer>;

export default meta;
type Story = StoryObj<typeof meta>;

// HOVER — the tooltip opens with the answer and its example; the pointer leaves, it shuts.
export const OnHover: Story = {
  name: "On hover",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: /What is a batch/ });

    await expect(screen.queryByTestId("batch-explainer-panel")).toBeNull();
    await userEvent.hover(trigger);
    const panel = await screen.findByTestId("batch-explainer-panel");
    await waitFor(() => expect(panel).toBeVisible());
    await expect(panel).toHaveTextContent("one product, one owner, one unit cost");
    await expect(within(panel).getAllByRole("listitem")).toHaveLength(4);
    await expect(within(panel).getByTestId("batch-explainer-example")).toHaveTextContent("two batches");
    // LIGHT, NOT BLACK (owner: "jangan hitam") — the panel's ground, not the default tooltip's near-black.
    const [r, g, b] = getComputedStyle(panel).backgroundColor.match(/\d+/g)!.map(Number);
    await expect(r! + g! + b!).toBeGreaterThan(600);

    await userEvent.unhover(trigger);
    await waitFor(() => expect(screen.queryByTestId("batch-explainer-panel")).toBeNull());
  },
};

// A TAP — a phone has no hover: a click opens it, a second click shuts it.
export const OnATap: Story = {
  name: "On a tap",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: /What is a batch/ });

    await userEvent.click(trigger);
    await waitFor(() => expect(screen.getByTestId("batch-explainer-panel")).toBeVisible());
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(trigger);
    await waitFor(() => expect(screen.queryByTestId("batch-explainer-panel")).toBeNull());
  },
};
