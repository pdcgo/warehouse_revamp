import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { CopyNumber, CopyNumberPlain, description, plainDescription } from "./CopyNumber";

const meta = {
  title: "Legacy/Components/Text/CopyNumber",
  component: CopyNumber,
  parameters: { docs: { description: { component: description } } },
  args: { value: 1_500_000, kind: "price", compact: true },
} satisfies Meta<typeof CopyNumber>;

export default meta;
type Story = StoryObj<typeof meta>;

// THE rule: you READ "Rp 1,5jt" and you PASTE "1500000". Copying the display form would hand a
// spreadsheet a currency prefix, separators and a `jt` suffix to hand-clean — the work the button
// was meant to remove. Asserting the rendered text alone would not test this at all, so the story
// reads what actually landed on the clipboard (see the stub in .storybook/preview.tsx).
export const ReadsFormattedCopiesRaw: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("copy-number")).toHaveTextContent("Rp 1,5jt");

    await userEvent.click(canvas.getByTestId("copy-text-trigger"));

    await waitFor(async () => {
      await expect((window as unknown as { __copiedText?: string }).__copiedText).toBe("1500000");
    });
  },
};

export const Count: Story = {
  args: { value: 12_480, kind: "number", compact: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("copy-number")).toHaveTextContent("12.480");
  },
};

export const Percent: Story = {
  args: { value: 12.345, kind: "percent", compact: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("copy-number")).toHaveTextContent("12.3%");
  },
};

// The chromeless variant, for dense tiles and totals rows where a button per figure would outweigh
// the figures. Its affordance is the cursor and the tooltip — hence the separate description.
export const Plain: Story = {
  parameters: { docs: { description: { story: plainDescription } } },
  render: () => (
    <HStack gap="4">
      <CopyNumberPlain value={1_500_000} kind="price" compact />
      <CopyNumberPlain value={12_480} />
      <CopyNumberPlain value={98.6} kind="percent" />
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("copy-number-plain")).toHaveLength(3);
  },
};
