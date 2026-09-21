import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { Field, description } from "./Field";

const meta = {
  title: "Legacy/Components/Inputs/Field",
  component: Field,
  parameters: { docs: { description: { component: description } } },
  args: { label: "Ref id", hint: "The SKU printed on the shelf label.", children: <Input /> },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithHint: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("field-hint")).toBeVisible();
  },
};

// THE rule: an error REPLACES the hint. Showing both puts the instruction and the complaint side by
// side, and the reader has to work out which is current — usually while already frustrated.
export const ErrorReplacesTheHint: Story = {
  args: { error: "This ref id is already used by another product." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("field-error")).toBeVisible();
    await expect(canvas.queryByTestId("field-hint")).toBeNull();
  },
};

// The label, the required marker and the message are ASSOCIATED with the control, not just placed
// near it — so clicking the label focuses the field and the error is announced with it.
export const RequiredIsAnnounced: Story = {
  args: { required: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("textbox")).toBeRequired();
  },
};
