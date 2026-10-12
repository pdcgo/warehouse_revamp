import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { SettlementSourceBadge, description } from "./SettlementSourceBadge";

const meta = {
  title: "Components/Badges/SettlementSourceBadge",
  component: SettlementSourceBadge,
  parameters: { docs: { description: { component: description } } },
  args: { source: "importer" },
} satisfies Meta<typeof SettlementSourceBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The three sources side by side — one colour and icon each. */
export const AllThree: Story = {
  render: () => (
    <HStack>
      <SettlementSourceBadge source="importer" />
      <SettlementSourceBadge source="manual" actor="Budi" />
      <SettlementSourceBadge source="order" />
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("source-badge-importer")).toHaveTextContent("Import");
    await expect(canvas.getByTestId("source-badge-order")).toHaveTextContent("Order");
  },
};

/** A manual entry names who typed it — nothing checks a typed amount, so the name is the control. */
export const ManualNamesWhoTypedIt: Story = {
  args: { source: "manual", actor: "Budi" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("source-badge-manual")).toHaveTextContent("Manual · Budi");
  },
};

/** Only a manual entry carries a name — an import or an order post has no person behind it. */
export const OnlyManualCarriesAName: Story = {
  args: { source: "importer", actor: "Budi" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("source-badge-importer")).not.toHaveTextContent("Budi");
  },
};
