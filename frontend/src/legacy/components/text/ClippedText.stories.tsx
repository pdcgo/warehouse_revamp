import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { ClippedText, description } from "./ClippedText";

const LONG = "Kaos Polos Cotton Combed 30s Lengan Panjang Hitam Ukuran XL";

const meta = {
  title: "Legacy/Components/Text/ClippedText",
  component: ClippedText,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof ClippedText>;

export default meta;
type Story = StoryObj<typeof meta>;

// The text does NOT fit — so a tooltip is attached, and the full name stays one hover away instead
// of requiring the detail page.
export const Clipped: Story = {
  render: () => (
    <Box w="180px" borderWidth="1px" p="2">
      <ClippedText>{LONG}</ClippedText>
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const el = canvas.getByTestId("clipped-text");

    await waitFor(async () => {
      await expect(el).toHaveAttribute("data-clipped", "true");
    });

    await userEvent.hover(el);
    await waitFor(async () => {
      await expect(screen.getByTestId("tooltip-content")).toBeVisible();
    });
  },
};

// The text DOES fit — so there is no tooltip. This is the rule that makes the component worth
// having: a tip repeating what is already legible is noise that fires on the way to somewhere else.
export const NotClippedHasNoTooltip: Story = {
  render: () => (
    <Box w="400px" borderWidth="1px" p="2">
      <ClippedText>Short name</ClippedText>
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const el = canvas.getByTestId("clipped-text");

    await waitFor(async () => {
      await expect(el).toHaveAttribute("data-clipped", "false");
    });

    await userEvent.hover(el);
    await new Promise((r) => setTimeout(r, 350));
    await expect(screen.queryByTestId("tooltip-content")).toBeNull();
  },
};

// A clamped multi-line block clips by HEIGHT, not width — the same component covers it, which is
// why the measurement checks both axes rather than taking a mode prop.
export const MultiLineClamp: Story = {
  render: () => (
    <Box w="220px" borderWidth="1px" p="2">
      <ClippedText lineClamp={2}>{`${LONG} ${LONG}`}</ClippedText>
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(async () => {
      await expect(canvas.getByTestId("clipped-text")).toHaveAttribute("data-clipped", "true");
    });
  },
};
