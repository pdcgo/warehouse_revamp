import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { ImageUpload, Upload, description, imageDescription } from "./Upload";

const meta = {
  title: "Legacy/Components/Inputs/Upload",
  component: Upload,
  parameters: { docs: { description: { component: description } } },
  args: { accept: ".pdf,.csv", maxSize: 2 * 1_048_576 },
} satisfies Meta<typeof Upload>;

export default meta;
type Story = StoryObj<typeof meta>;

// RULE 2: the limits are on screen BEFORE the pick. A constraint you only learn by violating it is
// a constraint nobody can plan around — and on warehouse wifi, learning it costs a two-minute upload.
export const LimitsAreStatedUpFront: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const limits = canvas.getByTestId("upload-limits");
    await expect(limits).toHaveTextContent(".pdf,.csv");
    await expect(limits).toHaveTextContent("2MB");
  },
};

export const MultipleFiles: Story = {
  args: { maxFiles: 5, accept: "image/*" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("upload-limits")).toHaveTextContent("5 files max");
  },
};

// The picture variant PREVIEWS instead of listing a filename. Warehouse photos are evidence taken
// in a hurry on a phone, and "IMG_20260819_143301.jpg" cannot tell the uploader whether they
// photographed the right thing or whether it came out legible.
export const Images: Story = {
  parameters: { docs: { description: { story: imageDescription } } },
  render: () => <ImageUpload />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("image-upload")).toBeVisible();
  },
};

export const Disabled: Story = { args: { disabled: true } };
