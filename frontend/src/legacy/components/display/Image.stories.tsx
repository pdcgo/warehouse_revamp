import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { Image, description } from "./Image";

// A 1x1 gif as a data URI — no network, so the story is deterministic.
const OK_SRC =
  "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

const meta = {
  title: "Legacy/Components/Display/Image",
  component: Image,
  parameters: { docs: { description: { component: description } } },
  args: { src: OK_SRC, alt: "Kaos Polos Hitam", boxSize: "12" },
} satisfies Meta<typeof Image>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("image")).toBeVisible();
  },
};

// No src: a fixed-size placeholder, not a torn-page glyph sized to the alt text. A broken <img> in a
// product table makes every row a different height, which disrupts the grid far more than the
// missing photo does.
export const MissingSourceKeepsTheGrid: Story = {
  args: { src: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const placeholder = canvas.getByTestId("image-placeholder");
    await expect(placeholder).toBeVisible();
    // Still announced as the picture it stands in for.
    await expect(placeholder).toHaveAttribute("aria-label", "Kaos Polos Hitam");
  },
};

// A src that 404s falls back to the same placeholder once the error fires.
export const BrokenSourceFallsBack: Story = {
  args: { src: "https://example.invalid/nope.png" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(
      async () => {
        await expect(canvas.getByTestId("image-placeholder")).toBeVisible();
      },
      { timeout: 5000 },
    );
  },
};

// Preview is opt-in: only where the picture carries information a thumbnail cannot. The click must
// not reach the row behind it, which is always a link in a product table.
export const PreviewOpensFullSize: Story = {
  args: { preview: true },
  render: (args) => (
    <HStack data-testid="row" onClick={() => { (window as unknown as { __row?: boolean }).__row = true; }}>
      <Image {...args} />
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    (window as unknown as { __row?: boolean }).__row = false;

    await userEvent.click(canvas.getByTestId("image"));

    await waitFor(async () => {
      await expect(screen.getByTestId("modal")).toBeVisible();
    });
    await expect((window as unknown as { __row?: boolean }).__row).toBe(false);
  },
};
