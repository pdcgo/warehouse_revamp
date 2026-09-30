import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { CopyText, description } from "./CopyText";

const meta = {
  title: "Components/Chrome/CopyText",
  component: CopyText,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    value: "SP-2409-8841",
    testId: "copy",
  },
} satisfies Meta<typeof CopyText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A tracking number is read character by character. */
export const Mono: Story = {
  args: { value: "AJ0876206209", mono: true },
};

/** Shown formatted, copied as a plain number — the paste goes into a sheet or a marketplace form. */
export const DisplayDiffersFromValue: Story = {
  args: { value: "245000", display: "Rp 245.000" },
};

// Counted through React's own onClick — `stopPropagation` acts on React's tree, which is the tree a
// clickable table row listens on.
let rowClicks = 0;

/**
 * ⚠ A CLICK NEVER REACHES THE ROW, and it always REPORTS an outcome. The row under it opens a record;
 * copying must not also navigate. The outcome is ✓ or ⚠, never a tick that fires before the write
 * settled — which is the bug that replaced Chakra's Clipboard here. Which of the two appears depends on
 * the browser's clipboard permission, so the story asserts that ONE did.
 */
export const CopyingDoesNotClickTheRow: Story = {
  render: (args) => (
    <Box
      p="2"
      onClick={() => {
        rowClicks += 1;
      }}
    >
      <CopyText {...args} />
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    rowClicks = 0;

    await userEvent.click(canvas.getByTestId("copy"));

    await waitFor(() => {
      const el = canvas.getByTestId("copy");
      expect(el.hasAttribute("data-copied") || el.hasAttribute("data-copy-failed")).toBe(true);
    });
    await expect(rowClicks).toBe(0);
  },
};
