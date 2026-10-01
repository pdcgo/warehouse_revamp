import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack, Stack, Text } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { MovementStatusBadge, description } from "./MovementStatusBadge";

const meta = {
  title: "LegacyWarehouse/Components/Badges/MovementStatusBadge",
  component: MovementStatusBadge,
  parameters: { docs: { description: { component: description } } },
  args: { direction: "outbound", status: "packing_completed" },
} satisfies Meta<typeof MovementStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// ⚠ THE FINDING THIS COMPONENT EXISTS TO MAKE VISIBLE: one status key, three meanings. `completed`
// is the goods ARRIVING on one screen and LEAVING on another, and nothing in the record says which.
export const SameStatusThreeMeanings: Story = {
  render: () => (
    <Stack gap="3">
      {(["inbound", "return", "outbound"] as const).map((direction) => (
        <HStack key={direction} gap="3">
          <Text fontSize="sm" color="fg.muted" w="20">
            {direction}
          </Text>
          <MovementStatusBadge direction={direction} status="completed" />
        </HStack>
      ))}
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const badges = canvas.getAllByTestId("movement-status");
    await expect(badges).toHaveLength(3);
    // Same key, three different words.
    await expect(badges[0]).toHaveTextContent("Received by warehouse");
    await expect(badges[1]).toHaveTextContent("Return accepted");
    await expect(badges[2]).toHaveTextContent("Handed to courier");
  },
};

// A status that is legal in the enum but meaningless in this direction reads AS A PROBLEM rather
// than rendering an empty badge. The original leaves four of seven keys as empty strings on the
// inbound screens, which renders as a blank cell — indistinguishable from missing data.
export const AStatusThatCannotHappenHereSaysSo: Story = {
  args: { direction: "inbound", status: "picking" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("movement-status")).toHaveTextContent("not valid here");
  },
};

export const TheOutboundLifecycle: Story = {
  render: () => (
    <HStack gap="2" wrap="wrap">
      {(["waiting", "picking", "picked", "packing", "packing_completed", "completed", "cancel"] as const).map(
        (status) => (
          <MovementStatusBadge key={status} direction="outbound" status={status} />
        ),
      )}
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("movement-status")).toHaveLength(7);
  },
};
