import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { CopyText, description } from "./CopyText";

const meta = {
  title: "Legacy/Components/Text/CopyText",
  component: CopyText,
  parameters: { docs: { description: { component: description } } },
  args: { children: <Text as="span">JX9920481221</Text>, copyText: "JX9920481221" },
} satisfies Meta<typeof CopyText>;

export default meta;
type Story = StoryObj<typeof meta>;

// Clipboard writes are silent, so the confirmation IS the feature: without it a person clicks
// twice, or pastes somewhere just to check it took.
export const CopyingConfirms: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("copy-text-trigger"));

    // The value reached the clipboard…
    await waitFor(async () => {
      await expect((window as unknown as { __copiedText?: string }).__copiedText).toBe("JX9920481221");
    });

    // …and the button confirmed it, which is the half a silent clipboard write cannot do for itself.
    await waitFor(async () => {
      await expect(canvas.getByRole("button", { name: /copied/i })).toBeVisible();
    });
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("copy-text-trigger")).toBeDisabled();
  },
};
