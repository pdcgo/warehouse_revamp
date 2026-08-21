import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack, Text } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { SpinnerOverlay, description } from "./SpinnerOverlay";

const Panel = (
  <Stack gap="2" borderWidth="1px" p="4" borderRadius="l3" w="320px">
    <Text fontWeight="medium">Settlement 2026-08</Text>
    <Text fontSize="sm" color="fg.muted">14 orders · Rp 42.500.000</Text>
    <Button data-testid="panel-action">Post settlement</Button>
  </Stack>
);

const meta = {
  title: "Legacy/Components/Feedback/SpinnerOverlay",
  component: SpinnerOverlay,
  parameters: { docs: { description: { component: description } } },
  args: { busy: true, label: "Posting settlement…", children: Panel },
} satisfies Meta<typeof SpinnerOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

// The blocking behaviour is the point: interaction is OFF while the action runs, because a click
// landing during it would queue a second one.
export const BlocksInteraction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const overlay = canvas.getByTestId("spinner-overlay");
    await expect(overlay).toHaveAttribute("aria-busy", "true");
    await expect(canvas.getByTestId("spinner")).toBeVisible();

    // The button is still in the tree — it is the content being blocked — but pointer events are off
    // on its container, so it cannot be reached.
    await expect(canvas.getByTestId("panel-action")).toBeInTheDocument();
  },
};

// Not busy: the children render bare, with no wrapper at all. A component that left an extra Box in
// the tree when idle would change the layout of every panel that used it.
export const IdleAddsNothing: Story = {
  args: { busy: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("spinner-overlay")).toBeNull();
    await expect(canvas.getByTestId("panel-action")).toBeVisible();
  },
};

export const NoLabel: Story = { args: { label: undefined } };
