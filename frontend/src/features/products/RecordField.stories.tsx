import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge, SimpleGrid } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { Field, Stat, description } from "./RecordField";

// The two read-only pieces both product details lay their record out with.

function Record() {
  return (
    <SimpleGrid columns={2} gap="card" maxW="lg">
      <Field label="Category" value="Rumah Tangga › Dapur" testId="field-filled" />
      <Field label="Description" value="" testId="field-empty" />
      <Stat label="Cross markup" hint="What you pay over the owner's cost, per unit." testId="stat-hinted">
        <Badge colorPalette="brand">1.5%</Badge>
      </Stat>
      <Stat label="Reserved stock" testId="stat-bare">
        2 pcs
      </Stat>
    </SimpleGrid>
  );
}

const meta = {
  title: "Features/Products/RecordField",
  component: Record,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Record>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// An empty value is a dash, never nothing — a blank collapses the row and reads as a broken layout.
export const AnEmptyValueIsADash: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("field-empty")).toHaveTextContent("—");
    await expect(canvas.getByTestId("field-filled")).toHaveTextContent("Rumah Tangga › Dapur");
    await expect(canvas.getByTestId("stat-hinted")).toHaveTextContent("What you pay over the owner's cost");
  },
};
