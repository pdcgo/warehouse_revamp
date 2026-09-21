import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { Tooltip, description } from "./Tooltip";

const meta = {
  title: "Legacy/Components/Feedback/Tooltip",
  component: Tooltip,
  parameters: { docs: { description: { component: description } } },
  args: {
    content: "The full value",
    children: <Button data-testid="trigger">Hover me</Button>,
  },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.hover(canvas.getByTestId("trigger"));

    // It portals, so the content is NOT inside canvasElement — that is the behaviour under test.
    await waitFor(async () => {
      await expect(screen.getByTestId("tooltip-content")).toBeVisible();
    });
  },
};

// RULE 1: empty content means no tooltip machinery at all. Callers here decide at render time
// whether a tip is warranted (PriceText only when it compacted, ClippedText only when it clipped),
// and an empty bubble popping open on hover reads as a broken component.
export const NoContentRendersNothing: Story = {
  args: { content: "" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.hover(canvas.getByTestId("trigger"));

    // Nothing to wait for — assert it stays absent rather than that it hasn't appeared yet.
    await new Promise((r) => setTimeout(r, 350));
    await expect(screen.queryByTestId("tooltip-content")).toBeNull();
  },
};

export const WithArrow: Story = { args: { showArrow: true } };

export const Bottom: Story = { args: { placement: "bottom" } };
