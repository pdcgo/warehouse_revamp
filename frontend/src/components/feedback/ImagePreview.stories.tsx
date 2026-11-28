import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { ImagePreview, type PreviewTarget, description } from "./ImagePreview";

// A 2×2 checker as a data URL — a real image the browser decodes, with no network.
const PICTURE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#e2e8f0"/><rect width="200" height="150" fill="#22c55e"/><rect x="200" y="150" width="200" height="150" fill="#22c55e"/></svg>',
  );

const TARGET: PreviewTarget = { src: PICTURE, title: "Beras Pandan Wangi 5kg", caption: "SKU-BERAS-5K" };

function Clickable() {
  const [target, setTarget] = useState<PreviewTarget | null>(null);

  return (
    <>
      <Button onClick={() => setTarget(TARGET)} data-testid="open-preview">
        Open
      </Button>
      <ImagePreview target={target} onClose={() => setTarget(null)} />
    </>
  );
}

const meta = {
  title: "Components/Feedback/ImagePreview",
  component: ImagePreview,
  parameters: { docs: { description: { component: description } } },
  args: { target: null, onClose: () => {} },
  render: () => <Clickable />,
} satisfies Meta<typeof ImagePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

// A SMALL PICTURE OPENS BIG (a-small-picture-opens-its-preview) — titled with what it is, its caption under it; the close
// shuts it.
export const OpensAndShuts: Story = {
  name: "Opens and shuts",
  play: async ({ canvasElement }) => {
    await userEvent.click(canvasElement.querySelector<HTMLElement>('[data-testid="open-preview"]')!);

    const dialog = await screen.findByTestId("image-preview");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Beras Pandan Wangi 5kg");
    await expect(dialog).toHaveTextContent("SKU-BERAS-5K");
    await expect(screen.getByTestId("image-preview-image")).toHaveAttribute("src", PICTURE);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("image-preview")).toBeNull());
  },
};
