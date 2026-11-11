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

/**
 * A LONG VALUE IS CUT, AND ITS TOOLTIP SAYS IT WHOLE (owner, on the restock list: *"harus ada pembatasan tapi juga harus
 * ada cara lihat fullnya"*) — `maxW` cuts the shown text with an ellipsis; under the pointer the tooltip shows every
 * character. The copy is the whole value, which the button's accessible name carries.
 */
export const ALongValueIsCut: Story = {
  args: { value: "JNE-CGK-20260911-0000111122-REG", mono: true, maxW: "10rem" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shown = canvas.getByTestId("copy-shown");

    await expect(shown.scrollWidth).toBeGreaterThan(shown.clientWidth);
    await expect(canvas.getByTestId("copy")).toHaveAccessibleName("Copy: JNE-CGK-20260911-0000111122-REG");

    await userEvent.hover(canvas.getByTestId("copy"));
    const whole = await within(document.body).findByTestId("copy-whole");
    await waitFor(() => expect(whole).toBeVisible());
    await expect(whole).toHaveTextContent("JNE-CGK-20260911-0000111122-REG");
  },
};

/** …and a value that fits under its cap is not cut, so no tooltip repeats it. */
export const AShortValueUnderACapHasNoTooltip: Story = {
  args: { value: "JNE0123456789", mono: true, maxW: "10rem" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shown = canvas.getByTestId("copy-shown");

    await expect(shown.scrollWidth).toBeLessThanOrEqual(shown.clientWidth);
    await userEvent.hover(canvas.getByTestId("copy"));
    await new Promise((r) => setTimeout(r, 400));
    await expect(within(document.body).queryByTestId("copy-whole")).toBeNull();
  },
};
